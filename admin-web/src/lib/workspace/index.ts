// Lógica de "Mi asignación" (add-agent-workspace): combinación de pendientes,
// columnas de teléfono y vista previa del mensaje con la semántica del CLI v3.
// El backend v3 repite el cálculo al publicar; aquí solo es la vista previa.
import { contactSources, parseAssignmentCsv, PHONE_ALIASES, UPLOAD_ID_COLUMN, type ParsedAssignment } from './csv';
import { renderTemplateDetailed } from './template';

export * from './csv';
export * from './template';
export * from './table-filters';
export * from './personalization';

export interface PendingFile {
  key: string;
  fileName: string;
  lastModified: string | null;
  size: number | null;
  etag: string | null;
  /** Fecha de carga (llave o LastModified) según v3. */
  uploadedAt?: string | null;
  /** Filas válidas e ids de carga (v3 los calcula para los más recientes). */
  rows?: number | null;
  uploadIds?: string[] | null;
}

export interface LoadedFile {
  key: string;
  etag: string;
  parsed: ParsedAssignment;
}

export interface MergedRow {
  /** `<posición del archivo>:<índice de fila>`. */
  id: string;
  file: number;
  index: number;
  record: Record<string, string>;
  valid: boolean;
}

export interface Merged {
  header: string[];
  rows: MergedRow[];
}

export const MAX_PHONE_COLUMNS = 5;
export const MAX_TEMPLATE = 2000;

/** Carga el texto de cada archivo. */
export const loadFile = (key: string, etag: string, csv: string): LoadedFile => ({ key, etag, parsed: parseAssignmentCsv(csv) });

/** Unión de encabezados en el orden de los archivos y filas con todas las columnas (vacías si faltan). */
export function mergeFiles(files: readonly LoadedFile[]): Merged {
  const header: string[] = [];
  for (const f of files) for (const h of f.parsed.header) if (h && !header.includes(h)) header.push(h);
  const rows: MergedRow[] = [];
  files.forEach((f, file) => {
    for (const r of f.parsed.rows) {
      const record: Record<string, string> = Object.fromEntries(header.map((h) => [h, '']));
      f.parsed.header.forEach((h, i) => {
        if (h) record[h] = r.values[i] ?? '';
      });
      rows.push({ id: `${file}:${r.index}`, file, index: r.index, record, valid: r.valid });
    }
  });
  return { header, rows };
}

/** Columna que usaría el CLI (último alias del encabezado) o la primera con `tel`/`phone`. */
export function defaultPhoneColumn(header: readonly string[]): string | null {
  const aliases = header.filter((h) => (PHONE_ALIASES as readonly string[]).includes(h));
  if (aliases.length) return aliases[aliases.length - 1]!;
  return header.find((h) => /tel|phone/i.test(h)) ?? null;
}

/** Columnas por omisión: `telefono_1..3` presentes (en ese orden) o la del CLI. */
export function defaultPhoneColumns(header: readonly string[]): string[] {
  const crm = ['telefono_1', 'telefono_2', 'telefono_3'].filter((c) => header.includes(c));
  if (crm.length) return crm;
  const def = defaultPhoneColumn(header);
  return def ? [def] : [];
}

/** Agrega o quita columnas conservando el orden elegido (las nuevas van al final). */
export function reorderSelection(current: readonly string[], next: readonly string[], max: number): string[] {
  return [...current.filter((c) => next.includes(c)), ...next.filter((c) => !current.includes(c))].slice(0, max);
}

/** Mueve la columna `i` una posición (`-1` arriba, `1` abajo). */
export function movePhoneColumn(cols: readonly string[], i: number, dir: -1 | 1): string[] {
  const j = i + dir;
  if (i < 0 || i >= cols.length || j < 0 || j >= cols.length) return [...cols];
  const out = [...cols];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export const digitsOf = (s: string): string => s.replace(/\D/g, '');

/** Columnas de crédito del CLI (mismo orden que `v3/ana-backend/src/lib/publication.ts`). */
const CREDIT_COLUMNS = ['credit', 'credito', 'credit_id', 'id_credito'] as const;

/** Crédito normalizado de la fila (sin espacios, minúsculas; '' si no hay). */
export function creditKeyOf(record: Readonly<Record<string, string>>): string {
  for (const c of CREDIT_COLUMNS) {
    const v = (record[c] ?? '').replace(/\s+/g, '').toLowerCase();
    if (v) return v;
  }
  return '';
}

/**
 * Modo de teléfonos de la publicación (misma semántica que
 * `v3/ana-backend/src/lib/publication.ts`):
 * - `first`: un mensaje por crédito al primer teléfono válido en el orden de las columnas.
 * - `all`: un mensaje por teléfono válido (sin repetir teléfono por crédito).
 */
export type PhoneMode = 'first' | 'all';

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

/**
 * Teléfonos de cada fila seleccionada según el modo y el teléfono elegido por
 * fila (`overrides`, por `MergedRow.id`). Un teléfono no se repite para
 * el mismo crédito; en `first` un crédito recibe un solo mensaje. Un override que no
 * es uno de los teléfonos válidos de la fila se ignora (el backend lo rechaza).
 */
export function planPhones(
  rows: readonly MergedRow[],
  phoneColumns: readonly string[],
  mode: PhoneMode,
  overrides: ReadonlyMap<string, string> = new Map(),
): Map<string, string[]> {
  const seen = new Set<string>();
  const credits = new Set<string>();
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const candidates = phoneCandidates(r.record, phoneColumns);
    const credit = creditKeyOf(r.record);
    const ov = overrides.get(r.id);
    const match = ov !== undefined ? candidates.find((c) => digitsOf(c.phone) === digitsOf(ov)) : undefined;
    const list = match ? [match] : candidates;
    const keyOf = (c: PhoneCandidate) => credit + '|' + digitsOf(c.phone);
    const mine: string[] = [];
    if (mode === 'first') {
      const pick = credit && credits.has(credit) ? undefined : list.find((c) => !seen.has(keyOf(c)));
      if (pick) {
        seen.add(keyOf(pick));
        if (credit) credits.add(credit);
        mine.push(pick.phone);
      }
    } else {
      for (const c of list) {
        if (seen.has(keyOf(c))) continue;
        seen.add(keyOf(c));
        mine.push(c.phone);
      }
    }
    out.set(r.id, mine);
  }
  return out;
}

/** Modo `all` sin overrides (comportamiento previo). */
export const phonesFor = (rows: readonly MergedRow[], phoneColumns: readonly string[]): Map<string, string[]> => planPhones(rows, phoneColumns, 'all');

/** `rowKey` del publish: `<key del archivo>#<índice de fila>`. */
export const rowKeyOf = (files: readonly LoadedFile[], r: MergedRow): string => (files[r.file]?.key ?? '') + '#' + r.index;

/** `overrides` del publish: solo filas seleccionadas con un teléfono válido elegido. */
export function publishOverrides(
  files: readonly LoadedFile[],
  selected: readonly MergedRow[],
  phoneColumns: readonly string[],
  overrides: ReadonlyMap<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of selected) {
    const ov = overrides.get(r.id);
    if (ov === undefined) continue;
    if (phoneCandidates(r.record, phoneColumns).some((c) => digitsOf(c.phone) === digitsOf(ov))) out[rowKeyOf(files, r)] = ov;
  }
  return out;
}

/** Mensaje de una fila para un teléfono, como lo renderiza el backend al publicar. */
export function renderRow(template: string, header: readonly string[], record: Record<string, string>, phone: string) {
  const renderHeader = header.filter((h) => h.toLowerCase() !== UPLOAD_ID_COLUMN);
  const s = contactSources(
    renderHeader,
    renderHeader.map((h) => record[h] ?? ''),
  );
  s.fields.phone = phone;
  return renderTemplateDetailed(template, s);
}

/** Marcadores sin resolver en alguna de las filas (bloquean publicar). */
export function unknownMarkers(template: string, header: readonly string[], rows: readonly MergedRow[]): string[] {
  const out: string[] = [];
  const sample = rows.length ? rows : [{ id: 'x', file: 0, index: 0, record: Object.fromEntries(header.map((h) => [h, ''])), valid: true }];
  for (const r of sample) for (const u of renderRow(template, header, r.record, r.record.phone ?? '').unresolved) if (!out.includes(u)) out.push(u);
  return out;
}

export const unknownMarkersError = (markers: readonly string[]): string => markers.map((m) => `Variable desconocida: ${m}`).join(' · ');

/** `sources` del publish: por archivo, los índices seleccionados. */
export function publishSources(files: readonly LoadedFile[], selected: readonly MergedRow[]): Array<{ key: string; etag: string; rows: number[] }> {
  return files
    .map((f, i) => ({ key: f.key, etag: f.etag, rows: selected.filter((r) => r.file === i).map((r) => r.index).sort((a, b) => a - b) }))
    .filter((s) => s.rows.length > 0);
}

/** Últimos 4 dígitos del teléfono (`**1234`). */
export function maskPhone(v: string): string {
  const d = v.trim();
  return d ? `**${d.slice(-4)}` : '';
}

/** Primer mensaje de la columna `message` (precarga del editor). */
export function firstMessage(rows: readonly MergedRow[]): string {
  return rows.find((r) => (r.record.message ?? '').trim())?.record.message ?? '';
}
