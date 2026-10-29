import {
  checkFileSize,
  decodeBytes,
  detectPhoneColumn,
  parseCsvText,
  phoneColumnsOf,
  sendColumnError,
  serializeCsv,
  utf8Bytes,
  V3_INLINE_MAX_BYTES,
  validateRows,
  LIMITS,
  type Delimiter,
  type Encoding,
  type Fleet,
  type InvalidReason,
  type ParsedCsv,
  type Validation,
} from './csv';
import { buildPlan, planHash, type Mode, type Plan } from './plan';
import { hasReservedColumn, RESERVED_COLUMN_ERROR, unknownVariableError, variablesResolvingToUploadId } from './reserved';

// Procesamiento de la carga de contactos fuera del hilo de la UI
// (support-crm-base-upload "Procesamiento en segundo plano"): lectura,
// validación y reparto con progreso. Puro: lo usan el Web Worker
// (`contacts.worker.ts`) y, sin Worker (jsdom), el hilo principal.

export type Phase = 'lectura' | 'validación' | 'reparto';
export interface Progress {
  phase: Phase;
  done: number;
  total: number;
}
export type ProgressCallback = (p: Progress) => void;

export interface ReadInput {
  fleet: Fleet;
  /** Bytes de un archivo (se decodifican UTF-8 / Windows-1252). */
  bytes?: Uint8Array;
  /** Texto pegado. */
  text?: string;
  /** Sujeto de los mensajes de error ("El archivo", "El texto pegado"). */
  what?: string;
}

export interface ReadSummary {
  header: string[];
  rows: number;
  delimiter: Delimiter;
  encoding: Encoding | null;
  renamed: string[];
  joinedFields: number;
  convertedDates: number;
  phoneColumns: string[];
  /** Bytes del texto en UTF-8. */
  bytes: number;
}

export interface CheckSummary {
  phoneColumn: string | null;
  phoneError: string | null;
  sendColumnError: string | null;
  reservedError: string | null;
  variableError: string | null;
  total: number;
  validCount: number;
  invalidCount: number;
  /** Primeras 100 filas inválidas. */
  invalid: Array<{ rowNumber: number; reason: InvalidReason }>;
}

export interface PreviewRow {
  rowNumber: number;
  phone: string;
  name: string;
  credit: string;
}

/** Qué se entrega: el texto en la solicitud o, en v3 de más de 4 MB, el CSV maestro por S3. */
export type Payload = { kind: 'inline'; csv: string } | { kind: 's3'; blob: Blob; bytes: number };

export interface PlanSummary {
  plan: Plan;
  hash: string;
  validCount: number;
  /** Primeras 5 filas por agente. */
  samples: Record<string, PreviewRow[]>;
  payload: Payload;
}

/** Nombre visible de una fila (vista previa). */
export const nameOf = (r: Record<string, string>): string =>
  (r.name || r.nombre || r.contact_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.nombre_cliente || '').replace(/ {2,}/g, ' ').trim();
/** Crédito visible (base CRM: id_credito). */
export const creditOf = (r: Record<string, string>): string => r.credit || r.credito || r.credit_id || r.id_credito || '';

const INVALID_SHOWN = 100;
const SAMPLE_ROWS = 5;

/**
 * Estado de una carga: texto, CSV leído y validación vigentes. Las fases se
 * llaman en orden (`read` → `check` → `plan`); cada una reporta progreso.
 */
export class ContactsSession {
  private text = '';
  private textBytes = 0;
  private fleet: Fleet = 'v3';
  private parsed: ParsedCsv | null = null;
  private validation: Validation | null = null;
  private phoneColumn: string | null = null;

  read(input: ReadInput, onProgress?: ProgressCallback): ReadSummary | { error: string } {
    this.parsed = null;
    this.validation = null;
    this.fleet = input.fleet;
    const what = input.what ?? 'El archivo';
    let encoding: Encoding | null = null;
    let text: string;
    if (input.bytes) {
      const sizeError = checkFileSize(input.bytes.length, input.fleet, what);
      if (sizeError) return { error: sizeError };
      const decoded = decodeBytes(input.bytes);
      text = decoded.text;
      encoding = decoded.encoding;
    } else {
      text = input.text?.trim() ? input.text : '';
    }
    // El límite se mide sobre el texto en UTF-8 (lo que recibe el servidor).
    const bytes = utf8Bytes(text);
    const sizeError = checkFileSize(bytes, input.fleet, what);
    if (sizeError) return { error: sizeError };
    onProgress?.({ phase: 'lectura', done: 0, total: 1 });
    const parsed = parseCsvText(text, input.fleet, (done, total) => onProgress?.({ phase: 'lectura', done, total }));
    if ('error' in parsed) return parsed;
    this.text = text;
    this.textBytes = bytes;
    this.parsed = parsed;
    return {
      header: parsed.header,
      rows: parsed.rows.length,
      delimiter: parsed.delimiter,
      encoding,
      renamed: parsed.renamed,
      joinedFields: parsed.joinedFields,
      convertedDates: parsed.convertedDates,
      phoneColumns: phoneColumnsOf(parsed.header),
      bytes,
    };
  }

  check(phoneChoice: string | null, onProgress?: ProgressCallback): CheckSummary | { error: string } {
    const parsed = this.parsed;
    if (!parsed) return { error: 'Carga un archivo válido' };
    const fleet = this.fleet;
    this.validation = null;
    this.phoneColumn = null;
    const empty: CheckSummary = {
      phoneColumn: null,
      phoneError: null,
      sendColumnError: null,
      reservedError: fleet === 'v3' && hasReservedColumn(parsed.header) ? RESERVED_COLUMN_ERROR : null,
      variableError: null,
      total: parsed.rows.length,
      validCount: 0,
      invalidCount: 0,
      invalid: [],
    };
    const phone = detectPhoneColumn(parsed.header, fleet, fleet === 'v4' ? phoneChoice : null);
    if ('error' in phone) return { ...empty, phoneError: phone.error };
    const validation = validateRows(parsed, fleet, phone.column, undefined, (done, total) => onProgress?.({ phase: 'validación', done, total }));
    this.validation = validation;
    this.phoneColumn = phone.column;
    let variableError: string | null = null;
    if (fleet === 'v3' && !empty.reservedError) {
      // Solo la columna message del CSV (quien carga ya no escribe mensaje).
      const col = parsed.header.indexOf('message');
      const texts = col < 0 ? [] : validation.valid.map((r) => r.values[col] ?? '');
      const bad = variablesResolvingToUploadId(texts, parsed.header);
      variableError = bad.length ? unknownVariableError(bad) : null;
    }
    return {
      ...empty,
      phoneColumn: phone.column,
      sendColumnError: sendColumnError(parsed.header, fleet, phone.column),
      variableError,
      validCount: validation.valid.length,
      invalidCount: validation.invalid.length,
      invalid: validation.invalid.slice(0, INVALID_SHOWN),
    };
  }

  async plan(input: { mode: Mode; enabled: readonly string[]; agent?: string | null }, onProgress?: ProgressCallback): Promise<PlanSummary | { error: string }> {
    const parsed = this.parsed;
    const validation = this.validation;
    if (!parsed || !validation) return { error: 'Carga un archivo válido' };
    const fleet = this.fleet;
    const rows = validation.valid;
    onProgress?.({ phase: 'reparto', done: 0, total: rows.length });
    const plan = buildPlan({ fleet, mode: input.mode, enabled: input.enabled, agent: input.agent, rows });
    if ('error' in plan) return plan;
    const hash = await planHash(plan, rows);
    const samples: Record<string, PreviewRow[]> = Object.fromEntries(plan.agents.map((a) => [a, []]));
    for (let i = 0; i < rows.length; i++) {
      const list = samples[plan.assignment[i]!]!;
      if (list.length >= SAMPLE_ROWS) continue;
      const r = rows[i]!;
      list.push({ rowNumber: r.rowNumber, phone: r.phone, name: nameOf(r.record), credit: creditOf(r.record) });
    }
    let payload: Payload;
    if (fleet === 'v3' && this.textBytes > V3_INLINE_MAX_BYTES) {
      // CSV maestro: encabezado + filas válidas en el orden del plan (la Lambda reparte fila i → agente i mod n).
      const csv = serializeCsv(
        parsed.header,
        rows.map((r) => r.values),
      );
      const blob = new Blob([csv], { type: 'text/csv' });
      if (blob.size > LIMITS.v3.maxBytes) return { error: `El archivo supera ${LIMITS.v3.label} para v3` };
      payload = { kind: 's3', blob, bytes: blob.size };
    } else {
      payload = { kind: 'inline', csv: this.text };
    }
    onProgress?.({ phase: 'reparto', done: rows.length, total: rows.length });
    return { plan, hash, validCount: rows.length, samples, payload };
  }

  /** Columna de teléfono de la última validación (v4: `phoneColumn` del presign). */
  get currentPhoneColumn(): string | null {
    return this.phoneColumn;
  }
}

// ── Protocolo del Worker ──────────────────────────────────────────────────

export type WorkerRequest =
  | { id: number; type: 'read'; input: ReadInput }
  | { id: number; type: 'check'; phoneChoice: string | null }
  | { id: number; type: 'plan'; input: { mode: Mode; enabled: string[]; agent?: string | null } };

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: Progress }
  | { id: number; type: 'result'; result: unknown }
  | { id: number; type: 'error'; message: string };

/** Atiende un mensaje con la sesión; lo comparten el Worker y el modo sin Worker. */
export async function handleRequest(session: ContactsSession, req: WorkerRequest, post: (r: WorkerResponse) => void): Promise<void> {
  const progress: ProgressCallback = (p) => post({ id: req.id, type: 'progress', progress: p });
  try {
    let result: unknown;
    if (req.type === 'read') result = session.read(req.input, progress);
    else if (req.type === 'check') result = session.check(req.phoneChoice, progress);
    else result = await session.plan(req.input, progress);
    post({ id: req.id, type: 'result', result });
  } catch (e) {
    post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : 'No se pudo procesar el archivo' });
  }
}
