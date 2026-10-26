// Columna reservada `ana_upload_id` (link-review-contacts-to-uploads D1): v3
// la agrega como última columna de cada fila entregada con el uploadId.

export const UPLOAD_ID_COLUMN = 'ana_upload_id';
export const RESERVED_COLUMN_ERROR = 'La columna ana_upload_id está reservada';

/** Mapeo de columnas del CLI (assignment-csv.js FIELD_MAPPING). */
const CLI_FIELD_MAPPING: Record<string, string> = {
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

export const hasReservedColumn = (header: readonly string[]): boolean => header.some((h) => h.trim().toLowerCase() === UPLOAD_ID_COLUMN);

/**
 * Variables `{var}` (llave simple) que el CLI resolvería contra `ana_upload_id`
 * por coincidencia parcial porque ninguna otra columna las resuelve
 * (`{upload}`, `{id}` sin `id_credito`, …). Devuelve los nombres con error.
 */
export function variablesResolvingToUploadId(texts: readonly string[], header: readonly string[]): string[] {
  const cols = header.filter((h) => h.toLowerCase() !== UPLOAD_ID_COLUMN);
  const mapped = new Set(cols.map((h) => CLI_FIELD_MAPPING[h] ?? h));
  const bad = new Set<string>();
  for (const text of texts) {
    // Quitar primero los marcadores dobles {{...}} (no usan coincidencia parcial).
    const singles = text.replace(/\{\{[^{}]+\}\}/g, '');
    for (const m of singles.matchAll(/\{(\w+)\}/g)) {
      const v = m[1]!;
      const resolves = (v !== 'message' && mapped.has(v)) || cols.includes(v) || cols.some((c) => c.includes(v));
      if (!resolves && UPLOAD_ID_COLUMN.includes(v)) bad.add(v);
    }
  }
  return [...bad];
}

export const unknownVariableError = (vars: readonly string[]): string => vars.map((v) => `Variable desconocida: {${v}}`).join(' · ');
