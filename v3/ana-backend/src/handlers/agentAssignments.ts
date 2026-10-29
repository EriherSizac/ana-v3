import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { forbidden, requireAgentToken, rosterReason, type AgentAuthEvent, type AgentAuthResponse } from '../lib/agentAuth';
import { parseAssignmentCsv, serializeCsv } from '../lib/assignmentCsv';
import { buildPublication, overridesBySource, parseRowKey, PHONE_MODES, type BuiltPublication, type PhoneMode } from '../lib/publication';

export { overridesBySource, parseRowKey };
import { parseCampaignParam } from '../lib/identifiers';
import { bucketName, getText, putJson, s3 } from '../lib/s3Json';
import { makeTimestampForKey } from './adminContacts';

export { buildPublication, mergedHeader } from '../lib/publication';

/**
 * "Mi asignación" del agente v3 (add-agent-workspace, spec v3/agent-workspace):
 *
 *   GET  /agent/assignments/{campaign}               pendientes propios
 *   GET  /agent/assignments/{campaign}/file?key=     contenido de un pendiente
 *   POST /agent/assignments/{campaign}/publish       publica filas al CLI
 *   GET  /agent/assignments/{campaign}/publications  historial propio
 *
 * Authorizer `cognitoAgentJwt` + token estricto de `/agent/*` + roster v3.
 * El agente es siempre el del token. Nunca se registran teléfonos, filas ni
 * mensajes renderizados.
 */

export interface AgentEvent extends AgentAuthEvent {
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

type Result = { statusCode: number; headers: Record<string, string>; body: string };

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (statusCode: number, body: unknown): Result => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });
const ok = (data: unknown): Result => json(200, { success: true, data });
const fail = (statusCode: number, message: string, data?: unknown): Result =>
  json(statusCode, data === undefined ? { success: false, message } : { success: false, message, data });
const notAllowed = (): Result => json(403, { error: 'Archivo no permitido' });

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCES = 20;
export const MAX_ROWS = 20_000;
export const MAX_TEMPLATE = 2000;
export const MAX_PHONE_COLUMNS = 5;
const PUBLISH_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const HISTORY_LIMIT = 50;
export const CHANGED_MESSAGE = 'La asignación cambió; vuelve a cargarla';

export const pendingPrefix = (campaign: string, agent: string): string => `assignments/agents/${campaign}/${agent}-contacts`;
export const publicationKey = (campaign: string, agent: string, publishId: string): string =>
  `agent-publications/${campaign}/${agent}/${publishId}.json`;

/** ¿La llave es un pendiente del agente en la campaña? (sin recorridos ni subcarpetas). */
export function isOwnPendingKey(key: unknown, campaign: string, agent: string): key is string {
  if (typeof key !== 'string' || key.length > 512 || key.includes('..') || key.includes('\\')) return false;
  const dir = `assignments/agents/${campaign}/`;
  if (!key.startsWith(dir)) return false;
  const file = key.slice(dir.length);
  return !file.includes('/') && file.startsWith(`${agent}-contacts`) && file.endsWith('.csv');
}

/** Token + campaña + roster. Devuelve el agente o la respuesta de error, sin tocar S3 de datos. */
async function authorize(
  event: AgentEvent,
  route: string,
): Promise<{ ok: true; agent: string; campaign: string } | { ok: false; response: Result | AgentAuthResponse }> {
  const auth = await requireAgentToken(event, route);
  if (!auth.ok) return auth;
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return { ok: false, response: fail(400, 'Campaña inválida') };
  if ((await rosterReason(auth.username, campaign)) !== 'ok') return { ok: false, response: forbidden() };
  return { ok: true, agent: auth.username, campaign };
}

const internal = (context: string, e: unknown): Result => {
  console.error(JSON.stringify({ evt: 'agent_assignments_error', context, name: (e as Error)?.name ?? 'Error' }));
  return fail(500, 'Error interno del servidor');
};

const fileNameOf = (key: string): string => key.split('/').pop() ?? key;

// ── Antigüedad de los pendientes (asignaciones de más de 3 meses) ─────────
export const MAX_SOURCE_AGE_DAYS = 90;
export const MAX_SOURCE_AGE_MS = MAX_SOURCE_AGE_DAYS * 24 * 60 * 60 * 1000;
export const STALE_MESSAGE = 'Asignación con más de 3 meses';
/** Sufijo que escribe la carga (`makeTimestampForKey`): `-contacts-2026-10-26T10-00-00-000Z.csv`. */
const KEY_TS_RE = /-contacts-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.csv$/;

/** Fecha de carga del pendiente: la de la llave; si no la trae, `LastModified`. `null` si ninguna. */
export function sourceTimestamp(key: string, lastModified?: Date | null): number | null {
  const m = KEY_TS_RE.exec(key);
  if (m) {
    const [y, mo, d, h, mi, se, ms] = m.slice(1).map(Number) as [number, number, number, number, number, number, number];
    const t = Date.UTC(y, mo - 1, d, h, mi, se, ms);
    const back = new Date(t);
    // Fecha imposible (p. ej. mes 13) → se ignora la llave.
    if (back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && h < 24 && mi < 60 && se < 60) return t;
  }
  return lastModified ? lastModified.getTime() : null;
}

/** ¿El pendiente tiene más de 90 días? Sin fecha conocida no se considera vencido. */
export const isStaleSource = (key: string, lastModified?: Date | null, now: number = Date.now()): boolean => {
  const t = sourceTimestamp(key, lastModified);
  return t !== null && now - t > MAX_SOURCE_AGE_MS;
};

/** Filas válidas e ids de carga de un pendiente (tarjetas del paso 1). */
function summarizeCsv(text: string): { rows: number; uploadIds: string[] } {
  const p = parseAssignmentCsv(text);
  const col = p.header.findIndex((h) => h.toLowerCase() === 'ana_upload_id');
  const ids = new Set<string>();
  let rows = 0;
  for (const r of p.rows) {
    if (!r.valid) continue;
    rows++;
    const id = col >= 0 ? (r.values[col] ?? '').trim() : '';
    if (id) ids.add(id);
  }
  return { rows, uploadIds: [...ids] };
}

/** GET /agent/assignments/{campaign} */
export const listAssignments = async (event: AgentEvent): Promise<Result | AgentAuthResponse> => {
  const a = await authorize(event, 'GET /agent/assignments');
  if (!a.ok) return a.response;
  try {
    const items: Array<{
      key: string;
      fileName: string;
      lastModified: string | null;
      uploadedAt: string | null;
      size: number | null;
      etag: string | null;
      rows: number | null;
      uploadIds: string[] | null;
    }> = [];
    const now = Date.now();
    let token: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketName(), Prefix: pendingPrefix(a.campaign, a.agent), ContinuationToken: token }));
      for (const o of res.Contents ?? []) {
        if (!isOwnPendingKey(o.Key, a.campaign, a.agent)) continue;
        // Más de 3 meses: no se ofrece (y `/publish` lo rechaza).
        if (isStaleSource(o.Key, o.LastModified, now)) continue;
        const ts = sourceTimestamp(o.Key, o.LastModified);
        items.push({
          key: o.Key,
          fileName: fileNameOf(o.Key),
          lastModified: o.LastModified ? o.LastModified.toISOString() : null,
          uploadedAt: ts === null ? null : new Date(ts).toISOString(),
          size: typeof o.Size === 'number' ? o.Size : null,
          etag: o.ETag ?? null,
          rows: null,
          uploadIds: null,
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    items.sort((x, y) => String(y.uploadedAt ?? y.lastModified).localeCompare(String(x.uploadedAt ?? x.lastModified)));
    // Filas e ids de carga de los más recientes (hasta MAX_SOURCES); el resto queda en null.
    for (const it of items.slice(0, MAX_SOURCES)) {
      try {
        const obj = await readPending(it.key);
        if (obj) Object.assign(it, summarizeCsv(obj.text));
      } catch {
        // Demasiado grande o ilegible: se lista sin conteo.
      }
    }
    return ok({ campaign: a.campaign, agent: a.agent, items });
  } catch (e) {
    return internal('listAssignments', e);
  }
};

const isNotFound = (e: any): boolean => e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;

/** Lee un pendiente con su ETag. `null` si no existe; lanza `TooLarge` si supera el límite. */
async function readPending(key: string): Promise<{ text: string; etag: string | null; lastModified: Date | undefined } | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
    if (typeof out.ContentLength === 'number' && out.ContentLength > MAX_FILE_BYTES) throw Object.assign(new Error('TooLarge'), { name: 'TooLarge' });
    const text = (await out.Body?.transformToString()) ?? '';
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw Object.assign(new Error('TooLarge'), { name: 'TooLarge' });
    return { text, etag: out.ETag ?? null, lastModified: out.LastModified };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** GET /agent/assignments/{campaign}/file?key= */
export const getAssignmentFile = async (event: AgentEvent): Promise<Result | AgentAuthResponse> => {
  const a = await authorize(event, 'GET /agent/assignments/file');
  if (!a.ok) return a.response;
  const key = event.queryStringParameters?.key;
  if (!isOwnPendingKey(key, a.campaign, a.agent)) return notAllowed();
  try {
    const obj = await readPending(key);
    if (!obj) return fail(404, 'Archivo no encontrado');
    return ok({ key, etag: obj.etag, lastModified: obj.lastModified ? obj.lastModified.toISOString() : null, csv: obj.text });
  } catch (e) {
    if ((e as Error)?.name === 'TooLarge') return fail(413, 'Archivo demasiado grande');
    return internal('getAssignmentFile', e);
  }
};

// ── Publicación ──────────────────────────────────────────────────────────

export interface PublishSource {
  key: string;
  etag: string;
  rows: number[];
}

export interface PublishRequest {
  publishId: string;
  template: string;
  phoneColumns: string[];
  /** Ausente en el body → 'all' (clientes previos). */
  phoneMode: PhoneMode;
  sources: PublishSource[];
  /** Teléfono elegido por fila: `rowKey` = `<key de la fuente>#<índice de fila>`. */
  overrides: Record<string, string>;
}

/** Valida forma y límites del body (sin propiedad de llaves). */
export function parsePublishBody(body: unknown): PublishRequest | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body inválido' };
  const b = body as Record<string, unknown>;
  if (typeof b.publishId !== 'string' || !PUBLISH_ID_RE.test(b.publishId)) return { error: 'publishId inválido' };
  if (typeof b.template !== 'string' || !b.template.trim()) return { error: 'Escribe el mensaje' };
  if (b.template.length > MAX_TEMPLATE) return { error: `El mensaje admite como máximo ${MAX_TEMPLATE} caracteres` };
  if (!Array.isArray(b.phoneColumns) || b.phoneColumns.length === 0 || b.phoneColumns.length > MAX_PHONE_COLUMNS) {
    return { error: `Elige entre 1 y ${MAX_PHONE_COLUMNS} columnas de teléfono` };
  }
  const phoneColumns: string[] = [];
  for (const c of b.phoneColumns) {
    if (typeof c !== 'string' || !c.trim() || c.length > 128) return { error: 'Columna de teléfono inválida' };
    if (!phoneColumns.includes(c.trim())) phoneColumns.push(c.trim());
  }
  if (!Array.isArray(b.sources) || b.sources.length === 0 || b.sources.length > MAX_SOURCES) {
    return { error: `sources debe tener entre 1 y ${MAX_SOURCES} archivos` };
  }
  const seen = new Set<string>();
  const sources: PublishSource[] = [];
  let total = 0;
  for (const s of b.sources) {
    const r = (s ?? {}) as Record<string, unknown>;
    if (typeof r.key !== 'string' || typeof r.etag !== 'string' || !r.etag) return { error: 'Archivo inválido' };
    if (seen.has(r.key)) return { error: 'Archivo repetido' };
    seen.add(r.key);
    if (!Array.isArray(r.rows)) return { error: 'Filas inválidas' };
    const rows = [...new Set(r.rows as unknown[])];
    if (!rows.every((i): i is number => Number.isInteger(i) && (i as number) >= 0)) return { error: 'Filas inválidas' };
    total += rows.length;
    sources.push({ key: r.key, etag: r.etag, rows: (rows as number[]).sort((x, y) => x - y) });
  }
  if (total === 0) return { error: 'Selecciona al menos una fila' };
  if (total > MAX_ROWS) return { error: `Selecciona como máximo ${MAX_ROWS.toLocaleString('es-MX')} filas` };
  let phoneMode: PhoneMode = 'all';
  if (b.phoneMode !== undefined) {
    if (typeof b.phoneMode !== 'string' || !(PHONE_MODES as readonly string[]).includes(b.phoneMode)) return { error: 'Modo de teléfono inválido' };
    phoneMode = b.phoneMode as PhoneMode;
  }
  const overrides: Record<string, string> = {};
  if (b.overrides !== undefined) {
    if (!b.overrides || typeof b.overrides !== 'object' || Array.isArray(b.overrides)) return { error: 'Teléfonos elegidos inválidos' };
    const entries = Object.entries(b.overrides as Record<string, unknown>);
    if (entries.length > total) return { error: 'Teléfonos elegidos inválidos' };
    for (const [rowKey, phone] of entries) {
      const rk = parseRowKey(rowKey);
      if (!rk || typeof phone !== 'string' || !phone.trim() || phone.length > 32) return { error: 'Teléfonos elegidos inválidos' };
      const src = sources.find((x) => x.key === rk.key);
      if (!src || !src.rows.includes(rk.index)) return { error: `Teléfono elegido para una fila no seleccionada: ${rk.index + 1}` };
      overrides[rowKey] = phone.trim();
    }
  }
  return { publishId: b.publishId, template: b.template, phoneColumns, phoneMode, sources, overrides };
}

export interface PublicationManifest {
  schemaVersion: 1;
  publishId: string;
  campaign: string;
  agent: string;
  publishedAt: string;
  template: string;
  phoneColumns: string[];
  phoneMode?: PhoneMode;
  /** Contactos (filas) del archivo publicado. */
  contacts: number;
  /** Filas seleccionadas de las fuentes. */
  rows: number;
  key: string;
  historicKey: string;
  uploadIds: string[];
  sources: Array<{ key: string; rows: number; remaining: number; action: 'rewritten' | 'deleted' }>;
}

const parseBody = (event: AgentEvent): unknown => {
  if (event.body == null || event.body === '') return undefined;
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
  } catch {
    return undefined;
  }
};

async function readManifest(key: string): Promise<PublicationManifest | null> {
  const obj = await getText(key);
  if (obj.text === undefined) return null;
  try {
    return JSON.parse(obj.text) as PublicationManifest;
  } catch {
    return null;
  }
}

const put = async (key: string, body: string, ifMatch?: string): Promise<void> => {
  await s3.send(new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: body, ContentType: 'text/csv', ...(ifMatch ? { IfMatch: ifMatch } : {}) }));
};
const del = async (key: string): Promise<void> => {
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
};

/** POST /agent/assignments/{campaign}/publish */
export const publishAssignments = async (event: AgentEvent): Promise<Result | AgentAuthResponse> => {
  const a = await authorize(event, 'POST /agent/assignments/publish');
  if (!a.ok) return a.response;
  const body = parseBody(event);
  if (body === undefined) return fail(400, 'Body inválido');
  const req = parsePublishBody(body);
  if ('error' in req) return fail(400, req.error);
  if (!req.sources.every((s) => isOwnPendingKey(s.key, a.campaign, a.agent))) return notAllowed();

  const ctx = { evt: 'agent_publish', campaign: a.campaign, agent: a.agent, publishId: req.publishId };
  const mKey = publicationKey(a.campaign, a.agent, req.publishId);
  try {
    const existing = await readManifest(mKey);
    if (existing) {
      console.log(JSON.stringify({ ...ctx, status: 'duplicate' }));
      return ok(existing);
    }

    // 1. Fuentes sin cambios desde la lectura del agente.
    const originals: Array<{ key: string; text: string; etag: string }> = [];
    for (const s of req.sources) {
      let obj;
      try {
        obj = await readPending(s.key);
      } catch (e) {
        if ((e as Error)?.name === 'TooLarge') return fail(413, 'Archivo demasiado grande');
        throw e;
      }
      if (!obj || obj.etag !== s.etag) return fail(409, CHANGED_MESSAGE);
      if (isStaleSource(s.key, obj.lastModified)) return fail(400, STALE_MESSAGE);
      originals.push({ key: s.key, text: obj.text, etag: obj.etag });
    }
    const parsed = originals.map((o) => parseAssignmentCsv(o.text));

    // 2. Archivo publicado (teléfonos, render, formato del CLI).
    let built: BuiltPublication;
    try {
      built = buildPublication(
        parsed,
        req.sources.map((s) => s.rows),
        req.template,
        req.phoneColumns,
        { phoneMode: req.phoneMode, overrides: overridesBySource(req) },
      );
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err?.status === 400) return fail(400, err.message ?? 'Solicitud inválida');
      throw e;
    }
    const csv = serializeCsv(built.header, built.rows);
    const ts = makeTimestampForKey();
    const key = `agents/${a.campaign}/${a.agent}-contacts-${ts}.csv`;
    const historicKey = `historic/agents/${a.campaign}/${a.agent}-contacts-${ts}.csv`;

    const written: string[] = [];
    const touched: Array<{ key: string; text: string }> = [];
    const rollback = async (stage: string, e: unknown): Promise<Result> => {
      for (const k of written) await del(k).catch(() => undefined);
      for (const t of touched) await put(t.key, t.text).catch(() => undefined);
      console.error(JSON.stringify({ ...ctx, status: 'rollback', stage, error: (e as Error)?.name ?? 'Error', written: written.length, restored: touched.length }));
      return fail(500, 'Error interno del servidor');
    };

    try {
      await put(key, csv);
      written.push(key);
      await put(historicKey, csv);
      written.push(historicKey);
    } catch (e) {
      return await rollback('publish', e);
    }

    // 3. Consumo de las filas publicadas en cada fuente.
    const sourcesOut: PublicationManifest['sources'] = [];
    for (let i = 0; i < req.sources.length; i++) {
      const s = req.sources[i]!;
      const p = parsed[i]!;
      const selected = new Set(s.rows);
      const rest = p.rows.filter((r) => !selected.has(r.index));
      const keep = rest.some((r) => r.valid) ? rest : [];
      try {
        if (keep.length > 0) {
          await put(s.key, [p.headerRaw, ...keep.map((r) => r.raw)].join('\n') + '\n', s.etag);
          sourcesOut.push({ key: s.key, rows: s.rows.length, remaining: keep.length, action: 'rewritten' });
        } else {
          await del(s.key);
          sourcesOut.push({ key: s.key, rows: s.rows.length, remaining: 0, action: 'deleted' });
        }
        touched.push({ key: s.key, text: originals[i]!.text });
      } catch (e) {
        return await rollback('consume', e);
      }
    }

    const manifest: PublicationManifest = {
      schemaVersion: 1,
      publishId: req.publishId,
      campaign: a.campaign,
      agent: a.agent,
      publishedAt: new Date().toISOString(),
      template: req.template,
      phoneColumns: req.phoneColumns,
      phoneMode: req.phoneMode,
      contacts: built.rows.length,
      rows: req.sources.reduce((n, s) => n + s.rows.length, 0),
      key,
      historicKey,
      uploadIds: built.uploadIds,
      sources: sourcesOut,
    };
    try {
      await putJson(mKey, manifest);
    } catch (e) {
      // Best-effort (design D3): la publicación ya está completa.
      console.error(JSON.stringify({ ...ctx, status: 'manifest_failed', error: (e as Error)?.name ?? 'Error' }));
    }
    console.log(JSON.stringify({ ...ctx, status: 'completed', sources: sourcesOut.length, rows: manifest.rows, contacts: manifest.contacts }));
    return ok(manifest);
  } catch (e) {
    return internal('publishAssignments', e);
  }
};

/** GET /agent/assignments/{campaign}/publications */
export const listPublications = async (event: AgentEvent): Promise<Result | AgentAuthResponse> => {
  const a = await authorize(event, 'GET /agent/assignments/publications');
  if (!a.ok) return a.response;
  try {
    const prefix = `agent-publications/${a.campaign}/${a.agent}/`;
    const objects: Array<{ key: string; lastModified: number }> = [];
    let token: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketName(), Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) {
        if (o.Key?.endsWith('.json') && !o.Key.slice(prefix.length).includes('/')) objects.push({ key: o.Key, lastModified: o.LastModified?.getTime() ?? 0 });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    objects.sort((x, y) => y.lastModified - x.lastModified);
    const items: PublicationManifest[] = [];
    for (const o of objects.slice(0, HISTORY_LIMIT)) {
      const m = await readManifest(o.key);
      if (m) items.push(m);
    }
    items.sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt)));
    return ok({ campaign: a.campaign, agent: a.agent, items });
  } catch (e) {
    return internal('listPublications', e);
  }
};
