// Filtros y orden de la tabla de contactos de "Mi asignación" (add-agent-workspace,
// "Filtros y orden de contactos"). Lógica pura: la vista solo guarda el estado.
import type { MergedRow } from './index';

export type SortDir = 'asc' | 'desc';
export interface SortState {
  column: string;
  dir: SortDir;
}

export interface RangeFilter {
  min: string;
  max: string;
}

export interface FilterState {
  search: string;
  /** Columna categórica → valores elegidos (normalizados con `normalizeValue`). */
  values: Record<string, string[]>;
  /** Columna de monto → rango (texto tal cual lo escribió el agente). */
  ranges: Record<string, RangeFilter>;
}

/** Columnas categóricas de la base CRM que se ofrecen como multiselect (design-system §7.1: 1–4). */
export const CATEGORY_COLUMNS = ['segmento_credito', 'estatus_credito', 'tramo_vencido', 'ultimo_resultado'] as const;

const AMOUNT_NAME = /saldo|monto|pago|balance|importe|amount|adeudo|deuda|capital|interes/i;

export const emptyFilters = (): FilterState => ({ search: '', values: {}, ranges: {} });

/** Espacios colapsados y recortados (como se muestra en la tabla). */
export const normalizeValue = (v: string): string => v.replace(/\s+/g, ' ').trim();

/** `$1,234.50`, `1234.5`, `-20` → número; cualquier otra cosa → null. */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/[\s$,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** `dd/mm/yyyy` (opcional `hh:mm[:ss]`) o `yyyy-mm-dd…` → epoch ms; si no, null. */
export function parseDate(raw: string): number | null {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
    const day = Number(d);
    const month = Number(mo);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return Date.UTC(Number(y), month - 1, day, Number(h), Number(mi), Number(se));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  }
  return null;
}

export type ColumnKind = 'number' | 'date' | 'text';

/** Tipo de la columna: numérica/fecha si todos sus valores no vacíos lo son. */
export function columnKind(rows: readonly MergedRow[], column: string): ColumnKind {
  let number = true;
  let date = true;
  let any = false;
  for (const r of rows) {
    const v = (r.record[column] ?? '').trim();
    if (!v) continue;
    any = true;
    if (number && parseNumber(v) === null) number = false;
    if (date && parseDate(v) === null) date = false;
    if (!number && !date) return 'text';
  }
  if (!any) return 'text';
  return number ? 'number' : date ? 'date' : 'text';
}

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/** Orden estable por columna; vacíos siempre al final (en ambas direcciones). */
export function sortRows(rows: readonly MergedRow[], sort: SortState | null): MergedRow[] {
  if (!sort) return [...rows];
  const kind = columnKind(rows, sort.column);
  const dir = sort.dir === 'asc' ? 1 : -1;
  const keyOf = (r: MergedRow): number | string | null => {
    const v = (r.record[sort.column] ?? '').trim();
    if (!v) return null;
    if (kind === 'number') return parseNumber(v);
    if (kind === 'date') return parseDate(v);
    return normalizeValue(v);
  };
  return rows
    .map((r, i) => ({ r, i, k: keyOf(r) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : collator.compare(String(a.k), String(b.k));
      return c !== 0 ? c * dir : a.i - b.i;
    })
    .map((x) => x.r);
}

/** Siguiente orden al pulsar el encabezado: asc → desc → asc (otra columna empieza en asc). */
export const nextSort = (current: SortState | null, column: string): SortState =>
  current?.column === column ? { column, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { column, dir: 'asc' };

/** Columnas categóricas presentes en el encabezado. */
export const categoryColumns = (header: readonly string[]): string[] => CATEGORY_COLUMNS.filter((c) => header.includes(c));

/** Columnas de monto: nombre de importe y todos sus valores no vacíos numéricos. */
export function amountColumns(header: readonly string[], rows: readonly MergedRow[], exclude: readonly string[] = []): string[] {
  return header.filter((h) => AMOUNT_NAME.test(h) && !exclude.includes(h) && columnKind(rows, h) === 'number' && rows.some((r) => (r.record[h] ?? '').trim()));
}

/** Valores distintos (normalizados, no vacíos) de una columna, ordenados. */
export function distinctValues(rows: readonly MergedRow[], column: string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = normalizeValue(r.record[column] ?? '');
    if (v) set.add(v);
  }
  return [...set].sort(collator.compare);
}

const rangeActive = (r: RangeFilter | undefined): boolean => !!r && (parseNumber(r.min) !== null || parseNumber(r.max) !== null);

/** Filtros activos que aplican a este encabezado (los de columnas ausentes se ignoran). */
export function isFilterActive(state: FilterState, header: readonly string[]): boolean {
  if (state.search.trim()) return true;
  if (Object.entries(state.values).some(([c, v]) => header.includes(c) && v.length > 0)) return true;
  return Object.entries(state.ranges).some(([c, r]) => header.includes(c) && rangeActive(r));
}

/** Filas que cumplen búsqueda (cualquier columna), multiselects (OR dentro, AND entre columnas) y rangos. */
export function applyFilters(rows: readonly MergedRow[], header: readonly string[], state: FilterState): MergedRow[] {
  const q = state.search.trim().toLowerCase();
  const values = Object.entries(state.values).filter(([c, v]) => header.includes(c) && v.length > 0);
  const ranges = Object.entries(state.ranges)
    .filter(([c, r]) => header.includes(c) && rangeActive(r))
    .map(([c, r]) => ({ column: c, min: parseNumber(r.min), max: parseNumber(r.max) }));
  return rows.filter((r) => {
    if (q && !header.some((h) => (r.record[h] ?? '').toLowerCase().includes(q))) return false;
    for (const [c, v] of values) if (!v.includes(normalizeValue(r.record[c] ?? ''))) return false;
    for (const { column, min, max } of ranges) {
      const n = parseNumber(r.record[column] ?? '');
      if (n === null) return false;
      if (min !== null && n < min) return false;
      if (max !== null && n > max) return false;
    }
    return true;
  });
}

export interface PersistedTableState {
  filters: FilterState;
  sort: SortState | null;
}

const STORAGE_PREFIX = 'ana.workspace.contacts.';
export const storageKey = (campaign: string) => `${STORAGE_PREFIX}${campaign}`;

const isStringRecord = <T>(v: unknown, ok: (x: unknown) => x is T): v is Record<string, T> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(ok);
const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const isRange = (x: unknown): x is RangeFilter =>
  !!x && typeof x === 'object' && typeof (x as RangeFilter).min === 'string' && typeof (x as RangeFilter).max === 'string';

/** Estado guardado de la campaña; cualquier error o forma inválida → estado vacío. */
export function loadTableState(campaign: string, storage?: Storage): PersistedTableState {
  const empty = { filters: emptyFilters(), sort: null };
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(storageKey(campaign));
    if (!raw) return empty;
    const v = JSON.parse(raw) as { filters?: Partial<FilterState>; sort?: unknown };
    const f = v.filters ?? {};
    const sort =
      v.sort && typeof v.sort === 'object' && typeof (v.sort as SortState).column === 'string' && ['asc', 'desc'].includes((v.sort as SortState).dir)
        ? { column: (v.sort as SortState).column, dir: (v.sort as SortState).dir }
        : null;
    return {
      filters: {
        search: typeof f.search === 'string' ? f.search : '',
        values: isStringRecord(f.values, isStringArray) ? f.values : {},
        ranges: isStringRecord(f.ranges, isRange) ? f.ranges : {},
      },
      sort,
    };
  } catch {
    return empty;
  }
}

/** Guarda el estado (silencioso si el almacenamiento no está disponible o está lleno). */
export function saveTableState(campaign: string, state: PersistedTableState, storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(storageKey(campaign), JSON.stringify(state));
  } catch {
    /* almacenamiento no disponible */
  }
}
