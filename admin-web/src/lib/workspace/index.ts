// Lógica de "Mi asignación" (add-agent-workspace): combinación de pendientes,
// columnas de teléfono y vista previa del mensaje con la semántica del CLI v3.
// El backend v3 repite el cálculo al publicar; aquí solo es la vista previa.
import { contactSources, parseAssignmentCsv, PHONE_ALIASES, UPLOAD_ID_COLUMN, type ParsedAssignment } from './csv';
import { renderTemplateDetailed } from './template';

export * from './csv';
export * from './template';

export interface PendingFile {
  key: string;
  fileName: string;
  lastModified: string | null;
  size: number | null;
  etag: string | null;
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

export const digitsOf = (s: string): string => s.replace(/\D/g, '');

/** Teléfonos de cada fila seleccionada (≥ 10 dígitos, sin repetir en toda la selección, en orden). */
export function phonesFor(rows: readonly MergedRow[], phoneColumns: readonly string[]): Map<string, string[]> {
  const seen = new Set<string>();
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const mine: string[] = [];
    for (const c of phoneColumns) {
      const v = r.record[c] ?? '';
      const d = digitsOf(v);
      if (d.length < 10 || seen.has(d)) continue;
      seen.add(d);
      mine.push(v);
    }
    out.set(r.id, mine);
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
