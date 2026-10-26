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

/** Columnas del encabezado (separadas por coma, sin comillas ni espacios). */
export const headerColumns = (csv: string): string[] => {
  const first = stripBom(csv).split(/\r?\n/, 1)[0] ?? '';
  return first.split(',').map((h) => h.trim().replace(/^"(.*)"$/, '$1').trim());
};
