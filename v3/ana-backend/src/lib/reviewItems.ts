import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { normalizeKeySegment } from './campaign';
import { bucketName, getText, isConditionalConflict, putJsonConditional, s3 } from './s3Json';

/**
 * Contactos "por revisar" (link-review-contacts-to-uploads D2/D3).
 *  review/{campaign}/{agent}/{assignmentId}.csv        (lo escribe report-pending-progress; aquí solo se LEE)
 *  review-state/{campaign}/{agent}/{assignmentId}.json (estados; escritura condicional)
 */

export const UPLOAD_ID_COLUMN = 'ana_upload_id';
export const STATE_WRITE_RETRIES = 3;
const PHONE_COLUMNS = ['phone_number', 'contact_phone', 'contact_pho', 'phone'];
const REVIEW_KEY_RE = /^review\/([^/]+)\/([^/]+)\/([A-Za-z0-9_-]{1,64})\.csv$/;

export type ReviewState = 'pending' | 'reassigned' | 'discarded';

export interface StateEntry {
  state: 'reassigned' | 'discarded';
  by: string;
  at: string;
  reassignUploadId?: string;
  targetAgent?: string;
}

export interface StateDoc {
  schemaVersion: 1;
  items: Record<string, StateEntry>;
}

export interface ReviewItem {
  agent: string;
  assignmentId: string;
  phone: string;
  row: Record<string, string> | null;
  parseError?: boolean;
  state: ReviewState;
  stateBy: string | null;
  stateAt: string | null;
  reassignUploadId: string | null;
  targetAgent: string | null;
}

export const stateKey = (campaign: string, agent: string, assignmentId: string) => `review-state/${campaign}/${agent}/${assignmentId}.json`;
export const reviewKey = (campaign: string, agent: string, assignmentId: string) => `review/${campaign}/${agent}/${assignmentId}.csv`;
export const phoneDigits = (p: unknown): string => String(p ?? '').replace(/\D/g, '');

export class ReviewConflictError extends Error {
  constructor(message = 'Los contactos cambiaron, intenta de nuevo') {
    super(message);
    this.name = 'ReviewConflictError';
  }
}

/** Línea CSV con comillas (mismo criterio que el parser del CLI). */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else current += ch;
  }
  values.push(current.trim());
  return values;
}

/** Filas del CSV de review/. Una fila que no parsea (columnas ≠ encabezado) → `row:null`. */
export function parseReviewCsv(text: string): Array<{ row: Record<string, string> | null; raw: string }> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!);
  return lines.slice(1).map((raw) => {
    const values = parseCsvLine(raw);
    if (values.length !== headers.length) return { row: null, raw };
    return { row: Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])), raw };
  });
}

/** Teléfono de una fila (alias del CLI); para filas ilegibles, primer bloque de ≥ 10 dígitos de la línea. */
function rowPhone(row: Record<string, string> | null, raw: string): string {
  if (row) {
    for (const c of PHONE_COLUMNS) if (row[c]) return row[c]!;
    return '';
  }
  return /\d{10,}/.exec(raw)?.[0] ?? '';
}

const rowUploadId = (row: Record<string, string> | null, raw: string): string | null => {
  if (row) {
    const k = Object.keys(row).find((h) => h.toLowerCase() === UPLOAD_ID_COLUMN);
    return k ? row[k]!.trim() || null : null;
  }
  // Fila ilegible: el uploadId va al final de la línea (última columna).
  const last = raw.split(',').pop()?.trim() ?? '';
  return /^[A-Za-z0-9-]{8,64}$/.test(last) && /\d{8}T\d+-[0-9a-f]+/i.test(last) ? last : null;
};

export async function readStateDoc(campaign: string, agent: string, assignmentId: string): Promise<{ doc: StateDoc; etag: string | null }> {
  const obj = await getText(stateKey(campaign, agent, assignmentId));
  if (obj.text === undefined) return { doc: { schemaVersion: 1, items: {} }, etag: null };
  try {
    const data = JSON.parse(obj.text);
    if (data?.schemaVersion !== 1 || typeof data.items !== 'object') throw new Error('versión');
    return { doc: data as StateDoc, etag: obj.etag };
  } catch {
    throw new Error(`review-state ilegible: ${stateKey(campaign, agent, assignmentId)}`);
  }
}

/** Lista `review/{campaign}/` (paginado) → llaves por (agente, asignación). */
export async function listReviewObjects(campaign: string): Promise<Array<{ agent: string; assignmentId: string; key: string }>> {
  const out: Array<{ agent: string; assignmentId: string; key: string }> = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketName(), Prefix: `review/${campaign}/`, ContinuationToken: token }));
    for (const o of res.Contents ?? []) {
      const m = o.Key ? REVIEW_KEY_RE.exec(o.Key) : null;
      if (m && m[1] === campaign) out.push({ agent: m[2]!, assignmentId: m[3]!, key: o.Key! });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Todas las filas por revisar de la campaña con su estado. */
export async function readAllReviewItems(campaign: string): Promise<Array<ReviewItem & { uploadId: string | null }>> {
  const objects = await listReviewObjects(campaign);
  const items: Array<ReviewItem & { uploadId: string | null }> = [];
  for (const o of objects) {
    const obj = await getText(o.key);
    if (obj.text === undefined) continue;
    const { doc } = await readStateDoc(campaign, o.agent, o.assignmentId);
    for (const { row, raw } of parseReviewCsv(obj.text)) {
      const phone = rowPhone(row, raw);
      const st = doc.items[phoneDigits(phone)];
      items.push({
        agent: o.agent,
        assignmentId: o.assignmentId,
        phone,
        row,
        ...(row ? {} : { parseError: true }),
        state: st?.state ?? 'pending',
        stateBy: st?.by ?? null,
        stateAt: st?.at ?? null,
        reassignUploadId: st?.reassignUploadId ?? null,
        targetAgent: st?.targetAgent ?? null,
        uploadId: rowUploadId(row, raw),
      });
    }
  }
  return items;
}

/** Filtra por carga (`uploadId`) o `none` (sin columna o vacía). */
export async function listReviewItems(campaign: string, uploadId: string): Promise<ReviewItem[]> {
  const all = await readAllReviewItems(campaign);
  return all
    .filter((i) => (uploadId === 'none' ? !i.uploadId : i.uploadId === uploadId))
    .map(({ uploadId: _u, ...rest }) => rest);
}

export interface ItemRef {
  agent: string;
  assignmentId: string;
  phone: string;
}

/**
 * Aplica estados con escritura condicional por (agente, asignación), hasta 3
 * intentos cada uno. `apply` decide el nuevo estado de cada teléfono sobre el
 * estado vigente (puede lanzar para abortar sin escribir).
 */
export async function writeStates(
  campaign: string,
  refs: ItemRef[],
  apply: (current: StateEntry | undefined, ref: ItemRef) => StateEntry | null,
): Promise<void> {
  const groups = new Map<string, ItemRef[]>();
  for (const r of refs) {
    const k = `${normalizeKeySegment(r.agent)}/${r.assignmentId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  for (const [, group] of groups) {
    const { agent, assignmentId } = group[0]!;
    let done = false;
    for (let attempt = 0; attempt < STATE_WRITE_RETRIES && !done; attempt++) {
      const { doc, etag } = await readStateDoc(campaign, agent, assignmentId);
      const next: StateDoc = { schemaVersion: 1, items: { ...doc.items } };
      let changed = false;
      for (const ref of group) {
        const d = phoneDigits(ref.phone);
        const entry = apply(next.items[d], ref);
        if (entry) {
          next.items[d] = entry;
          changed = true;
        }
      }
      if (!changed) {
        done = true;
        break;
      }
      try {
        await putJsonConditional(stateKey(campaign, agent, assignmentId), next, etag);
        done = true;
      } catch (e) {
        if (!isConditionalConflict(e)) throw e;
      }
    }
    if (!done) throw new ReviewConflictError();
  }
}
