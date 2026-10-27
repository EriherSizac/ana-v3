// Parseo de CSV de asignación con las reglas del CLI v3 (`v3/cli-whatsapp/assignment-csv.js`).
// Mismo algoritmo que `v3/ana-backend/src/lib/assignmentCsv.ts` (el backend
// vuelve a parsear al publicar); pruebas de equivalencia en test/workspace.

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

export const PHONE_ALIASES = ['phone_number', 'contact_phone', 'contact_pho', 'phone'] as const;
export const UPLOAD_ID_COLUMN = 'ana_upload_id';

export interface AssignmentRow {
  /** Índice entre las filas de datos (lo que el backend recibe en `rows`). */
  index: number;
  values: string[];
  /** El CLI descarta filas con menos columnas que el encabezado. */
  valid: boolean;
}

export interface ParsedAssignment {
  header: string[];
  rows: AssignmentRow[];
}

function splitCsvRows(text: string): string[] {
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

function parseCsvLine(line: string): string[] {
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

export function parseAssignmentCsv(text: string): ParsedAssignment {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = splitCsvRows(clean.trim());
  if (lines.length === 0) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]!);
  return {
    header,
    rows: lines.slice(1).map((raw, index) => {
      const values = parseCsvLine(raw);
      return { index, values, valid: values.length >= header.length };
    }),
  };
}

/** Campos mapeados (`fields`) y columnas originales (`raw`) como los arma el CLI. */
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
