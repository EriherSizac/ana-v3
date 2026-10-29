import Papa from 'papaparse';
import { convertExcelRow, excelDateColumns } from './excelDates';

// Lectura y validación de CSV de contactos (isomórfico: navegador y BFF).
// add-contact-upload-console D1/D2 y spec admin-web/contact-upload.

export type Fleet = 'v3' | 'v4';

export const LIMITS: Record<Fleet, { maxBytes: number; maxRows: number; label: string }> = {
  // support-crm-base-upload "Carga v3 grande por S3": hasta 4 MB viaja en la
  // solicitud; de 4 a 50 MB el CSV maestro se sube a S3 con URL firmada.
  v3: { maxBytes: 50 * 1024 * 1024, maxRows: 200_000, label: '50 MB' },
  // v4: el trigger CSV procesa hasta 50 000 filas; el BFF sube hasta 10 MB.
  v4: { maxBytes: 10 * 1024 * 1024, maxRows: 50_000, label: '10 MB' },
};

/** v3: tamaño máximo (UTF-8) que viaja dentro de la solicitud; arriba se usa S3. */
export const V3_INLINE_MAX_BYTES = 4 * 1024 * 1024;

/** Progreso de lectura, validación o reparto (filas procesadas de `total`). */
export type ProgressFn = (done: number, total: number) => void;
/** Cada cuántas filas se reporta progreso. */
export const PROGRESS_EVERY = 2_000;

/** Alias de teléfono que entiende el parser del CLI v3. */
export const V3_PHONE_COLUMNS = ['phone_number', 'contact_phone', 'contact_pho', 'phone'] as const;
/** v4 además acepta `telefono` (o la columna que elija el usuario). */
export const V4_PHONE_COLUMNS = [...V3_PHONE_COLUMNS, 'telefono'] as const;

/**
 * Columnas de teléfono (support-crm-base-upload): alias, `telefono`,
 * `telefono_N` y `phone_N` (base CRM: telefono_1..3).
 */
export const isPhoneColumnName = (h: string): boolean =>
  (V4_PHONE_COLUMNS as readonly string[]).includes(h) || /^(telefono|phone)_\d+$/.test(h);

/** Columnas de teléfono del encabezado, en orden. */
export const phoneColumnsOf = (header: readonly string[]): string[] => header.filter(isPhoneColumnName);

export interface RawRow {
  /** Número de fila del archivo (el encabezado es la fila 1). */
  rowNumber: number;
  values: string[];
}

export type Delimiter = ',' | ';' | '\t';
export type Encoding = 'UTF-8' | 'Windows-1252';

export interface ParsedCsv {
  header: string[];
  rows: RawRow[];
  delimiter: Delimiter;
  /** Encabezados repetidos renombrados a `nombre.N`. */
  renamed: string[];
  /** Campos con saltos de línea que se unieron en una línea. */
  joinedFields: number;
  /** Números de serie de Excel convertidos a fecha u hora (support-crm-base-upload "Fechas de Excel"). */
  convertedDates: number;
}

export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** UTF-8 estricto; ante bytes inválidos, Windows-1252 (exportes de Excel). */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: Encoding } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

export const DELIMITER_LABEL: Record<Delimiter, string> = { ',': 'coma', ';': 'punto y coma', '\t': 'tabulador' };

/** Delimitador del encabezado: el más frecuente fuera de comillas entre coma, punto y coma y tabulador (empate → coma). */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++;
  }
  let best: Delimiter = ',';
  for (const d of [';', '\t'] as const) if (counts[d] > counts[best]) best = d;
  return best;
}

/** CR/LF dentro de un campo → un espacio (con los espacios de alrededor) y recorte. */
export const joinLines = (v: string): string => v.replace(/\s*[\r\n]\s*/g, ' ').trim();

/** Bytes UTF-8 de un texto. */
export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** Valida tamaño antes de leer. `null` si está dentro de límites. */
export function checkFileSize(bytes: number, fleet: Fleet, what = 'El archivo'): string | null {
  if (bytes === 0) return `${what} está vacío`;
  if (bytes > LIMITS[fleet].maxBytes) return `${what} supera ${LIMITS[fleet].label} para ${fleet}`;
  return null;
}

/** Renombra encabezados repetidos a `nombre.N` (primer N libre, como pandas). */
function dedupeHeader(header: string[]): { header: string[]; renamed: string[] } {
  const used = new Set<string>();
  const renamed: string[] = [];
  const out = header.map((h) => {
    if (!used.has(h) || !h) {
      used.add(h);
      return h;
    }
    let n = 1;
    while (used.has(`${h}.${n}`) || header.includes(`${h}.${n}`)) n++;
    const name = `${h}.${n}`;
    used.add(name);
    renamed.push(name);
    return name;
  });
  return { header: out, renamed };
}

/**
 * Parsea el CSV con papaparse (RFC 4180): quita BOM, detecta delimitador,
 * salta filas vacías, une saltos de línea dentro de campos y recorta cada
 * campo (mismas reglas que `csv-parse` con `trim` + `skip_empty_lines` de v4).
 */
export function parseCsvText(text: string, fleet: Fleet, onProgress?: ProgressFn): ParsedCsv | { error: string } {
  const clean = stripBom(text);
  if (!clean.trim()) return { error: 'El archivo está vacío' };
  const delimiter = detectDelimiter(clean);
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy', delimiter });
  const data = result.data;
  if (data.length === 0) return { error: 'El archivo está vacío' };
  const rawHeader = (data[0] ?? []).map((h) => joinLines(h));
  if (rawHeader.length === 0 || rawHeader.every((h) => !h)) return { error: 'El archivo no tiene encabezado' };
  const { header, renamed } = dedupeHeader(rawHeader);
  const total = data.length - 1;
  if (total <= 0) return { error: 'El archivo no tiene filas de contactos' };
  if (total > LIMITS[fleet].maxRows) {
    return { error: `El archivo supera ${LIMITS[fleet].maxRows.toLocaleString('es-MX')} filas para ${fleet}` };
  }
  let joinedFields = 0;
  let convertedDates = 0;
  const dateCols = excelDateColumns(header);
  const rows: RawRow[] = new Array<RawRow>(total);
  for (let i = 0; i < total; i++) {
    const values = data[i + 1]!.map((v) => {
      if (/[\r\n]/.test(v.trim())) joinedFields++;
      return joinLines(v);
    });
    // Números de serie de Excel en columnas de fecha/hora → dd/mm/yyyy, HH:MM:SS.
    if (dateCols.length) convertedDates += convertExcelRow(header, values, dateCols);
    rows[i] = { rowNumber: i + 2, values };
    if (onProgress && (i + 1) % PROGRESS_EVERY === 0) onProgress(i + 1, total);
  }
  onProgress?.(total, total);
  return { header, rows, delimiter, renamed, joinedFields, convertedDates };
}

/**
 * Columna de teléfono principal. v3: el último alias del CLI o, sin alias, la
 * primera columna de teléfono (`telefono`, `telefono_N`, …). v4: la elegida
 * por el usuario, el primer alias de v4 o la primera `telefono_N`.
 */
export function detectPhoneColumn(header: readonly string[], fleet: Fleet, chosen?: string | null): { column: string } | { error: string } {
  if (fleet === 'v3') {
    const found = header.filter((h) => (V3_PHONE_COLUMNS as readonly string[]).includes(h));
    if (found.length) return { column: found[found.length - 1]! };
    const any = phoneColumnsOf(header)[0];
    return any ? { column: any } : { error: 'v3 requiere una columna de teléfono (phone_number, contact_phone, contact_pho, phone, telefono o telefono_N)' };
  }
  if (chosen) {
    return header.includes(chosen) ? { column: chosen } : { error: `La columna ${chosen} no existe en el archivo` };
  }
  const found = V4_PHONE_COLUMNS.find((c) => header.includes(c)) ?? phoneColumnsOf(header)[0];
  return found ? { column: found } : { error: 'Elige la columna de teléfono' };
}

/**
 * Columnas candidatas por fila: la principal y, en v3, las demás columnas de
 * teléfono del encabezado (el agente elige cuáles usar en "Mi asignación").
 */
export function phoneCandidates(header: readonly string[], fleet: Fleet, column: string): string[] {
  if (fleet === 'v4') {
    // v4: con `telefono_N` elegida, fallback por fila a las demás `telefono_N` (columna telefono_envio).
    if (!usesSendColumn(column)) return [column];
    return [column, ...header.filter((c) => c !== column && usesSendColumn(c))];
  }
  return [column, ...phoneColumnsOf(header).filter((c) => c !== column)];
}

/** Columna que v4 recibe con el teléfono resuelto por fila (support-crm-base-upload). */
export const V4_SEND_COLUMN = 'telefono_envio';

/** En v4 una columna `telefono_N` elegida activa el fallback por fila y la columna `telefono_envio`. */
export const usesSendColumn = (column: string | null | undefined): boolean => !!column && /^telefono_\d+$/.test(column);

/** Error si el fallback de v4 aplica y el encabezado ya trae `telefono_envio`. */
export function sendColumnError(header: readonly string[], fleet: Fleet, column: string): string | null {
  return fleet === 'v4' && usesSendColumn(column) && header.includes(V4_SEND_COLUMN) ? `La columna ${V4_SEND_COLUMN} está reservada en v4` : null;
}

export const digitsOf = (s: string): string => s.replace(/\D/g, '');

/** Columnas de crédito (alias del CLI v3 y de v4), en orden de preferencia. */
export const CREDIT_COLUMNS = ['credit', 'credito', 'credit_id', 'id_credito'] as const;

/** Crédito normalizado para duplicados: sin espacios y en minúsculas. */
export const normalizeCredit = (v: string): string => v.replace(/\s+/g, '').toLowerCase();

export type InvalidReason =
  | 'Columnas incompletas'
  | 'Más columnas que el encabezado'
  | 'Salto de línea dentro de un campo'
  | 'Sin teléfono'
  | 'Teléfono con menos de 10 dígitos'
  | 'Teléfono duplicado'
  | 'Crédito duplicado';

export interface ValidRow {
  rowNumber: number;
  values: string[];
  phone: string;
  digits: string;
  /** Columna → valor; se arma al leerla (200 000 filas × 76 columnas no caben como objetos). */
  readonly record: Record<string, string>;
}

class LazyRow implements ValidRow {
  #record: Record<string, string> | undefined;
  constructor(
    private readonly header: readonly string[],
    public rowNumber: number,
    public values: string[],
    public phone: string,
    public digits: string,
  ) {}
  get record(): Record<string, string> {
    if (!this.#record) {
      const r: Record<string, string> = {};
      this.header.forEach((h, i) => {
        r[h] = this.values[i] ?? '';
      });
      this.#record = r;
    }
    return this.#record;
  }
}

export interface Validation {
  total: number;
  valid: ValidRow[];
  invalid: Array<{ rowNumber: number; reason: InvalidReason }>;
}

/**
 * Clasifica cada fila (spec "Validación de filas" + support-crm-base-upload):
 * válida si alguna columna candidata tiene ≥ 10 dígitos; el teléfono de la
 * fila es el primero válido. Duplicados ("Duplicados por crédito"): mismo
 * crédito normalizado → "Crédito duplicado" (el mismo teléfono en créditos
 * distintos es válido); sin crédito, por teléfono solo entre filas sin
 * crédito. Solo las válidas se entregan.
 */
export function validateRows(
  parsed: ParsedCsv,
  fleet: Fleet,
  phoneColumn: string,
  candidates?: readonly string[],
  onProgress?: ProgressFn,
): Validation {
  const cols = (candidates ?? phoneCandidates(parsed.header, fleet, phoneColumn)).map((c) => parsed.header.indexOf(c)).filter((i) => i >= 0);
  const creditCols = CREDIT_COLUMNS.map((c) => parsed.header.indexOf(c)).filter((i) => i >= 0);
  const seenCredits = new Set<string>();
  const seenPhones = new Set<string>();
  const valid: ValidRow[] = [];
  const invalid: Validation['invalid'] = [];
  const total = parsed.rows.length;
  for (let n = 0; n < total; n++) {
    const row = parsed.rows[n]!;
    if (onProgress && n > 0 && n % PROGRESS_EVERY === 0) onProgress(n, total);
    let reason: InvalidReason | null = null;
    if (row.values.length < parsed.header.length) reason = 'Columnas incompletas';
    // csv-parse (v4) rechaza el archivo completo con columnas de más.
    else if (fleet === 'v4' && row.values.length > parsed.header.length) reason = 'Más columnas que el encabezado';
    const present = cols.map((i) => row.values[i] ?? '').filter((v) => v);
    const phone = present.find((v) => digitsOf(v).length >= 10) ?? present[0] ?? '';
    const digits = digitsOf(phone);
    const credit = creditCols.map((i) => normalizeCredit(row.values[i] ?? '')).find((v) => v) ?? '';
    if (!reason) {
      if (!phone) reason = 'Sin teléfono';
      else if (digits.length < 10) reason = 'Teléfono con menos de 10 dígitos';
      else if (credit && seenCredits.has(credit)) reason = 'Crédito duplicado';
      else if (!credit && seenPhones.has(digits)) reason = 'Teléfono duplicado';
    }
    if (reason) {
      invalid.push({ rowNumber: row.rowNumber, reason });
      continue;
    }
    if (credit) seenCredits.add(credit);
    else seenPhones.add(digits);
    valid.push(new LazyRow(parsed.header, row.rowNumber, row.values, phone, digits));
  }
  onProgress?.(total, total);
  return { total: parsed.rows.length, valid, invalid };
}

/** Escapa un campo CSV (comillas si contiene coma, comilla o salto de línea). */
export const escapeCsvField = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Serializa encabezado + filas con `\n`. */
export function serializeCsv(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  return [header, ...rows].map((r) => r.map(escapeCsvField).join(',')).join('\n') + '\n';
}
