/**
 * Bandeja de salida de resultados de envío (add-agent-send-history, design D3;
 * spec v3/agent-send-history "Reporte de resultados desde el CLI" y "Bandeja de
 * salida persistente"). Módulo sin efectos al importarse.
 *
 * Archivo: <dir>/results-outbox-<agent>.json
 *   { version: 1, pending: [item], sent: [id] }
 *
 * - `enqueue` deduplica por `id`, escribe de forma atómica (*.tmp + rename) y
 *   programa un envío sin esperar la red: nunca bloquea ni detiene el envío.
 * - `flush` es de vuelo único; manda lotes de hasta 100 items por campaña a
 *   `POST /agent/results`. 2xx → quita aceptados y rechazados; 400 → descarta
 *   el lote; 401/403/5xx/red → reintento con espera creciente (30 s → 10 min).
 * - Nunca registra teléfonos ni mensajes.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { phone as phoneUtils } from './phone-utils.js';

export const OUTBOX_PREFIX = 'results-outbox-';
export const MAX_BATCH = 100;
export const MAX_PENDING = 5000;
export const MAX_SENT_IDS = 2000;
export const BASE_RETRY_MS = 30_000;
export const MAX_RETRY_MS = 10 * 60_000;
export const PREVIEW_CHARS = 160;
export const STATUSES = Object.freeze(['sent', 'no_whatsapp', 'error', 'por_revisar']);

const sanitize = (v) => String(v ?? '').trim().toLowerCase().replace(/[^A-Za-z0-9_-]/g, '_');

export const outboxFileName = (agentId) => `${OUTBOX_PREFIX}${sanitize(agentId)}.json`;
export const outboxPath = (dir, agentId) => path.join(dir, outboxFileName(agentId));

/** Llave de idempotencia (design D2): una fila se intenta una vez por asignación. */
export const resultId = (assignmentId, rowIndex, attempt = 1) => `${assignmentId}#${rowIndex}#${attempt}`;

/** Código corto del error para el historial. */
export function errorCodeOf(status, error) {
  if (status === 'sent') return null;
  if (status === 'no_whatsapp') return 'no_whatsapp';
  if (status === 'por_revisar') return 'interrupted';
  const msg = String(error || '').toLowerCase();
  if (msg.includes('sin teléfono') || msg.includes('sin telefono')) return 'no_phone';
  if (msg.includes('timeout')) return 'timeout';
  return 'send_error';
}

/**
 * Item de resultado para un contacto de la asignación.
 * @param {{ contact: object, result?: object|null, status?: string, assignmentId: string,
 *   sourceKey?: string|null, campaign: string, attempt?: number, rowIndex?: number, now?: Date }} p
 */
export function buildResultItem({ contact, result, status, assignmentId, sourceKey = null, campaign, attempt = 1, rowIndex: row, now = new Date() }) {
  const c = contact || {};
  const st = STATUSES.includes(status) ? status : STATUSES.includes(result?.status) ? result.status : 'error';
  const rowIndex = Number.isInteger(row) ? row : Number.isInteger(c.__rowIndex) ? c.__rowIndex : 0;
  const message = String(result?.message_sent ?? c.message ?? '');
  const sentAtRaw = result?.sent_at ? Date.parse(result.sent_at) : NaN;
  const error = st === 'sent' ? null : String(result?.error || '').slice(0, 200) || null;
  return {
    id: resultId(assignmentId, rowIndex, attempt),
    campaign: String(campaign || '').trim().toLowerCase(),
    assignmentId,
    sourceKey: sourceKey || null,
    uploadId: String(c.__raw?.ana_upload_id || '').trim() || null,
    rowIndex,
    attempt,
    credit: String(c.credit || '').trim() || null,
    phone: phoneUtils.toWhatsAppUrlPhone(c.phone),
    status: st,
    errorCode: errorCodeOf(st, result?.error),
    error,
    sentAt: new Date(Number.isFinite(sentAtRaw) ? sentAtRaw : now.getTime()).toISOString(),
    messageHash: message ? crypto.createHash('sha256').update(message, 'utf8').digest('hex') : null,
    messagePreview: message ? message.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS) : null,
  };
}

const emptyState = () => ({ version: 1, pending: [], sent: [] });

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!s || !Array.isArray(s.pending) || !Array.isArray(s.sent)) return emptyState();
    return { version: 1, pending: s.pending.filter((i) => i && typeof i.id === 'string'), sent: s.sent.filter((x) => typeof x === 'string') };
  } catch {
    return emptyState();
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/**
 * @param {{ dir: string, agentId: string, post: (campaign: string, items: object[]) => Promise<{status: number, body?: any}>,
 *   logger?: Console, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, now?: () => number }} deps
 *   `post` devuelve el status HTTP (y el body JSON si lo hay); lanza ante error de red.
 */
export function createResultsOutbox({ dir, agentId, post, logger = console, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() }) {
  const file = outboxPath(dir, agentId);
  let state = readState(file);
  let flushing = null;
  let timer = null;
  let failures = 0;
  let nextAttemptAt = 0;
  let stopped = false;

  const save = () => {
    try {
      writeAtomic(file, state);
    } catch (e) {
      logger.error?.(`⚠️  No se pudo guardar la bandeja de resultados: ${e?.code || e?.message || e}`);
    }
  };

  const schedule = (ms) => {
    if (stopped) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      return flush();
    }, Math.max(0, ms));
    timer?.unref?.();
  };

  const backoff = () => {
    failures += 1;
    const ms = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (failures - 1));
    nextAttemptAt = now() + ms;
    schedule(ms);
    return ms;
  };

  const markSent = (ids) => {
    if (ids.size === 0) return;
    state.pending = state.pending.filter((i) => !ids.has(i.id));
    state.sent = [...state.sent.filter((x) => !ids.has(x)), ...ids].slice(-MAX_SENT_IDS);
  };

  /** Encola un resultado (sin red). Devuelve false si ya estaba encolado o enviado. */
  function enqueue(item) {
    if (!item || typeof item.id !== 'string' || !item.campaign) return false;
    if (state.sent.includes(item.id) || state.pending.some((i) => i.id === item.id)) return false;
    state.pending.push(item);
    if (state.pending.length > MAX_PENDING) {
      const dropped = state.pending.length - MAX_PENDING;
      state.pending = state.pending.slice(dropped);
      logger.warn?.(`⚠️  Bandeja de resultados llena: se descartan ${dropped} resultados antiguos`);
    }
    save();
    if (now() >= nextAttemptAt) schedule(0);
    return true;
  }

  async function sendOnce() {
    while (state.pending.length > 0 && !stopped) {
      const campaign = state.pending[0].campaign;
      const batch = state.pending.filter((i) => i.campaign === campaign).slice(0, MAX_BATCH);
      const items = batch.map(({ campaign: _c, ...rest }) => rest);
      let res;
      try {
        res = await post(campaign, items);
      } catch (e) {
        const ms = backoff();
        logger.warn?.(`⚠️  Resultados sin enviar (${state.pending.length}); reintento en ${Math.round(ms / 1000)} s (${e?.cause?.code || e?.name || 'red'})`);
        return;
      }
      const status = Number(res?.status) || 0;
      if (status >= 200 && status < 300) {
        failures = 0;
        nextAttemptAt = 0;
        markSent(new Set(batch.map((i) => i.id)));
        const rejected = Array.isArray(res?.body?.data?.rejected) ? res.body.data.rejected.length : 0;
        if (rejected > 0) logger.warn?.(`⚠️  ${rejected} resultado(s) rechazados por el servidor`);
        save();
        continue;
      }
      if (status === 400 || status === 413) {
        // Lote que el servidor nunca aceptará: se descarta para no bloquear la bandeja.
        markSent(new Set(batch.map((i) => i.id)));
        save();
        logger.warn?.(`⚠️  Lote de ${batch.length} resultado(s) descartado (HTTP ${status})`);
        continue;
      }
      const ms = backoff();
      logger.warn?.(`⚠️  Resultados sin enviar (HTTP ${status}); reintento en ${Math.round(ms / 1000)} s`);
      return;
    }
  }

  /** Envía lo pendiente (vuelo único). Nunca lanza. */
  function flush() {
    if (!flushing) {
      flushing = sendOnce()
        .catch((e) => {
          logger.error?.(`⚠️  Error en la bandeja de resultados: ${e?.message || e}`);
          backoff();
        })
        .finally(() => {
          flushing = null;
        });
    }
    return flushing;
  }

  return {
    enqueue,
    flush,
    /** Envía lo que quedó de una ejecución anterior. */
    start() {
      stopped = false;
      if (state.pending.length > 0) schedule(0);
    },
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
    pendingCount: () => state.pending.length,
    get filePath() {
      return file;
    },
  };
}

/**
 * `post` sobre el cliente del backend v3 (`backend-client.js`).
 * @param {{ fetch: (path: string, init?: object) => Promise<Response> }} backend
 */
export const backendPoster = (backend) => async (campaign, items) => {
  const res = await backend.fetch('/agent/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ campaign, items }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};
