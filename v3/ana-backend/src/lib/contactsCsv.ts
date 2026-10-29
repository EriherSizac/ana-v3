import { parseCsvLine, splitCsvRows } from './assignmentCsv';

/**
 * Procesamiento de la columna `message` de los CSV de contactos.
 * Extraído de `handlers/supervisors.ts` (uploadAgentContacts) sin cambiar su
 * comportamiento; lo reutiliza la carga de administración
 * (`handlers/adminContacts.ts`, add-contact-upload-console D3).
 */

/** Escapa un campo CSV (comillas si contiene coma, comilla o salto de línea). */
export const escapeCSVField = (field: string): string => {
  if (!field) return '';
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
};

/**
 * Agrega la columna `message` (si el encabezado no la tiene) con el mensaje
 * plantilla en cada fila no vacía. Mismo resultado byte a byte que la carga
 * de supervisor: separa por `\n`, recorta cada línea, omite líneas vacías y
 * no agrega el mensaje a una línea que ya lo contiene.
 */
export function addMessageColumn(csv: string, message: string): { csv: string; contactCount: number; empty: boolean } {
  const lines = csv.trim().split('\n');
  if (lines.length < 1) return { csv: '', contactCount: 0, empty: true };
  const header = lines[0]!.trim();
  const newHeader = header.includes('message') ? header : `${header},message`;
  const processedLines = [newHeader];
  let contactCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const escapedMessage = escapeCSVField(message);
    const newLine = line.includes(message) ? line : `${line},${escapedMessage}`;
    processedLines.push(newLine);
    contactCount++;
  }
  return { csv: processedLines.join('\n') + '\n', contactCount, empty: false };
}

/**
 * Para la carga de administración: el parser del CLI no admite saltos de
 * línea dentro de un campo, así que CR/LF del mensaje se convierten a `\n`
 * literal, que el CLI interpreta como salto (design D4).
 */
export const messageToSingleLine = (message: string): string => message.replace(/\r\n|\r|\n/g, '\\n');

/** Quita un BOM UTF-8 inicial. */
export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export const PHONE_COLUMNS = ['phone_number', 'contact_phone', 'contact_pho', 'phone'] as const;

/**
 * Columnas de teléfono de la carga de administración (support-crm-base-upload):
 * alias del CLI, `telefono`, `telefono_N` y `phone_N` (base CRM: telefono_1..3).
 * El agente elige cuáles usar al publicar desde "Mi asignación".
 */
export const isPhoneColumnName = (h: string): boolean =>
  (PHONE_COLUMNS as readonly string[]).includes(h) || h === 'telefono' || /^(telefono|phone)_\d+$/.test(h);

/** Columnas del encabezado (primera fila lógica, comillas respetadas, sin espacios). */
export const headerColumns = (csv: string): string[] => {
  const first = splitCsvRows(stripBom(csv))[0] ?? '';
  return parseCsvLine(first).map((h) => h.trim());
};

/** CR/LF dentro de un campo → un espacio (con los espacios de alrededor) y recorte. */
export const joinLines = (v: string): string => v.replace(/\s*[\r\n]\s*/g, ' ').trim();

/**
 * Filas lógicas del CSV (comillas respetadas) sin saltos de línea dentro de
 * campos: una fila con CR/LF dentro de comillas se re-serializa con esos
 * saltos convertidos en espacio; las demás se conservan tal cual (recortadas).
 */
export function singleLineRows(csv: string): string[] {
  return splitCsvRows(stripBom(csv).trim()).map((raw) => {
    const line = raw.trim();
    if (!/[\r\n]/.test(line)) return line;
    return parseCsvLine(line)
      .map((v) => escapeCSVField(joinLines(v)))
      .join(',');
  });
}
