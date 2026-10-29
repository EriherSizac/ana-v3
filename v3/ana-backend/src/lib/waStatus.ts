import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Registro de estado de WhatsApp por teléfono (add-whatsapp-status-registry,
 * spec v3/whatsapp-status-registry). Tabla DynamoDB `WA_STATUS_TABLE`, llave
 * `phone` = MX normalizado `52` + 10 dígitos (design D1–D2).
 *
 * Escritura (D3): "el más nuevo gana" con expresiones condicionales; un
 * reintento con la misma fecha nunca cuenta dos veces. Lectura (D6):
 * BatchGetItem en bloques de 100 con reintento de `UnprocessedKeys`.
 * Los logs nunca llevan teléfonos.
 */

export const WA_STATUSES = ['no_whatsapp', 'has_whatsapp'] as const;
export type WaStatus = (typeof WA_STATUSES)[number];
export type WaSource = 'cli_send' | 'agent_manual' | 'admin_manual' | 'v4_desktop';

export const MAX_LOOKUP = 2000;
export const MAX_MARK = 500;
export const BATCH_GET_SIZE = 100;
export const MAX_NOTE = 200;
const LOOKUP_CONCURRENCY = 4;
const WRITE_CONCURRENCY = 8;
const MAX_UNPROCESSED_RETRIES = 5;

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }), {
  marshallOptions: { removeUndefinedValues: true },
});
export const waTableName = (): string => process.env.WA_STATUS_TABLE || '';

/** Error de lectura incompleta (quedaron llaves sin procesar tras los reintentos). */
export class WaLookupIncompleteError extends Error {
  constructor() {
    super('wa_status_lookup_incomplete');
    this.name = 'WaLookupIncompleteError';
  }
}

// ── Normalización (D2) ───────────────────────────────────────────────────

/**
 * `52` + 10 dígitos o null. 10 (nacional), 12 (`52` + 10) o 13 (`521` + 10);
 * misma semántica que `parseMxPhone` del CLI. Otras longitudes no se registran.
 */
export function normalizeWaPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10) return `52${d}`;
  if (d.length === 12 && d.startsWith('52')) return d;
  if (d.length === 13 && d.startsWith('521')) return `52${d.slice(3)}`;
  return null;
}

export const isWaStatus = (v: unknown): v is WaStatus => typeof v === 'string' && (WA_STATUSES as readonly string[]).includes(v);

export const cleanNote = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, MAX_NOTE) : null;
};

// ── Escritura (D3) ───────────────────────────────────────────────────────

export interface WaEvent {
  /** Teléfono ya normalizado (`normalizeWaPhone`). */
  phone: string;
  status: WaStatus;
  /** Fecha del evento, ISO UTC (`toISOString`). */
  at: string;
  by: string;
  source: WaSource;
  campaign: string;
  /** Solo marcas manuales: `null` borra la nota anterior. */
  note?: string | null;
}

const isConditionFailed = (e: unknown): boolean => (e as { name?: string })?.name === 'ConditionalCheckFailedException';

/**
 * Aplica un evento. Devuelve `applied` si cambió el estado, `counted` si solo
 * actualizó contador/fecha (evento más viejo) o `skipped` (reintento o más viejo).
 */
export async function applyWaEvent(ev: WaEvent): Promise<'applied' | 'counted' | 'skipped'> {
  const noWa = ev.status === 'no_whatsapp';
  const names: Record<string, string> = { '#phone': 'phone', '#status': 'status', '#updatedAt': 'updatedAt', '#updatedBy': 'updatedBy', '#source': 'source', '#campaign': 'campaign' };
  const values: Record<string, unknown> = { ':status': ev.status, ':t': ev.at, ':by': ev.by, ':source': ev.source, ':campaign': ev.campaign };
  const set = ['#status = :status', '#updatedAt = :t', '#updatedBy = :by', '#source = :source', '#campaign = :campaign'];
  const remove: string[] = [];
  let add = '';
  if (noWa) {
    names['#lastNoWaAt'] = 'lastNoWaAt';
    names['#noWaCount'] = 'noWaCount';
    set.push('#lastNoWaAt = :t');
    values[':one'] = 1;
    add = ' ADD #noWaCount :one';
  } else if (ev.source === 'cli_send') {
    names['#lastSentAt'] = 'lastSentAt';
    set.push('#lastSentAt = :t');
  }
  if (ev.note !== undefined) {
    names['#note'] = 'note';
    if (ev.note) {
      set.push('#note = :note');
      values[':note'] = ev.note;
    } else remove.push('#note');
  }
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: waTableName(),
        Key: { phone: ev.phone },
        ConditionExpression: 'attribute_not_exists(#phone) OR #updatedAt < :t',
        UpdateExpression: `SET ${set.join(', ')}${remove.length ? ` REMOVE ${remove.join(', ')}` : ''}${add}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return 'applied';
  } catch (e) {
    if (!isConditionFailed(e)) throw e;
  }
  // Evento más viejo que el estado vigente: solo contador/fecha si es nuevo para ellos.
  const field = noWa ? 'lastNoWaAt' : ev.source === 'cli_send' ? 'lastSentAt' : null;
  if (!field) return 'skipped';
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: waTableName(),
        Key: { phone: ev.phone },
        ConditionExpression: `attribute_not_exists(#f) OR #f < :t`,
        UpdateExpression: noWa ? 'SET #f = :t ADD #noWaCount :one' : 'SET #f = :t',
        ExpressionAttributeNames: noWa ? { '#f': field, '#noWaCount': 'noWaCount' } : { '#f': field },
        ExpressionAttributeValues: noWa ? { ':t': ev.at, ':one': 1 } : { ':t': ev.at },
      }),
    );
    return 'counted';
  } catch (e) {
    if (isConditionFailed(e)) return 'skipped';
    throw e;
  }
}

/** Ejecuta `fn` sobre `list` con concurrencia limitada. */
async function eachLimit<T>(list: readonly T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < list.length) await fn(list[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}

export interface ResultLike {
  phone: string;
  status: string;
  sentAt: string;
}

/**
 * Eventos del registro a partir de resultados del CLI (D4): `no_whatsapp` → `no_whatsapp`,
 * `sent` → `has_whatsapp`; el resto o teléfonos no MX se ignoran. Ordenados por fecha.
 */
export function eventsFromResults(items: readonly ResultLike[], campaign: string, agent: string): WaEvent[] {
  const out: WaEvent[] = [];
  for (const it of items) {
    const status: WaStatus | null = it.status === 'no_whatsapp' ? 'no_whatsapp' : it.status === 'sent' ? 'has_whatsapp' : null;
    const phone = normalizeWaPhone(it.phone);
    if (!status || !phone) continue;
    out.push({ phone, status, at: it.sentAt, by: agent, source: 'cli_send', campaign, note: null });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Aplica eventos con concurrencia; devuelve conteos. Lanza el primer error tras intentar todos. */
export async function applyWaEvents(events: readonly WaEvent[]): Promise<{ applied: number; counted: number; skipped: number; failed: number }> {
  const res = { applied: 0, counted: 0, skipped: 0, failed: 0 };
  let firstError: unknown = null;
  await eachLimit(events, WRITE_CONCURRENCY, async (ev) => {
    try {
      res[await applyWaEvent(ev)]++;
    } catch (e) {
      res.failed++;
      firstError ??= e;
    }
  });
  if (firstError) throw Object.assign(firstError as object, { waCounts: res });
  return res;
}

/**
 * Registra los resultados del CLI sin propagar errores (D4): el lote de
 * resultados se acepta aunque el registro falle.
 */
export async function recordResults(items: readonly ResultLike[], campaign: string, agent: string): Promise<void> {
  const events = eventsFromResults(items, campaign, agent);
  if (events.length === 0 || !waTableName()) return;
  try {
    const r = await applyWaEvents(events);
    console.log(JSON.stringify({ evt: 'wa_status_results', campaign, agent, ...r }));
  } catch (e) {
    console.error(JSON.stringify({ evt: 'wa_status_error', context: 'recordResults', campaign, agent, name: (e as Error)?.name ?? 'Error', ...((e as { waCounts?: object })?.waCounts ?? {}) }));
  }
}

// ── Marca manual (D5) ────────────────────────────────────────────────────

export interface MarkInput {
  campaign: string;
  phones: string[];
  rejected: Array<{ index: number; reason: string }>;
  status: WaStatus;
  note: string | null;
}

/** Valida el body de una marca manual. `{error}` si no se puede atender. */
export function parseMarkBody(body: unknown, campaign: string): MarkInput | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body inválido' };
  const b = body as Record<string, unknown>;
  if (!isWaStatus(b.status)) return { error: 'status inválido' };
  if (!Array.isArray(b.phones) || b.phones.length === 0 || b.phones.length > MAX_MARK) return { error: `phones debe tener entre 1 y ${MAX_MARK} elementos` };
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') return { error: 'note inválida' };
  const phones: string[] = [];
  const rejected: MarkInput['rejected'] = [];
  b.phones.forEach((raw, index) => {
    const p = normalizeWaPhone(raw);
    if (!p) rejected.push({ index, reason: 'phone inválido' });
    else if (!phones.includes(p)) phones.push(p);
  });
  return { campaign, phones, rejected, status: b.status, note: cleanNote(b.note) };
}

/** Marca manual con la hora del servidor. */
export async function markWaStatus(input: MarkInput, by: string, source: WaSource, now = new Date()): Promise<number> {
  const at = now.toISOString();
  const events = input.phones.map((phone) => ({ phone, status: input.status, at, by, source, campaign: input.campaign, note: input.note }));
  const r = await applyWaEvents(events);
  return r.applied + r.counted;
}

// ── Consulta (D6) ────────────────────────────────────────────────────────

export interface WaRecord {
  status: WaStatus;
  updatedAt: string;
  updatedBy: string;
  source: WaSource | string;
  lastNoWaAt: string | null;
  noWaCount: number;
}

/** Teléfonos de la consulta normalizados y sin repetir. `{error}` si el body no cumple. */
export function parseLookupBody(body: unknown): { phones: string[] } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body inválido' };
  const raw = (body as Record<string, unknown>).phones;
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'phones requerido' };
  if (raw.length > MAX_LOOKUP) return { error: `Máximo ${MAX_LOOKUP} teléfonos por consulta` };
  const set = new Set<string>();
  for (const r of raw) {
    const p = normalizeWaPhone(r);
    if (p) set.add(p);
  }
  return { phones: [...set] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toRecord = (it: Record<string, unknown>): WaRecord | null => {
  if (!isWaStatus(it.status)) return null;
  return {
    status: it.status,
    updatedAt: String(it.updatedAt ?? ''),
    updatedBy: String(it.updatedBy ?? ''),
    source: String(it.source ?? ''),
    lastNoWaAt: typeof it.lastNoWaAt === 'string' ? it.lastNoWaAt : null,
    noWaCount: typeof it.noWaCount === 'number' ? it.noWaCount : Number(it.noWaCount ?? 0) || 0,
  };
};

/** Un bloque (≤ 100) con reintentos de `UnprocessedKeys`. */
async function batchGetChunk(phones: readonly string[], out: Record<string, WaRecord>, backoffMs: number): Promise<void> {
  const table = waTableName();
  let keys: Array<Record<string, unknown>> = phones.map((phone) => ({ phone }));
  for (let attempt = 0; keys.length > 0; attempt++) {
    if (attempt > MAX_UNPROCESSED_RETRIES) throw new WaLookupIncompleteError();
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * backoffMs));
    const res = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [table]: {
            Keys: keys,
            ProjectionExpression: '#p, #s, #ua, #ub, #src, #ln, #nc',
            ExpressionAttributeNames: { '#p': 'phone', '#s': 'status', '#ua': 'updatedAt', '#ub': 'updatedBy', '#src': 'source', '#ln': 'lastNoWaAt', '#nc': 'noWaCount' },
          },
        },
      }),
    );
    for (const it of res.Responses?.[table] ?? []) {
      const rec = toRecord(it);
      if (rec && typeof it.phone === 'string') out[it.phone] = rec;
    }
    keys = (res.UnprocessedKeys?.[table]?.Keys as Array<Record<string, unknown>> | undefined) ?? [];
  }
}

/** Estado de los teléfonos (ya normalizados). Solo devuelve los que tienen registro. */
export async function lookupWaStatus(phones: readonly string[], opts: { backoffMs?: number } = {}): Promise<Record<string, WaRecord>> {
  const out: Record<string, WaRecord> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < phones.length; i += BATCH_GET_SIZE) chunks.push(phones.slice(i, i + BATCH_GET_SIZE));
  await eachLimit(chunks, LOOKUP_CONCURRENCY, (c) => batchGetChunk(c, out, opts.backoffMs ?? 50));
  return out;
}
