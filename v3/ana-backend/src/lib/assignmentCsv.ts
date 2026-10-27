/**
 * Parseo de CSV de asignación con las reglas del CLI v3
 * (`v3/cli-whatsapp/assignment-csv.js`, spec v3/automated-sending "Parseo del
 * CSV de contactos"), conservando el texto original de cada fila para poder
 * reescribir los pendientes sin re-serializar (add-agent-workspace D3).
 */

/** Mapeo de columnas del CLI (`FIELD_MAPPING` de assignment-csv.js). */
export const FIELD_MAPPING: Readonly<Record<string, string>> = {
  phone_number: 'phone',
  contact_phone: 'phone',
  contact_pho: 'phone',
  phone: 'phone',
  contact_name: 'name',
  first_name: 'first_name',
  last_name: 'last_name',
  name: 'name',
  message: 'message',
  credit: 'credit',
  credito: 'credit',
  credit_id: 'credit',
  id_credito: 'credit',
  discount: 'discount',
  total_balance: 'total_balance',
  product: 'product',
};

/** Alias de teléfono que entiende el CLI. */
export const PHONE_ALIASES = ['phone_number', 'contact_phone', 'contact_pho', 'phone'] as const;

/** Columna reservada con el uploadId de la carga (link-review-contacts-to-uploads). */
export const UPLOAD_ID_COLUMN = 'ana_upload_id';

export interface AssignmentRow {
  /** Índice entre las filas de datos (0 = primera fila tras el encabezado). */
  index: number;
  /** Texto original de la fila lógica (sin el salto de línea final). */
  raw: string;
  values: string[];
  /** El CLI descarta filas con menos columnas que el encabezado. */
  valid: boolean;
}

export interface ParsedAssignment {
  header: string[];
  headerRaw: string;
  rows: AssignmentRow[];
}

/** Filas lógicas respetando comillas (saltos de línea dentro de comillas no cortan la fila). */
export function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      if (current.trim()) rows.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) rows.push(current);
  return rows;
}

/** Valores de una fila (comillas dobles, `""` escapada, comas dentro de comillas); cada valor recortado. */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** Parsea un archivo de asignación. Sin encabezado → `header` vacío. */
export function parseAssignmentCsv(text: string): ParsedAssignment {
  const lines = splitCsvRows(stripBom(String(text ?? '')).trim());
  if (lines.length === 0) return { header: [], headerRaw: '', rows: [] };
  const header = parseCsvLine(lines[0]!);
  const rows = lines.slice(1).map((raw, index) => {
    const values = parseCsvLine(raw);
    return { index, raw, values, valid: values.length >= header.length };
  });
  return { header, headerRaw: lines[0]!, rows };
}

/**
 * Campos mapeados y valores originales de una fila, como los arma el CLI
 * (\`fields\` = nombre mapeado; con alias repetidos gana el último del encabezado).
 */
export function contactSources(header: readonly string[], values: readonly string[]): { fields: Record<string, string>; raw: Record<string, string> } {
  const fields: Record<string, string> = {};
  const raw: Record<string, string> = {};
  header.forEach((h, i) => {
    const v = values[i] ?? '';
    raw[h] = v;
    fields[FIELD_MAPPING[h] ?? h] = v;
  });
  return { fields, raw };
}

/** Escapa un campo CSV (comillas si contiene coma, comilla o salto de línea). */
export const escapeCsvField = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const serializeCsv = (header: readonly string[], rows: ReadonlyArray<readonly string[]>): string =>
  [header, ...rows].map((r) => r.map(escapeCsvField).join(',')).join('\n') + '\n';
