import { contactSources, PHONE_ALIASES, UPLOAD_ID_COLUMN, type ParsedAssignment } from './assignmentCsv';
import { creditKeyOf } from './contactsCsv';
import { renderTemplateDetailed } from './templateRender';

/**
 * Archivo que publica "Mi asignación" (add-agent-workspace, spec v3/agent-workspace
 * "Teléfonos de la publicación", "Renderizado del mensaje por fila", "Archivo
 * publicado para el CLI", "Modo de teléfono de la publicación"). Módulo puro:
 * ANA Admin lo usa en su prueba de equivalencia de la vista previa.
 */

const isPhoneAlias = (h: string): boolean => (PHONE_ALIASES as readonly string[]).includes(h);
const digitsOf = (s: string): string => s.replace(/\D/g, '');
/** CR/LF dentro de un campo → un espacio y recorte. */
const joinLines = (v: string): string => v.replace(/\s*[\r\n]\s*/g, ' ').trim();

/** Unión de encabezados en el orden de las fuentes (sin repetir). */
export function mergedHeader(parsed: readonly ParsedAssignment[]): string[] {
  const out: string[] = [];
  for (const p of parsed) for (const h of p.header) if (h && !out.includes(h)) out.push(h);
  return out;
}

/**
 * Modo de teléfonos:
 * - `all`: un mensaje por teléfono válido de las columnas elegidas (comportamiento previo).
 * - `first`: un mensaje por crédito, al primer teléfono válido en el orden de
 *   `phoneColumns` (misma semántica que el fallback de v4).
 */
export type PhoneMode = 'first' | 'all';
export const PHONE_MODES: readonly PhoneMode[] = ['first', 'all'];

export interface PhoneCandidate {
  column: string;
  phone: string;
}

/** Teléfonos válidos (≥ 10 dígitos) de la fila en el orden de las columnas, sin repetir dígitos. */
export function phoneCandidates(record: Readonly<Record<string, string>>, phoneColumns: readonly string[]): PhoneCandidate[] {
  const out: PhoneCandidate[] = [];
  const seen = new Set<string>();
  for (const column of phoneColumns) {
    const phone = record[column] ?? '';
    const d = digitsOf(phone);
    if (d.length < 10 || seen.has(d)) continue;
    seen.add(d);
    out.push({ column, phone });
  }
  return out;
}

/** Estado compartido entre filas de una publicación. */
export interface PhoneDedupe {
  /** `crédito|dígitos` ya publicados. */
  seen: Set<string>;
  /** Créditos ya publicados (solo modo `first`: un mensaje por crédito). */
  credits: Set<string>;
}

export const newPhoneDedupe = (): PhoneDedupe => ({ seen: new Set(), credits: new Set() });

/**
 * Teléfonos a los que se envía una fila. Con `override`, solo ese teléfono (debe
 * ser uno de los válidos de la fila; si no, lanza `{status: 400}`). Un teléfono
 * nunca se repite para el mismo crédito; en `first`, un crédito recibe un solo
 * mensaje (al primer teléfono no usado en orden).
 */
export function choosePhones(
  record: Readonly<Record<string, string>>,
  phoneColumns: readonly string[],
  mode: PhoneMode,
  override: string | undefined,
  dedupe: PhoneDedupe,
  rowLabel: string,
): string[] {
  const candidates = phoneCandidates(record, phoneColumns);
  const credit = creditKeyOf(record);
  let list = candidates;
  if (override !== undefined) {
    const d = digitsOf(override);
    const match = d ? candidates.find((c) => digitsOf(c.phone) === d) : undefined;
    if (!match) throw { status: 400, message: `El teléfono elegido no pertenece a la fila ${rowLabel}` };
    list = [match];
  }
  const keyOf = (c: PhoneCandidate) => `${credit}|${digitsOf(c.phone)}`;
  if (mode === 'first') {
    if (credit && dedupe.credits.has(credit)) return [];
    const pick = list.find((c) => !dedupe.seen.has(keyOf(c)));
    if (!pick) return [];
    dedupe.seen.add(keyOf(pick));
    if (credit) dedupe.credits.add(credit);
    return [pick.phone];
  }
  const out: string[] = [];
  for (const c of list) {
    if (dedupe.seen.has(keyOf(c))) continue;
    dedupe.seen.add(keyOf(c));
    out.push(c.phone);
  }
  return out;
}

/** `<key>#<índice>` → partes (se corta en el último `#`). */
export function parseRowKey(rowKey: string): { key: string; index: number } | null {
  const at = rowKey.lastIndexOf('#');
  if (at <= 0) return null;
  const idx = rowKey.slice(at + 1);
  if (!/^\d{1,6}$/.test(idx)) return null;
  return { key: rowKey.slice(0, at), index: Number(idx) };
}

/** `overrides` del body → por fuente (índice de `sources`), índice de fila → teléfono. */
export function overridesBySource(req: { sources: ReadonlyArray<{ key: string }>; overrides: Readonly<Record<string, string>> }): Array<Map<number, string>> {
  const out = req.sources.map(() => new Map<number, string>());
  for (const [rowKey, phone] of Object.entries(req.overrides)) {
    const rk = parseRowKey(rowKey);
    const s = rk ? req.sources.findIndex((x) => x.key === rk.key) : -1;
    if (rk && s >= 0) out[s]!.set(rk.index, phone);
  }
  return out;
}

export interface PublicationOptions {
  /** Ausente → `all` (compatibilidad con clientes previos). */
  phoneMode?: PhoneMode;
  /** Por fuente (mismo índice que `selections`): índice de fila → teléfono elegido. */
  overrides?: ReadonlyArray<ReadonlyMap<number, string> | undefined>;
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
  options: PublicationOptions = {},
): BuiltPublication {
  const mode: PhoneMode = options.phoneMode ?? 'all';
  const union = mergedHeader(parsed);
  const missing = phoneColumns.filter((c) => !union.includes(c));
  if (missing.length) throw { status: 400, message: `Columna de teléfono inexistente: ${missing.join(', ')}` };
  options.overrides?.forEach((m, s) => {
    const sel = new Set(selections[s] ?? []);
    for (const i of m?.keys() ?? []) if (!sel.has(i)) throw { status: 400, message: `Teléfono elegido para una fila no seleccionada: ${i + 1}` };
  });
  const renderHeader = union.filter((h) => h.toLowerCase() !== UPLOAD_ID_COLUMN);
  const others = union.filter((h) => !isPhoneAlias(h) && h !== 'message' && h.toLowerCase() !== UPLOAD_ID_COLUMN);
  const header = ['phone_number', ...others, 'message', UPLOAD_ID_COLUMN];
  const dedupe = newPhoneDedupe();
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
      // "Publicación por crédito": un teléfono una vez por crédito (sin crédito,
      // una vez entre las filas sin crédito); créditos distintos sí se repiten.
      const chosen = choosePhones(record, phoneColumns, mode, options.overrides?.[s]?.get(index), dedupe, String(index + 1));
      for (const phone of chosen) {
        const sources = contactSources(
          renderHeader,
          renderHeader.map((h) => record[h] ?? ''),
        );
        sources.fields.phone = phone;
        const r = renderTemplateDetailed(template, sources);
        for (const u of r.unresolved) if (!unresolved.includes(u)) unresolved.push(u);
        const message = r.text.replace(/\r\n|\r|\n/g, '\\n');
        // Sin campos multilínea en el archivo del CLI (support-crm-base-upload).
        rows.push([phone, ...others.map((h) => joinLines(record[h] ?? '')), message, uploadId]);
        if (uploadId) uploadIds.add(uploadId);
      }
    }
  });
  if (unresolved.length) throw { status: 400, message: unresolved.map((u) => `Variable desconocida: ${u}`).join(' · ') };
  if (rows.length === 0) throw { status: 400, message: 'Sin teléfonos válidos' };
  return { header, rows, uploadIds: [...uploadIds] };
}
