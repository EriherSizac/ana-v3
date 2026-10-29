// Registro de estado de WhatsApp (add-whatsapp-status-registry, spec
// v3/whatsapp-status-registry): normalización, estado por fila, filtro y
// elección automática de teléfono. Módulo puro; la UI vive en
// components/workspace/WaStatus*.tsx y el hook en components/workspace/useWaStatus.ts.
import { digitsOf, phoneCandidates, type MergedRow, type PhoneMode } from '@/lib/workspace';

export type WaStatus = 'no_whatsapp' | 'has_whatsapp';

export interface WaRecord {
  status: WaStatus;
  updatedAt: string;
  updatedBy: string;
  source: string;
  lastNoWaAt: string | null;
  noWaCount: number;
}

/** Teléfono normalizado (`52` + 10) → registro. Los teléfonos sin registro no aparecen. */
export type WaMap = Readonly<Record<string, WaRecord>>;

/** Máximo por solicitud de consulta (igual que v3). */
export const WA_LOOKUP_CHUNK = 2000;

/**
 * `52` + 10 dígitos o null: 10 (nacional), 12 (`52` + 10) o 13 (`521` + 10).
 * Misma semántica que `normalizeWaPhone` de v3 (`src/lib/waStatus.ts`).
 */
export function normalizeWaPhone(raw: string): string | null {
  const d = digitsOf(raw ?? '');
  if (d.length === 10) return `52${d}`;
  if (d.length === 12 && d.startsWith('52')) return d;
  if (d.length === 13 && d.startsWith('521')) return `52${d.slice(3)}`;
  return null;
}

/** Teléfonos válidos de la fila en las columnas elegidas, normalizados (sin repetir). */
export function rowWaPhones(record: Readonly<Record<string, string>>, phoneColumns: readonly string[]): string[] {
  const out: string[] = [];
  for (const c of phoneCandidates(record, phoneColumns)) {
    const p = normalizeWaPhone(c.phone);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Todos los teléfonos a consultar (filas válidas), ordenados y sin repetir. */
export function lookupPhonesOf(rows: readonly MergedRow[], phoneColumns: readonly string[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.valid) for (const p of rowWaPhones(r.record, phoneColumns)) set.add(p);
  return [...set].sort();
}

/** Clasificación de la fila (design D8). */
export type WaRowState = 'no' | 'yes' | 'unknown';

export function rowWaState(record: Readonly<Record<string, string>>, phoneColumns: readonly string[], map: WaMap): WaRowState {
  const recs = rowWaPhones(record, phoneColumns).map((p) => map[p]).filter(Boolean) as WaRecord[];
  if (recs.some((r) => r.status === 'no_whatsapp')) return 'no';
  if (recs.some((r) => r.status === 'has_whatsapp')) return 'yes';
  return 'unknown';
}

export type WaFilter = 'all' | 'has' | 'no' | 'unknown';

export const WA_FILTER_OPTIONS: ReadonlyArray<{ value: WaFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'has', label: 'Con WhatsApp' },
  { value: 'no', label: 'Sin WhatsApp' },
  { value: 'unknown', label: 'Sin dato' },
];

export const matchesWaFilter = (state: WaRowState, filter: WaFilter): boolean =>
  filter === 'all' || (filter === 'has' && state === 'yes') || (filter === 'no' && state === 'no') || (filter === 'unknown' && state === 'unknown');

/**
 * Predicado del filtro WhatsApp para combinar con los demás filtros de la tabla
 * (`rows.filter(waFilterPredicate(...))`). Con `all` deja pasar todo.
 */
export function waFilterPredicate(phoneColumns: readonly string[], map: WaMap, filter: WaFilter): (row: MergedRow) => boolean {
  if (filter === 'all') return () => true;
  return (row) => matchesWaFilter(rowWaState(row.record, phoneColumns, map), filter);
}

/** Conteo por clasificación (para las etiquetas del filtro). */
export function countWaStates(rows: readonly MergedRow[], phoneColumns: readonly string[], map: WaMap): Record<WaRowState, number> {
  const out: Record<WaRowState, number> = { no: 0, yes: 0, unknown: 0 };
  for (const r of rows) if (r.valid) out[rowWaState(r.record, phoneColumns, map)]++;
  return out;
}

/** Teléfonos `no_whatsapp` de las filas (para "Marcar con WhatsApp"). */
export function noWaPhonesOf(rows: readonly MergedRow[], phoneColumns: readonly string[], map: WaMap): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const p of rowWaPhones(r.record, phoneColumns)) if (map[p]?.status === 'no_whatsapp') set.add(p);
  return [...set];
}

/**
 * Elección automática en modo `first` (design D9): si el primer teléfono válido
 * de una fila está marcado `no_whatsapp` y otro no lo está, se elige ese otro.
 * Las elecciones manuales (`overrides`) siempre ganan. Devuelve las elecciones
 * efectivas (manuales + automáticas) y las filas que cambiaron.
 */
export function waAutoOverrides(
  rows: readonly MergedRow[],
  phoneColumns: readonly string[],
  mode: PhoneMode,
  map: WaMap,
  overrides: ReadonlyMap<string, string>,
): { overrides: Map<string, string>; changed: Set<string> } {
  const out = new Map(overrides);
  const changed = new Set<string>();
  if (mode !== 'first') return { overrides: out, changed };
  for (const r of rows) {
    if (!r.valid || overrides.has(r.id)) continue;
    const candidates = phoneCandidates(r.record, phoneColumns);
    const isNo = (phone: string) => {
      const p = normalizeWaPhone(phone);
      return !!p && map[p]?.status === 'no_whatsapp';
    };
    if (candidates.length < 2 || !isNo(candidates[0]!.phone)) continue;
    const alt = candidates.find((c) => !isNo(c.phone));
    if (!alt) continue;
    out.set(r.id, alt.phone);
    changed.add(r.id);
  }
  return { overrides: out, changed };
}

const mxDay = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' });

/** `dd/mm/aaaa` en hora de Ciudad de México ('' si la fecha no es válida). */
export function formatWaDate(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? mxDay.format(new Date(t)) : '';
}

/** Texto de la insignia de un teléfono. */
export function waBadgeText(rec: WaRecord): string {
  if (rec.status === 'has_whatsapp') return 'Con WhatsApp';
  const date = formatWaDate(rec.lastNoWaAt ?? rec.updatedAt);
  const by = rec.updatedBy ? ` por ${rec.updatedBy}` : '';
  return date ? `Sin WhatsApp (marcado el ${date}${by})` : 'Sin WhatsApp';
}

/** Valida y filtra la respuesta de la consulta (defensivo ante respuestas parciales). */
export function parseWaItems(raw: unknown): Record<string, WaRecord> {
  const out: Record<string, WaRecord> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [phone, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<WaRecord> | null;
    if (!r || (r.status !== 'no_whatsapp' && r.status !== 'has_whatsapp')) continue;
    out[phone] = {
      status: r.status,
      updatedAt: String(r.updatedAt ?? ''),
      updatedBy: String(r.updatedBy ?? ''),
      source: String(r.source ?? ''),
      lastNoWaAt: typeof r.lastNoWaAt === 'string' ? r.lastNoWaAt : null,
      noWaCount: Number(r.noWaCount ?? 0) || 0,
    };
  }
  return out;
}
