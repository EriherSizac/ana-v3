/**
 * Registro local (journal) de la asignación en curso (módulo sin efectos al importarse;
 * el directorio de datos se recibe por parámetro).
 *
 * Archivo: <dir>/assignment-journal-<agent>-<campaign>.json
 * { version, agent_id, campaign, received_at, csv_sha256, assignment_id, csv,
 *   rows: [{ index, phone, state }], source_key? }   state: pending | in_flight | done | por_revisar
 *   source_key: llave S3 del archivo entregado (cabecera X-Ana-Assignment-Key,
 *   add-agent-send-history); null si el backend no la envió.
 *
 * Cada cambio de estado reescribe el archivo completo de forma atómica (*.tmp + rename).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseAssignmentCsv } from './assignment-csv.js';

export const JOURNAL_PREFIX = 'assignment-journal-';
export const STATES = Object.freeze({
  PENDING: 'pending',
  IN_FLIGHT: 'in_flight',
  DONE: 'done',
  REVIEW: 'por_revisar',
});

// Segmento de nombre de archivo: mismo criterio que el backend (trim + minúsculas) y
// solo [A-Za-z0-9_-]
export function sanitizeSegment(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^A-Za-z0-9_-]/g, '_');
}

export function journalFileName(agentId, campaign) {
  return `${JOURNAL_PREFIX}${sanitizeSegment(agentId)}-${sanitizeSegment(campaign)}.json`;
}

export function journalPath(dir, agentId, campaign) {
  return path.join(dir, journalFileName(agentId, campaign));
}

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/** `YYYYMMDDTHHMM` (UTC de received_at) + `-` + 8 primeros hex del sha256 del CSV. */
export function computeAssignmentId(receivedAtIso, csvSha256) {
  const compact = String(receivedAtIso).replace(/[-:]/g, '').slice(0, 13);
  return `${compact}-${String(csvSha256).slice(0, 8)}`;
}

function attachPath(journal, filePath) {
  Object.defineProperty(journal, 'filePath', { value: filePath, enumerable: false, writable: true });
  return journal;
}

function writeAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

export function saveJournal(journal) {
  writeAtomic(journal.filePath, journal);
  return journal;
}

/**
 * Crea y guarda el journal de una asignación recién recibida (todo en `pending`).
 * @param {{ dir: string, agentId: string, campaign: string, csvText: string,
 *           rows: Array<{ index: number, phone: string }>, sourceKey?: string|null, now?: Date }} params
 */
export function createJournal({ dir, agentId, campaign, csvText, rows, sourceKey = null, now = new Date() }) {
  const receivedAt = now.toISOString();
  const csvSha = sha256(csvText);
  const journal = attachPath(
    {
      version: 1,
      agent_id: String(agentId ?? ''),
      campaign: String(campaign ?? ''),
      received_at: receivedAt,
      csv_sha256: csvSha,
      assignment_id: computeAssignmentId(receivedAt, csvSha),
      csv: String(csvText ?? ''),
      rows: (rows || []).map((r) => ({ index: r.index, phone: String(r.phone ?? ''), state: STATES.PENDING })),
      source_key: sourceKey ? String(sourceKey) : null,
    },
    journalPath(dir, agentId, campaign)
  );
  return saveJournal(journal);
}

function invalidate(filePath, now) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = filePath.replace(/\.json$/, `.invalid-${stamp}.json`);
  try {
    fs.renameSync(filePath, target);
  } catch (_) {
    // si no se puede renombrar, se deja tal cual; igualmente no se procesa
  }
  return target;
}

/**
 * Carga y verifica el journal del agente/campaña.
 * @returns {{ status: 'none' } | { status: 'invalid', invalidPath: string, reason: string }
 *   | { status: 'ok', journal: object, contacts: object[] }}
 */
export function loadJournal({ dir, agentId, campaign, parse = parseAssignmentCsv, now = new Date() }) {
  const filePath = journalPath(dir, agentId, campaign);
  if (!fs.existsSync(filePath)) return { status: 'none' };

  const fail = (reason) => ({ status: 'invalid', invalidPath: invalidate(filePath, now), reason });

  let journal;
  try {
    journal = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fail('json');
  }
  if (!journal || typeof journal !== 'object' || typeof journal.csv !== 'string' || !Array.isArray(journal.rows)) {
    return fail('estructura');
  }
  if (sha256(journal.csv) !== journal.csv_sha256) return fail('sha256');

  let contacts;
  try {
    contacts = parse(journal.csv);
  } catch (_) {
    return fail('csv');
  }
  if (!Array.isArray(contacts) || contacts.length !== journal.rows.length) return fail('filas');
  const validStates = Object.values(STATES);
  for (let i = 0; i < journal.rows.length; i++) {
    const row = journal.rows[i];
    if (!row || row.index !== i || !validStates.includes(row.state)) return fail('filas');
    if (String(contacts[i]?.phone ?? '') !== String(row.phone ?? '')) return fail('telefono');
  }

  return { status: 'ok', journal: attachPath(journal, filePath), contacts };
}

function setState(journal, index, state) {
  const row = journal.rows.find((r) => r.index === index);
  if (!row) throw new Error(`Fila ${index} no existe en el journal`);
  row.state = state;
  return saveJournal(journal);
}

export const markInFlight = (journal, index) => setState(journal, index, STATES.IN_FLIGHT);
export const markDone = (journal, index) => setState(journal, index, STATES.DONE);
export const markForReview = (journal, index) => setState(journal, index, STATES.REVIEW);

export const pendingRows = (journal) => journal.rows.filter((r) => r.state === STATES.PENDING);
export const inFlightRows = (journal) => journal.rows.filter((r) => r.state === STATES.IN_FLIGHT);
export const reviewRows = (journal) => journal.rows.filter((r) => r.state === STATES.REVIEW);

export function removeJournal(journal) {
  try {
    fs.unlinkSync(journal.filePath);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }
  try {
    fs.unlinkSync(`${journal.filePath}.tmp`);
  } catch (_) {
    // ignore
  }
}

/** Journals (válidos por nombre) de otros agentes/campañas en el directorio. */
export function listOtherJournals(dir, agentId, campaign) {
  const own = journalFileName(agentId, campaign);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  return names.filter(
    (n) => n.startsWith(JOURNAL_PREFIX) && n.endsWith('.json') && !n.includes('.invalid-') && n !== own
  );
}
