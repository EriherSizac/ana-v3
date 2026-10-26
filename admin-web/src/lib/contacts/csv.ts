import Papa from 'papaparse';

// Lectura y validación de CSV de contactos (isomórfico: navegador y BFF).
// add-contact-upload-console D1/D2 y spec admin-web/contact-upload.

export type Fleet = 'v3' | 'v4';

export const LIMITS: Record<Fleet, { maxBytes: number; maxRows: number; label: string }> = {
  v3: { maxBytes: 4 * 1024 * 1024, maxRows: 20_000, label: '4 MB' },
  v4: { maxBytes: 10 * 1024 * 1024, maxRows: 50_000, label: '10 MB' },
};

/** Alias de teléfono que entiende el parser del CLI v3. */
export const V3_PHONE_COLUMNS = ['phone_number', 'contact_phone', 'contact_pho', 'phone'] as const;
/** v4 además acepta `telefono` (o la columna que elija el usuario). */
export const V4_PHONE_COLUMNS = [...V3_PHONE_COLUMNS, 'telefono'] as const;

export interface RawRow {
  /** Número de fila del archivo (el encabezado es la fila 1). */
  rowNumber: number;
  values: string[];
  /** Algún campo trae salto de línea (no soportado por el CLI v3). */
  hasNewline: boolean;
}

export interface ParsedCsv {
  header: string[];
  rows: RawRow[];
}

export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** Valida tamaño antes de leer. `null` si está dentro de límites. */
export function checkFileSize(bytes: number, fleet: Fleet): string | null {
  if (bytes === 0) return 'El archivo está vacío';
  if (bytes > LIMITS[fleet].maxBytes) return `El archivo supera ${LIMITS[fleet].label} para ${fleet}`;
  return null;
}

/**
 * Parsea el CSV con papaparse: quita BOM, salta filas vacías y recorta cada
 * campo (mismas reglas que `csv-parse` con `trim` + `skip_empty_lines` de v4
 * y que el parser del CLI).
 */
export function parseCsvText(text: string, fleet: Fleet): ParsedCsv | { error: string } {
  const clean = stripBom(text);
  if (!clean.trim()) return { error: 'El archivo está vacío' };
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' });
  const data = result.data;
  if (data.length === 0) return { error: 'El archivo está vacío' };
  const header = (data[0] ?? []).map((h) => h.trim());
  if (header.length === 0 || header.every((h) => !h)) return { error: 'El archivo no tiene encabezado' };
  const rows: RawRow[] = data.slice(1).map((values, i) => ({
    rowNumber: i + 2,
    values: values.map((v) => v.trim()),
    hasNewline: values.some((v) => /[\r\n]/.test(v)),
  }));
  if (rows.length === 0) return { error: 'El archivo no tiene filas de contactos' };
  if (rows.length > LIMITS[fleet].maxRows) {
    return { error: `El archivo supera ${LIMITS[fleet].maxRows.toLocaleString('es-MX')} filas para ${fleet}` };
  }
  return { header, rows };
}

/**
 * Columna de teléfono. v3: uno de los cuatro alias (si hay varios, el último
 * del encabezado, que es el que termina usando el CLI). v4: la elegida por el
 * usuario o el primer alias encontrado (incluye `telefono`).
 */
export function detectPhoneColumn(header: readonly string[], fleet: Fleet, chosen?: string | null): { column: string } | { error: string } {
  if (fleet === 'v3') {
    const found = header.filter((h) => (V3_PHONE_COLUMNS as readonly string[]).includes(h));
    if (found.length === 0) {
      return { error: 'v3 requiere una columna de teléfono phone_number, contact_phone, contact_pho o phone' };
    }
    return { column: found[found.length - 1]! };
  }
  if (chosen) {
    return header.includes(chosen) ? { column: chosen } : { error: `La columna ${chosen} no existe en el archivo` };
  }
  const found = V4_PHONE_COLUMNS.find((c) => header.includes(c));
  return found ? { column: found } : { error: 'Elige la columna de teléfono' };
}

export const digitsOf = (s: string): string => s.replace(/\D/g, '');

export type InvalidReason =
  | 'Columnas incompletas'
  | 'Más columnas que el encabezado'
  | 'Salto de línea dentro de un campo'
  | 'Sin teléfono'
  | 'Teléfono con menos de 10 dígitos'
  | 'Teléfono duplicado';

export interface ValidRow {
  rowNumber: number;
  values: string[];
  phone: string;
  digits: string;
  record: Record<string, string>;
}

export interface Validation {
  total: number;
  valid: ValidRow[];
  invalid: Array<{ rowNumber: number; reason: InvalidReason }>;
}

/** Clasifica cada fila (spec "Validación de filas"). Solo las válidas se entregan. */
export function validateRows(parsed: ParsedCsv, fleet: Fleet, phoneColumn: string): Validation {
  const idx = parsed.header.indexOf(phoneColumn);
  const seen = new Set<string>();
  const valid: ValidRow[] = [];
  const invalid: Validation['invalid'] = [];
  for (const row of parsed.rows) {
    let reason: InvalidReason | null = null;
    if (row.values.length < parsed.header.length) reason = 'Columnas incompletas';
    // csv-parse (v4) rechaza el archivo completo con columnas de más.
    else if (fleet === 'v4' && row.values.length > parsed.header.length) reason = 'Más columnas que el encabezado';
    else if (fleet === 'v3' && row.hasNewline) reason = 'Salto de línea dentro de un campo';
    const phone = idx >= 0 ? (row.values[idx] ?? '') : '';
    const digits = digitsOf(phone);
    if (!reason) {
      if (!phone) reason = 'Sin teléfono';
      else if (digits.length < 10) reason = 'Teléfono con menos de 10 dígitos';
      else if (seen.has(digits)) reason = 'Teléfono duplicado';
    }
    if (reason) {
      invalid.push({ rowNumber: row.rowNumber, reason });
      continue;
    }
    seen.add(digits);
    const record: Record<string, string> = {};
    parsed.header.forEach((h, i) => {
      record[h] = row.values[i] ?? '';
    });
    valid.push({ rowNumber: row.rowNumber, values: row.values, phone, digits, record });
  }
  return { total: parsed.rows.length, valid, invalid };
}

/** Escapa un campo CSV (comillas si contiene coma, comilla o salto de línea). */
export const escapeCsvField = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Serializa encabezado + filas con `\n`. */
export function serializeCsv(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  return [header, ...rows].map((r) => r.map(escapeCsvField).join(',')).join('\n') + '\n';
}
