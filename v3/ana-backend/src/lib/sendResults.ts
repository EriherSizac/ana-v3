import { createHash } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { bucketName, isConditionalConflict, s3 } from './s3Json';

/**
 * Historial de envíos del CLI v3 (add-agent-send-history, spec v3/agent-send-history).
 *
 * Escritura (design D4): un objeto inmutable por lote y día MX de `sentAt`,
 *   results/{campaign}/{agent}/{YYYY-MM-DD}/{sha256(ids)[0..16]}.json
 * con `If-None-Match: *` (reintento del mismo lote = no-op).
 *
 * Lectura (design D5): lotes del rango, deduplicados por `id` (primero gana),
 * con compactación por día en `_compact.json`. Las respuestas nunca llevan el
 * teléfono completo ni se registran teléfonos o mensajes en logs.
 */

export const RESULT_STATUSES = ['sent', 'no_whatsapp', 'error', 'por_revisar'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const MAX_BATCH = 100;
export const MAX_RANGE_DAYS = 31;
export const DEFAULT_RANGE_DAYS = 7;
export const RETENTION_DAYS = 180;
export const MAX_PAGE = 500;
export const DEFAULT_PAGE = 200;
export const COMPACT_THRESHOLD = 20;
export const COMPACT_NAME = '_compact.json';
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 16;
export const MX_TZ = 'America/Mexico_City';

const ASSIGNMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const ERROR_CODE_RE = /^[a-z0-9_]{1,40}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLICATION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export interface StoredResult {
  id: string;
  assignmentId: string;
  sourceKey: string | null;
  uploadId: string | null;
  rowIndex: number;
  attempt: number;
  credit: string | null;
  /** Dígitos normalizados (52 + 10 en MX). Nunca sale en una respuesta GET. */
  phone: string;
  status: ResultStatus;
  errorCode: string | null;
  error: string | null;
  sentAt: string;
  messageHash: string | null;
  messagePreview: string | null;
}

export interface ResultBatch {
  schemaVersion: 1;
  campaign: string;
  agent: string;
  receivedAt: string;
  cliVersion: string;
  items: StoredResult[];
}

interface CompactDay {
  schemaVersion: 1;
  /** Lotes incluidos, en el orden de deduplicación. */
  keys: string[];
  items: Array<StoredResult & { receivedAt: string }>;
}

// ── Fechas MX ────────────────────────────────────────────────────────────

const mxFmt = new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Día calendario en Ciudad de México (`YYYY-MM-DD`). */
export const mxDate = (d: Date | number): string => mxFmt.format(typeof d === 'number' ? new Date(d) : d);

/** `YYYY-MM-DD` válido (fecha real). */
export const isDateString = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** Suma días a una fecha `YYYY-MM-DD` (aritmética de calendario, sin zona). */
export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Días entre `from` y `to` incluidos. */
export const daysBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

// ── Validación de items ──────────────────────────────────────────────────

export const resultId = (assignmentId: string, rowIndex: number, attempt: number): string => `${assignmentId}#${rowIndex}#${attempt}`;

/** ¿La llave es un archivo entregado al agente en la campaña? (`agents/{c}/{agent}-contacts-*.csv`) */
export function isOwnSourceKey(key: unknown, campaign: string, agent: string): key is string {
  if (typeof key !== 'string' || key.length > 512 || key.includes('..') || key.includes('\\')) return false;
  const dir = `agents/${campaign}/`;
  if (!key.startsWith(dir)) return false;
  const file = key.slice(dir.length);
  return !file.includes('/') && file.startsWith(`${agent}-contacts`) && file.endsWith('.csv');
}

const optString = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

/** Valida y normaliza un item del CLI. `{invalid}` si no se puede guardar. */
export function parseResultItem(raw: unknown, campaign: string, agent: string, now: number): StoredResult | { invalid: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { invalid: 'item inválido' };
  const r = raw as Record<string, unknown>;
  if (typeof r.assignmentId !== 'string' || !ASSIGNMENT_ID_RE.test(r.assignmentId)) return { invalid: 'assignmentId inválido' };
  if (!Number.isInteger(r.rowIndex) || (r.rowIndex as number) < 0 || (r.rowIndex as number) > 100_000) return { invalid: 'rowIndex inválido' };
  const attempt = r.attempt === undefined ? 1 : r.attempt;
  if (!Number.isInteger(attempt) || (attempt as number) < 1 || (attempt as number) > 20) return { invalid: 'attempt inválido' };
  const id = resultId(r.assignmentId, r.rowIndex as number, attempt as number);
  if (r.id !== undefined && r.id !== id) return { invalid: 'id inválido' };
  if (typeof r.status !== 'string' || !(RESULT_STATUSES as readonly string[]).includes(r.status)) return { invalid: 'status inválido' };
  const phone = typeof r.phone === 'string' ? r.phone.replace(/\D/g, '') : '';
  if (phone && (phone.length < 8 || phone.length > 15)) return { invalid: 'phone inválido' };
  if (typeof r.sentAt !== 'string') return { invalid: 'sentAt inválido' };
  const t = Date.parse(r.sentAt);
  if (!Number.isFinite(t) || t > now + FUTURE_SKEW_MS || t < now - RETENTION_DAYS * DAY_MS) return { invalid: 'sentAt fuera de rango' };
  const credit = optString(r.credit, 64);
  return {
    id,
    assignmentId: r.assignmentId,
    sourceKey: isOwnSourceKey(r.sourceKey, campaign, agent) ? r.sourceKey : null,
    uploadId: typeof r.uploadId === 'string' && UPLOAD_ID_RE.test(r.uploadId) ? r.uploadId : null,
    rowIndex: r.rowIndex as number,
    attempt: attempt as number,
    credit,
    phone,
    status: r.status as ResultStatus,
    errorCode: typeof r.errorCode === 'string' && ERROR_CODE_RE.test(r.errorCode) ? r.errorCode : null,
    error: optString(r.error, 200),
    sentAt: new Date(t).toISOString(),
    messageHash: typeof r.messageHash === 'string' && HASH_RE.test(r.messageHash) ? r.messageHash : null,
    messagePreview: optString(r.messagePreview, 160),
  };
}

export interface ParsedBatch {
  items: StoredResult[];
  rejected: Array<{ index: number; id: string | null; reason: string }>;
}

/** Valida `items` uno a uno; descarta repetidos dentro del lote (primero gana). */
export function parseResultItems(items: readonly unknown[], campaign: string, agent: string, now: number): ParsedBatch {
  const out: StoredResult[] = [];
  const rejected: ParsedBatch['rejected'] = [];
  const seen = new Set<string>();
  items.forEach((raw, index) => {
    const p = parseResultItem(raw, campaign, agent, now);
    if ('invalid' in p) {
      const rawId = (raw as { id?: unknown } | null)?.id;
      rejected.push({ index, id: typeof rawId === 'string' ? rawId.slice(0, 100) : null, reason: p.invalid });
      return;
    }
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  });
  return { items: out, rejected };
}

// ── Escritura ────────────────────────────────────────────────────────────

export const resultsAgentPrefix = (campaign: string, agent: string): string => `results/${campaign}/${agent}/`;
export const resultsDayPrefix = (campaign: string, agent: string, date: string): string => `${resultsAgentPrefix(campaign, agent)}${date}/`;

/** Llave determinista del lote: mismo conjunto de ids → misma llave. */
export const batchKey = (campaign: string, agent: string, date: string, ids: readonly string[]): string =>
  `${resultsDayPrefix(campaign, agent, date)}${createHash('sha256').update([...ids].sort().join('\n')).digest('hex').slice(0, 16)}.json`;

/** Agrupa por día MX de `sentAt` y escribe un objeto por grupo. Devuelve llaves escritas y repetidas. */
export async function writeResults(
  campaign: string,
  agent: string,
  items: readonly StoredResult[],
  cliVersion: string,
  now = new Date(),
): Promise<{ written: string[]; duplicates: string[] }> {
  const byDay = new Map<string, StoredResult[]>();
  for (const it of items) {
    const d = mxDate(Date.parse(it.sentAt));
    byDay.set(d, [...(byDay.get(d) ?? []), it]);
  }
  const written: string[] = [];
  const duplicates: string[] = [];
  for (const [date, group] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const key = batchKey(campaign, agent, date, group.map((g) => g.id));
    const batch: ResultBatch = { schemaVersion: 1, campaign, agent, receivedAt: now.toISOString(), cliVersion, items: group };
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: JSON.stringify(batch), ContentType: 'application/json', IfNoneMatch: '*' }));
      written.push(key);
    } catch (e) {
      if (!isConditionalConflict(e)) throw e;
      duplicates.push(key);
    }
  }
  return { written, duplicates };
}

// ── Lectura ──────────────────────────────────────────────────────────────

export type ReadResult = StoredResult & { agent: string; receivedAt: string };

/** Ejecuta `fn` sobre `list` con concurrencia limitada, conservando el orden. */
export async function mapLimit<T, R>(list: readonly T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length);
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const n = i++;
      out[n] = await fn(list[n]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

async function listKeys(prefix: string): Promise<Array<{ key: string; lastModified: number }>> {
  const out: Array<{ key: string; lastModified: number }> = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketName(), Prefix: prefix, ContinuationToken: token }));
    for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified?.getTime() ?? 0 });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Subcarpetas inmediatas de un prefijo (Delimiter `/`). */
export async function listChildren(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketName(), Prefix: prefix, Delimiter: '/', ContinuationToken: token }));
    for (const p of res.CommonPrefixes ?? []) if (p.Prefix) out.push(p.Prefix.slice(prefix.length).replace(/\/$/, ''));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

const isNotFound = (e: any): boolean => e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;

async function getJson<T>(key: string): Promise<{ value: T; etag: string | null } | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
    const text = (await out.Body?.transformToString()) ?? '';
    return { value: JSON.parse(text) as T, etag: out.ETag ?? null };
  } catch (e) {
    if (isNotFound(e) || e instanceof SyntaxError) return null;
    throw e;
  }
}

/** Resultados de un agente en un día (con compactación oportunista). */
export async function readAgentDay(campaign: string, agent: string, date: string): Promise<ReadResult[]> {
  const prefix = resultsDayPrefix(campaign, agent, date);
  const listed = await listKeys(prefix);
  const compactKey = `${prefix}${COMPACT_NAME}`;
  const hasCompact = listed.some((o) => o.key === compactKey);
  const batches = listed.filter((o) => !o.key.slice(prefix.length).startsWith('_') && o.key.endsWith('.json'));
  const compact = hasCompact ? await getJson<CompactDay>(compactKey) : null;
  const covered = new Set(compact?.value?.keys ?? []);
  const missing = batches.filter((b) => !covered.has(b.key)).sort((a, b) => a.lastModified - b.lastModified || a.key.localeCompare(b.key));
  const loaded = await mapLimit(missing, CONCURRENCY, async (b) => ({ key: b.key, batch: (await getJson<ResultBatch>(b.key))?.value ?? null }));

  const items: Array<StoredResult & { receivedAt: string }> = [...(compact?.value?.items ?? [])];
  const keys = [...(compact?.value?.keys ?? [])];
  for (const { key, batch } of loaded) {
    keys.push(key);
    if (!batch || !Array.isArray(batch.items)) continue;
    for (const it of batch.items) items.push({ ...it, receivedAt: batch.receivedAt });
  }

  if (missing.length >= COMPACT_THRESHOLD) {
    const body: CompactDay = { schemaVersion: 1, keys, items };
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName(),
          Key: compactKey,
          Body: JSON.stringify(body),
          ContentType: 'application/json',
          ...(compact?.etag ? { IfMatch: compact.etag } : { IfNoneMatch: '*' }),
        }),
      );
    } catch (e) {
      // Otra lectura compactó a la vez: se conserva la suya.
      if (!isConditionalConflict(e)) console.error(JSON.stringify({ evt: 'send_results_compact', status: 'failed', name: (e as Error)?.name ?? 'Error' }));
    }
  }
  return items.map((it) => ({ ...it, agent }));
}

/** Resultados de los agentes en el rango, deduplicados por `id` (primero recibido gana). */
export async function readResults(campaign: string, agents: readonly string[], from: string, to: string): Promise<ReadResult[]> {
  const jobs = agents.flatMap((agent) => daysBetween(from, to).map((date) => ({ agent, date })));
  const days = await mapLimit(jobs, CONCURRENCY, (j) => readAgentDay(campaign, j.agent, j.date));
  const all = days.flat().sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const seen = new Set<string>();
  const out: ReadResult[] = [];
  for (const it of all) {
    const k = `${it.agent}|${it.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** Agentes con resultados en la campaña (subcarpetas de `results/{campaign}/`). */
export const resultAgents = (campaign: string): Promise<string[]> => listChildren(`results/${campaign}/`);

// ── Publicaciones ────────────────────────────────────────────────────────

export interface PublicationRef {
  publishId: string;
  agent: string;
  publishedAt: string;
  contacts: number;
  key: string;
  template: string;
}

/** Manifiestos de publicación del agente modificados desde `sinceMs` (máx. 100 más recientes). */
export async function readPublications(campaign: string, agent: string, sinceMs: number): Promise<PublicationRef[]> {
  const prefix = `agent-publications/${campaign}/${agent}/`;
  const listed = (await listKeys(prefix))
    .filter((o) => o.key.endsWith('.json') && !o.key.slice(prefix.length).includes('/') && o.lastModified >= sinceMs)
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 100);
  const out = await mapLimit(listed, CONCURRENCY, async (o) => (await getJson<Record<string, unknown>>(o.key))?.value ?? null);
  return out
    .filter((m): m is Record<string, unknown> => !!m && typeof m.publishId === 'string' && typeof m.key === 'string')
    .map((m) => ({
      publishId: m.publishId as string,
      agent,
      publishedAt: typeof m.publishedAt === 'string' ? m.publishedAt : '',
      contacts: typeof m.contacts === 'number' ? m.contacts : 0,
      key: m.key as string,
      template: typeof m.template === 'string' ? m.template : '',
    }));
}

// ── Consulta ─────────────────────────────────────────────────────────────

export type SortField = 'sentAt' | 'status' | 'credit';

export interface ResultsQuery {
  from: string;
  to: string;
  statuses: ResultStatus[];
  /** `none` = sin publicación asociada. */
  publicationId: string | null;
  q: string;
  sort: SortField;
  order: 'asc' | 'desc';
  offset: number;
  limit: number;
}

/** Valida la query (`from`/`to` días MX, máx. 31 días; por defecto los últimos 7). */
export function parseResultsQuery(qs: Record<string, string | undefined> | null | undefined, now = new Date()): ResultsQuery | { error: string } {
  const q = qs ?? {};
  const today = mxDate(now);
  const to = q.to ?? today;
  if (!isDateString(to)) return { error: 'to inválido' };
  const from = q.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (!isDateString(from)) return { error: 'from inválido' };
  if (from > to) return { error: 'from debe ser anterior a to' };
  if (daysBetween(from, to).length > MAX_RANGE_DAYS) return { error: `El rango admite como máximo ${MAX_RANGE_DAYS} días` };
  const statuses: ResultStatus[] = [];
  if (q.status) {
    for (const s of q.status.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!(RESULT_STATUSES as readonly string[]).includes(s)) return { error: 'status inválido' };
      if (!statuses.includes(s as ResultStatus)) statuses.push(s as ResultStatus);
    }
  }
  const publicationId = q.publicationId ? q.publicationId : null;
  if (publicationId !== null && publicationId !== 'none' && !PUBLICATION_ID_RE.test(publicationId)) return { error: 'publicationId inválido' };
  const search = (q.q ?? '').trim();
  if (search.length > 64) return { error: 'Búsqueda demasiado larga' };
  const sort = (q.sort ?? 'sentAt') as SortField;
  if (!['sentAt', 'status', 'credit'].includes(sort)) return { error: 'sort inválido' };
  const order = (q.order ?? 'desc') as 'asc' | 'desc';
  if (order !== 'asc' && order !== 'desc') return { error: 'order inválido' };
  const offset = q.cursor === undefined || q.cursor === '' ? 0 : Number(q.cursor);
  if (!Number.isInteger(offset) || offset < 0) return { error: 'cursor inválido' };
  const limit = q.limit === undefined || q.limit === '' ? DEFAULT_PAGE : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) return { error: `limit debe estar entre 1 y ${MAX_PAGE}` };
  return { from, to, statuses, publicationId, q: search, sort, order, offset, limit };
}

/** Teléfono para mostrar: `**` + últimos 4 dígitos. */
export const maskPhone = (digits: string): string => (digits ? `**${digits.slice(-4)}` : '');

export interface ResultRow {
  id: string;
  agent: string;
  assignmentId: string;
  publicationId: string | null;
  uploadId: string | null;
  rowIndex: number;
  credit: string | null;
  phone: string;
  status: ResultStatus;
  errorCode: string | null;
  error: string | null;
  sentAt: string;
  messagePreview: string | null;
}

export type StatusCounts = Record<ResultStatus, number>;
const zeroCounts = (): StatusCounts => ({ sent: 0, no_whatsapp: 0, error: 0, por_revisar: 0 });

export interface PublicationSummary extends StatusCounts {
  publicationId: string;
  agent: string;
  publishedAt: string;
  published: number;
  reported: number;
  /** null si la publicación es anterior al rango (conteo parcial). */
  pending: number | null;
  templatePreview: string;
}

export interface ResultsPage {
  from: string;
  to: string;
  total: number;
  items: ResultRow[];
  nextCursor: string | null;
  summary: StatusCounts & { total: number };
  publications: PublicationSummary[];
  unlinked: StatusCounts & { reported: number };
}

const STATUS_ORDER: Record<ResultStatus, number> = { sent: 0, no_whatsapp: 1, error: 2, por_revisar: 3 };

/** Filtros, orden, página y agregados (design D5/D6). */
export function buildResultsPage(results: readonly ReadResult[], publications: readonly PublicationRef[], query: ResultsQuery): ResultsPage {
  const byKey = new Map(publications.map((p) => [`${p.agent}|${p.key}`, p]));
  const pubOf = (r: ReadResult) => (r.sourceKey ? byKey.get(`${r.agent}|${r.sourceKey}`) : undefined);

  // Agregados: todas las filas del rango (sin filtros de estado, publicación ni búsqueda).
  const summary = { ...zeroCounts(), total: 0 };
  const unlinked = { ...zeroCounts(), reported: 0 };
  const perPub = new Map<string, { counts: StatusCounts; rows: Set<string> }>();
  for (const r of results) {
    summary[r.status]++;
    summary.total++;
    const p = pubOf(r);
    if (!p) {
      unlinked[r.status]++;
      unlinked.reported++;
      continue;
    }
    const k = `${p.agent}|${p.publishId}`;
    const agg = perPub.get(k) ?? { counts: zeroCounts(), rows: new Set<string>() };
    agg.counts[r.status]++;
    agg.rows.add(`${r.assignmentId}#${r.rowIndex}`);
    perPub.set(k, agg);
  }
  const inRange = (p: PublicationRef) => {
    const d = p.publishedAt ? mxDate(Date.parse(p.publishedAt)) : '';
    return d >= query.from && d <= query.to;
  };
  const pubSummaries: PublicationSummary[] = publications
    .filter((p) => perPub.has(`${p.agent}|${p.publishId}`) || inRange(p))
    .map((p) => {
      const agg = perPub.get(`${p.agent}|${p.publishId}`);
      const reported = agg?.rows.size ?? 0;
      const fromOk = p.publishedAt ? mxDate(Date.parse(p.publishedAt)) >= query.from : false;
      return {
        publicationId: p.publishId,
        agent: p.agent,
        publishedAt: p.publishedAt,
        published: p.contacts,
        ...(agg?.counts ?? zeroCounts()),
        reported,
        pending: fromOk ? Math.max(0, p.contacts - reported) : null,
        templatePreview: p.template.replace(/\s+/g, ' ').trim().slice(0, 120),
      };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  // Filas filtradas.
  const needle = query.q.toLowerCase();
  const digits = query.q.replace(/\D/g, '');
  const filtered = results.filter((r) => {
    if (query.statuses.length > 0 && !query.statuses.includes(r.status)) return false;
    if (query.publicationId) {
      const p = pubOf(r);
      if (query.publicationId === 'none' ? !!p : p?.publishId !== query.publicationId) return false;
    }
    if (needle) {
      const byCredit = (r.credit ?? '').toLowerCase().includes(needle);
      const byPhone = digits.length >= 4 && r.phone.includes(digits);
      if (!byCredit && !byPhone) return false;
    }
    return true;
  });
  const dir = query.order === 'asc' ? 1 : -1;
  const cmp = (a: ReadResult, b: ReadResult): number => {
    let c = 0;
    if (query.sort === 'status') c = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    else if (query.sort === 'credit') c = (a.credit ?? '').localeCompare(b.credit ?? '', 'es', { numeric: true });
    if (c === 0) c = a.sentAt.localeCompare(b.sentAt);
    if (c === 0) c = a.id.localeCompare(b.id);
    return c * dir;
  };
  filtered.sort(cmp);
  const page = filtered.slice(query.offset, query.offset + query.limit);
  const next = query.offset + query.limit;
  return {
    from: query.from,
    to: query.to,
    total: filtered.length,
    items: page.map((r) => ({
      id: r.id,
      agent: r.agent,
      assignmentId: r.assignmentId,
      publicationId: pubOf(r)?.publishId ?? null,
      uploadId: r.uploadId,
      rowIndex: r.rowIndex,
      credit: r.credit,
      phone: maskPhone(r.phone),
      status: r.status,
      errorCode: r.errorCode,
      error: r.error,
      sentAt: r.sentAt,
      messagePreview: r.messagePreview,
    })),
    nextCursor: next < filtered.length ? String(next) : null,
    summary,
    publications: pubSummaries,
    unlinked,
  };
}

/** Consulta completa para uno o varios agentes. */
export async function queryResults(campaign: string, agents: readonly string[], query: ResultsQuery): Promise<ResultsPage> {
  const results = await readResults(campaign, agents, query.from, query.to);
  // Manifiestos desde 31 días antes del rango: enlazan resultados de publicaciones previas.
  const since = Date.parse(`${addDays(query.from, -MAX_RANGE_DAYS)}T00:00:00Z`);
  const pubs = (await mapLimit(agents, 4, (a) => readPublications(campaign, a, since))).flat();
  return buildResultsPage(results, pubs, query);
}
