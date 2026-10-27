import { contactSources, PHONE_ALIASES, UPLOAD_ID_COLUMN, type ParsedAssignment } from './assignmentCsv';
import { renderTemplateDetailed } from './templateRender';

/**
 * Archivo que publica "Mi asignación" (add-agent-workspace, spec v3/agent-workspace
 * "Teléfonos de la publicación", "Renderizado del mensaje por fila", "Archivo
 * publicado para el CLI"). Módulo puro: ANA Admin lo usa en su prueba de
 * equivalencia de la vista previa.
 */

const isPhoneAlias = (h: string): boolean => (PHONE_ALIASES as readonly string[]).includes(h);
const digitsOf = (s: string): string => s.replace(/\D/g, '');

/** Unión de encabezados en el orden de las fuentes (sin repetir). */
export function mergedHeader(parsed: readonly ParsedAssignment[]): string[] {
  const out: string[] = [];
  for (const p of parsed) for (const h of p.header) if (h && !out.includes(h)) out.push(h);
  return out;
}

export interface BuiltPublication {
  header: string[];
  rows: string[][];
  uploadIds: string[];
}

/**
 * Arma el archivo publicado (spec "Teléfonos de la publicación", "Renderizado
 * del mensaje por fila", "Archivo publicado para el CLI"). Lanza `{status, message}`.
 */
export function buildPublication(
  parsed: readonly ParsedAssignment[],
  selections: ReadonlyArray<readonly number[]>,
  template: string,
  phoneColumns: readonly string[],
): BuiltPublication {
  const union = mergedHeader(parsed);
  const missing = phoneColumns.filter((c) => !union.includes(c));
  if (missing.length) throw { status: 400, message: `Columna de teléfono inexistente: ${missing.join(', ')}` };
  const renderHeader = union.filter((h) => h.toLowerCase() !== UPLOAD_ID_COLUMN);
  const others = union.filter((h) => !isPhoneAlias(h) && h !== 'message' && h.toLowerCase() !== UPLOAD_ID_COLUMN);
  const header = ['phone_number', ...others, 'message', UPLOAD_ID_COLUMN];
  const seenPhones = new Set<string>();
  const unresolved: string[] = [];
  const uploadIds = new Set<string>();
  const rows: string[][] = [];

  parsed.forEach((p, s) => {
    for (const index of selections[s] ?? []) {
      const row = p.rows[index];
      if (!row) throw { status: 400, message: `Fila inexistente: ${index + 1}` };
      if (!row.valid) throw { status: 400, message: `Fila inválida: ${index + 1}` };
      const record: Record<string, string> = {};
      for (const h of union) record[h] = '';
      p.header.forEach((h, i) => {
        if (h) record[h] = row.values[i] ?? '';
      });
      const uploadId = Object.entries(record).find(([h]) => h.toLowerCase() === UPLOAD_ID_COLUMN)?.[1] ?? '';
      for (const col of phoneColumns) {
        const phone = record[col] ?? '';
        const digits = digitsOf(phone);
        if (digits.length < 10 || seenPhones.has(digits)) continue;
        seenPhones.add(digits);
        const sources = contactSources(
          renderHeader,
          renderHeader.map((h) => record[h] ?? ''),
        );
        sources.fields.phone = phone;
        const r = renderTemplateDetailed(template, sources);
        for (const u of r.unresolved) if (!unresolved.includes(u)) unresolved.push(u);
        const message = r.text.replace(/\r\n|\r|\n/g, '\\n');
        rows.push([phone, ...others.map((h) => record[h] ?? ''), message, uploadId]);
        if (uploadId) uploadIds.add(uploadId);
      }
    }
  });
  if (unresolved.length) throw { status: 400, message: unresolved.map((u) => `Variable desconocida: ${u}`).join(' · ') };
  if (rows.length === 0) throw { status: 400, message: 'Sin teléfonos válidos' };
  return { header, rows, uploadIds: [...uploadIds] };
}
