import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { normalizeKeySegment } from './campaign';
import { bucketName, getText, s3 } from './s3Json';

/**
 * Historial legado de chats (add-legacy-chat-history), solo lectura.
 *  legacy/backups/{campaign}/{agent}/{phone}/chat_backup.json
 *  legacy/media/{campaign}/{agent}/{filename}
 *  legacy/index/{campaign}.json   (lo genera scripts/build-legacy-chat-index.ts)
 *  legacy/agents/{campaign}.json  (lo extrae migrate-cli-to-cognito-login)
 */

export const PAGE_SIZE = 50;
export const MEDIA_URL_TTL_S = 300;

export const indexKey = (campaign: string) => `legacy/index/${campaign}.json`;
export const legacyAgentsKey = (campaign: string) => `legacy/agents/${campaign}.json`;
export const backupKey = (campaign: string, agent: string, phone: string) => `legacy/backups/${campaign}/${agent}/${phone}/chat_backup.json`;

export interface IndexEntry {
  agent: string;
  phone: string;
  totalMessages: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
}

export interface LegacyIndex {
  schemaVersion: 1;
  generatedAt: string;
  conversations: IndexEntry[];
}

export class LegacyDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyDataError';
  }
}

export class InvalidFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFilterError';
  }
}

// ── Fechas de los mensajes ────────────────────────────────────────────────
//
// Los CLIs guardaron `timestamp` como epoch (ms), ISO o el texto de WhatsApp
// Web `data-pre-plain-text` ("10:30 a. m., 5/9/2026" o "10:30, 5/9/2026",
// día/mes/año, hora de Ciudad de México). Lo no reconocible → null.

const MX_OFFSET_FALLBACK = '-06:00';

function mxOffset(year: number, month: number, day: number): string {
  // Desde 2022 México centro no tiene horario de verano: UTC-6. Antes, aproximado con Intl.
  try {
    const d = new Date(Date.UTC(year, month - 1, day, 12));
    const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', timeZoneName: 'longOffset' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part ?? '');
    return m ? `${m[1]}:${m[2] ?? '00'}` : MX_OFFSET_FALLBACK;
  } catch {
    return MX_OFFSET_FALLBACK;
  }
}

export function parseMessageTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();
  if (/^\d{10,13}$/.test(s)) return parseMessageTime(Number(s));
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*(?:m\.?)?\s*,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/i.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'p' && hour < 12) hour += 12;
  if (ampm === 'a' && hour === 12) hour = 0;
  const day = Number(m[4]);
  const month = Number(m[5]);
  let year = Number(m[6]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const t = Date.parse(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${mxOffset(year, month, day)}`);
  return Number.isFinite(t) ? t : null;
}

// ── Índice ────────────────────────────────────────────────────────────────

/** Entrada del índice para un respaldo (ilegible → 0 mensajes y fechas null). */
export function indexEntry(agent: string, phone: string, text: string | undefined): IndexEntry {
  let messages: unknown[] = [];
  try {
    const data = JSON.parse(text ?? '');
    if (Array.isArray(data?.messages)) messages = data.messages;
  } catch {
    return { agent, phone, totalMessages: 0, firstMessageAt: null, lastMessageAt: null };
  }
  const times = messages
    .map((m) => parseMessageTime((m as { timestamp?: unknown })?.timestamp))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  return {
    agent,
    phone,
    totalMessages: messages.length,
    firstMessageAt: times.length ? new Date(times[0]!).toISOString() : null,
    lastMessageAt: times.length ? new Date(times[times.length - 1]!).toISOString() : null,
  };
}

export async function readIndex(campaign: string): Promise<LegacyIndex | null> {
  const obj = await getText(indexKey(campaign));
  if (obj.text === undefined) return null;
  let data: any;
  try {
    data = JSON.parse(obj.text);
  } catch {
    throw new LegacyDataError('índice ilegible');
  }
  if (data?.schemaVersion !== 1 || !Array.isArray(data.conversations)) throw new LegacyDataError('índice de versión no soportada');
  return data as LegacyIndex;
}

export interface SearchFilters {
  agent?: string;
  phone?: string;
  from?: string;
  to?: string;
  page?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida filtros (antes de leer S3). Lanza InvalidFilterError. */
export function validateFilters(q: Record<string, string | undefined>): SearchFilters {
  const f: SearchFilters = {};
  if (q.agent) {
    const a = normalizeKeySegment(q.agent);
    if (!a || a.includes('/')) throw new InvalidFilterError('Agente inválido');
    f.agent = a;
  }
  if (q.phone) {
    const digits = q.phone.replace(/\D/g, '');
    if (!digits) throw new InvalidFilterError('Teléfono inválido');
    f.phone = digits;
  }
  for (const k of ['from', 'to'] as const) {
    const v = q[k];
    if (v) {
      if (!DATE_RE.test(v) || !Number.isFinite(Date.parse(`${v}T00:00:00Z`))) throw new InvalidFilterError(`Fecha inválida: ${k}`);
      f[k] = v;
    }
  }
  if (f.from && f.to && f.from > f.to) throw new InvalidFilterError('from es posterior a to');
  const page = q.page ? Number.parseInt(q.page, 10) : 1;
  if (!Number.isFinite(page) || page < 1) throw new InvalidFilterError('page inválido');
  f.page = page;
  return f;
}

/** Día (YYYY-MM-DD) en Ciudad de México de una fecha ISO. */
const mxDay = (iso: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export function searchIndex(index: LegacyIndex | null, f: SearchFilters) {
  const page = f.page ?? 1;
  let items = index?.conversations ?? [];
  if (f.agent) items = items.filter((c) => normalizeKeySegment(c.agent) === f.agent);
  if (f.phone) items = items.filter((c) => String(c.phone).replace(/\D/g, '').includes(f.phone!));
  if (f.from || f.to) {
    items = items.filter((c) => {
      if (!c.lastMessageAt) return false;
      const d = mxDay(c.lastMessageAt);
      return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    });
  }
  const sorted = [...items].sort((a, b) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')));
  return { total: sorted.length, page, conversations: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

// ── Conversación ──────────────────────────────────────────────────────────

export interface LegacyMedia {
  url: string;
  contentType: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  filename: string;
}

export interface LegacyMessage {
  id: string | null;
  timestamp: string | null;
  from: string | null;
  body: string | null;
  media: LegacyMedia | null;
  /** El mensaje tenía multimedia (aunque `media` sea null por referencia faltante o ajena). */
  hasMedia: boolean;
}

const EXT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
};

/**
 * Llave `legacy/media/{campaign}/...` equivalente a una referencia de media
 * (`https://{bucket}.s3.amazonaws.com/media/...`, `media/...` o `legacy/media/...`).
 * `null` si no resuelve a la campaña consultada (design D3).
 */
export function legacyMediaKey(ref: unknown, campaign: string): string | null {
  if (typeof ref !== 'string' || !ref) return null;
  let path = ref;
  try {
    if (/^https?:\/\//i.test(ref)) path = decodeURIComponent(new URL(ref).pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
  path = path.replace(/^\/+/, '');
  // Path-style: {bucket}/media/...
  const idx = path.search(/(^|\/)(legacy\/)?media\//);
  if (idx < 0) return null;
  path = path.slice(idx).replace(/^\//, '');
  if (!path.startsWith('legacy/')) path = `legacy/${path}`;
  if (path.includes('..') || path.includes('\\')) return null;
  const prefix = `legacy/media/${campaign}/`;
  return path.startsWith(prefix) && path.length > prefix.length ? path : null;
}

function mediaType(key: string, hint: unknown): { contentType: string; kind: LegacyMedia['kind'] } {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  let contentType = EXT_TYPES[ext] ?? 'application/octet-stream';
  const h = typeof hint === 'string' ? hint.toLowerCase() : '';
  if (contentType === 'application/octet-stream' && ['image', 'video', 'audio'].includes(h)) contentType = `${h}/*`;
  const kind = contentType.startsWith('image/') ? 'image' : contentType.startsWith('audio/') ? 'audio' : contentType.startsWith('video/') ? 'video' : 'file';
  return { contentType, kind };
}

/** URL prefirmada de 300 s; tipos que no son imagen/audio/video se sirven como descarga. */
export async function presignMedia(key: string, hint?: unknown): Promise<LegacyMedia> {
  const { contentType, kind } = mediaType(key, hint);
  const filename = key.split('/').pop() ?? 'archivo';
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: key,
      ...(kind === 'file' ? { ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, '_')}"` } : {}),
    }),
    { expiresIn: MEDIA_URL_TTL_S },
  );
  return { url, contentType, kind, filename };
}

const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

/** Mensajes normalizados en orden de `timestamp`, con media prefirmada. `null` si no existe el respaldo. */
export async function readConversation(campaign: string, agent: string, phone: string): Promise<LegacyMessage[] | null> {
  const obj = await getText(backupKey(campaign, agent, phone));
  if (obj.text === undefined) return null;
  let data: any;
  try {
    data = JSON.parse(obj.text);
  } catch {
    throw new LegacyDataError('respaldo ilegible');
  }
  const raw: any[] = Array.isArray(data?.messages) ? data.messages : [];
  const withTime = raw.map((m, i) => ({ m, i, t: parseMessageTime(m?.timestamp) }));
  withTime.sort((a, b) => (a.t ?? Number.MAX_SAFE_INTEGER) - (b.t ?? Number.MAX_SAFE_INTEGER) || a.i - b.i);
  const out: LegacyMessage[] = [];
  for (const { m, t } of withTime) {
    const ref = m?.mediaUrl ?? m?.media_url ?? m?.media?.url ?? m?.media?.key ?? (typeof m?.media === 'string' ? m.media : undefined);
    const key = legacyMediaKey(ref, campaign);
    out.push({
      id: str(m?.id),
      timestamp: t !== null ? new Date(t).toISOString() : str(m?.timestamp),
      from: str(m?.from ?? (m?.type === 'outgoing' || m?.direction === 'outgoing' ? 'me' : m?.type === 'incoming' || m?.direction === 'incoming' ? 'them' : null)),
      body: str(m?.body ?? m?.text),
      media: key ? await presignMedia(key, m?.mediaType) : null,
      hasMedia: !!ref || m?.hasMedia === true,
    });
  }
  return out;
}

export async function readLegacyAgents(campaign: string): Promise<{ agents: string[]; extractedAt: string | null }> {
  const obj = await getText(legacyAgentsKey(campaign));
  if (obj.text === undefined) return { agents: [], extractedAt: null };
  let data: any;
  try {
    data = JSON.parse(obj.text);
  } catch {
    throw new LegacyDataError('lista de agentes legados ilegible');
  }
  // Solo los campos del contrato: nunca se reenvía otro dato aunque exista.
  const agents = Array.isArray(data?.agents) ? data.agents.filter((a: unknown): a is string => typeof a === 'string').map(normalizeKeySegment) : [];
  return { agents: [...new Set(agents as string[])].sort(), extractedAt: typeof data?.extractedAt === 'string' ? data.extractedAt : null };
}
