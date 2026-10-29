// Filtros y orden de la tabla de contactos de "Mi asignación" (add-agent-workspace,
// "Filtros y orden de contactos"). Lógica pura: la vista solo guarda el estado.
import { isDateColumnName, parseDisplayDate } from '../contacts/excelDates';
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

/** Rango de fechas `dd/mm/yyyy` (texto tal cual lo escribió el agente; ambos extremos inclusivos). */
export interface DateRangeFilter {
  from: string;
  to: string;
}

/**
 * Filtro de encabezado de una columna (estilo Excel). Las partes presentes se
 * combinan con AND; dentro de `values`, OR. `''` en `values` = celdas vacías.
 */
export interface ColumnFilter {
  values?: string[];
  number?: RangeFilter;
  date?: DateRangeFilter;
}
export type ColumnFilterPart = keyof ColumnFilter;

export interface FilterState {
  search: string;
  /** Columna categórica → valores elegidos (normalizados con `normalizeValue`). */
  values: Record<string, string[]>;
  /** Columna de monto → rango (texto tal cual lo escribió el agente). */
  ranges: Record<string, RangeFilter>;
  /** Filtros por encabezado de columna; se suman (AND) a los de la barra de filtros. */
  columns: Record<string, ColumnFilter>;
}

/** Columnas categóricas de la base CRM que se ofrecen como multiselect (design-system §7.1: 1–4). */
export const CATEGORY_COLUMNS = ['segmento_credito', 'estatus_credito', 'tramo_vencido', 'ultimo_resultado'] as const;

const AMOUNT_NAME = /saldo|monto|pago|balance|importe|amount|adeudo|deuda|capital|interes/i;

export const emptyFilters = (): FilterState => ({ search: '', values: {}, ranges: {}, columns: {} });

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

const DAY_MS = 86_400_000;

/**
 * Día (ms UTC a medianoche) de una celda o de un extremo del rango: `dd/mm/yyyy`
 * (con hora opcional, que se ignora) vía `parseDisplayDate`; ISO como respaldo.
 */
export function parseDay(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const first = s.split(/[\sT]/)[0] ?? '';
  if (first.includes('/')) return parseDisplayDate(first);
  const t = parseDate(s);
  return t === null ? null : Math.floor(t / DAY_MS) * DAY_MS;
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

/**
 * Tipo para el filtro de encabezado: fecha por nombre (`isDateColumnName`) o por
 * contenido; número por contenido. `forceText` (teléfonos) → solo lista de valores.
 */
export function columnFilterKind(rows: readonly MergedRow[], column: string, forceText = false): ColumnKind {
  if (forceText) return 'text';
  if (isDateColumnName(column)) return 'date';
  return columnKind(rows, column);
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
const dateRangeActive = (r: DateRangeFilter | undefined): boolean => !!r && (parseDay(r.from) !== null || parseDay(r.to) !== null);

/** El filtro de encabezado restringe algo (valores elegidos o algún extremo válido). */
export function columnFilterActive(f: ColumnFilter | undefined): boolean {
  return !!f && ((f.values?.length ?? 0) > 0 || rangeActive(f.number) || dateRangeActive(f.date));
}

/** Filtros activos que aplican a este encabezado (los de columnas ausentes se ignoran). */
export function isFilterActive(state: FilterState, header: readonly string[]): boolean {
  if (state.search.trim()) return true;
  if (Object.entries(state.values).some(([c, v]) => header.includes(c) && v.length > 0)) return true;
  if (Object.entries(state.columns).some(([c, f]) => header.includes(c) && columnFilterActive(f))) return true;
  return Object.entries(state.ranges).some(([c, r]) => header.includes(c) && rangeActive(r));
}

type RowTest = (r: MergedRow) => boolean;

/** Predicados de los filtros de encabezado activos (uno por parte). */
function columnTests(columns: Record<string, ColumnFilter>, header: readonly string[], exceptColumn?: string): RowTest[] {
  const tests: RowTest[] = [];
  for (const [c, f] of Object.entries(columns)) {
    if (c === exceptColumn || !header.includes(c) || !columnFilterActive(f)) continue;
    if (f.values?.length) {
      const set = new Set(f.values);
      tests.push((r) => set.has(normalizeValue(r.record[c] ?? '')));
    }
    if (rangeActive(f.number)) {
      const min = parseNumber(f.number!.min);
      const max = parseNumber(f.number!.max);
      tests.push((r) => {
        const n = parseNumber(r.record[c] ?? '');
        return n !== null && (min === null || n >= min) && (max === null || n <= max);
      });
    }
    if (dateRangeActive(f.date)) {
      const from = parseDay(f.date!.from);
      const to = parseDay(f.date!.to);
      tests.push((r) => {
        const d = parseDay(r.record[c] ?? '');
        return d !== null && (from === null || d >= from) && (to === null || d <= to);
      });
    }
  }
  return tests;
}

/**
 * Filas que cumplen búsqueda (cualquier columna), multiselects (OR dentro, AND
 * entre columnas), rangos y filtros de encabezado. `exceptColumn` omite el
 * filtro de encabezado de esa columna (para listar sus valores estilo Excel).
 */
export function applyFilters(rows: readonly MergedRow[], header: readonly string[], state: FilterState, exceptColumn?: string): MergedRow[] {
  const q = state.search.trim().toLowerCase();
  const values = Object.entries(state.values).filter(([c, v]) => header.includes(c) && v.length > 0);
  const ranges = Object.entries(state.ranges)
    .filter(([c, r]) => header.includes(c) && rangeActive(r))
    .map(([c, r]) => ({ column: c, min: parseNumber(r.min), max: parseNumber(r.max) }));
  const tests = columnTests(state.columns ?? {}, header, exceptColumn);
  return rows.filter((r) => {
    if (q && !header.some((h) => (r.record[h] ?? '').toLowerCase().includes(q))) return false;
    for (const [c, v] of values) if (!v.includes(normalizeValue(r.record[c] ?? ''))) return false;
    for (const { column, min, max } of ranges) {
      const n = parseNumber(r.record[column] ?? '');
      if (n === null) return false;
      if (min !== null && n < min) return false;
      if (max !== null && n > max) return false;
    }
    for (const t of tests) if (!t(r)) return false;
    return true;
  });
}

// ── Valores del filtro de encabezado (se calculan solo al abrir el popover) ──

export interface ValueCount {
  /** Valor normalizado; `''` = celdas vacías. */
  value: string;
  count: number;
}

/** Valores distintos con su número de filas: más frecuentes primero, empates en orden alfabético; vacías al final. */
export function columnValueCounts(rows: readonly MergedRow[], column: string): ValueCount[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = normalizeValue(r.record[column] ?? '');
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (a.value === '' ? 1 : b.value === '' ? -1 : b.count - a.count || collator.compare(a.value, b.value)));
}

/** Texto para buscar: sin acentos ni mayúsculas. */
export const foldSearch = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Máximo de valores listados en el popover (el resto se encuentra con la búsqueda). */
export const MAX_FILTER_VALUES = 200;

/**
 * Valores a listar: los que coinciden con la búsqueda (por valor o etiqueta),
 * hasta `limit`; los elegidos que no están en `counts` (ocultos por otros
 * filtros) se agregan con 0 para poder quitarlos. `matches` = coincidencias totales.
 */
export function visibleValues(
  counts: readonly ValueCount[],
  query: string,
  selected: readonly string[],
  limit = MAX_FILTER_VALUES,
  label: (v: string) => string = (v) => v,
): { items: ValueCount[]; matches: ValueCount[] } {
  const q = foldSearch(query);
  const known = new Set(counts.map((c) => c.value));
  const all = [...counts, ...selected.filter((v) => !known.has(v)).map((value) => ({ value, count: 0 }))];
  const matches = q ? all.filter((c) => foldSearch(c.value).includes(q) || foldSearch(label(c.value)).includes(q)) : all;
  return { items: matches.slice(0, limit), matches };
}

/** Columnas con filtros de encabezado: quita la parte indicada (o todo) y descarta las vacías. */
export function setColumnFilter(columns: Record<string, ColumnFilter>, column: string, next: ColumnFilter | undefined): Record<string, ColumnFilter> {
  const out = { ...columns };
  const clean: ColumnFilter = {};
  if (next?.values?.length) clean.values = next.values;
  if (next?.number && (next.number.min.trim() || next.number.max.trim())) clean.number = next.number;
  if (next?.date && (next.date.from.trim() || next.date.to.trim())) clean.date = next.date;
  if (Object.keys(clean).length) out[column] = clean;
  else delete out[column];
  return out;
}

export function removeColumnFilterPart(columns: Record<string, ColumnFilter>, column: string, part: ColumnFilterPart): Record<string, ColumnFilter> {
  const f = { ...columns[column] };
  delete f[part];
  return setColumnFilter(columns, column, f);
}

/** Etiqueta de una celda vacía en filtros y pills. */
export const EMPTY_VALUE_LABEL = '(Vacías)';

export interface ColumnFilterPill {
  key: string;
  column: string;
  part: ColumnFilterPart;
  label: string;
}

/** Pills de los filtros de encabezado activos (una por columna y parte). */
export function columnFilterPills(columns: Record<string, ColumnFilter>, header: readonly string[], label: (column: string, v: string) => string = (_c, v) => v): ColumnFilterPill[] {
  const pills: ColumnFilterPill[] = [];
  for (const c of header) {
    const f = columns[c];
    if (!f) continue;
    if (f.values?.length) {
      const shown = f.values.map((v) => (v ? label(c, v) : EMPTY_VALUE_LABEL));
      pills.push({ key: `c:${c}:values`, column: c, part: 'values', label: shown.length <= 3 ? `${c}: ${shown.join(', ')}` : `${c}: ${shown.length} valores` });
    }
    if (rangeActive(f.number)) {
      const min = parseNumber(f.number!.min);
      const max = parseNumber(f.number!.max);
      const text = min !== null && max !== null ? `${c}: ${min} – ${max}` : min !== null ? `${c} ≥ ${min}` : `${c} ≤ ${max}`;
      pills.push({ key: `c:${c}:number`, column: c, part: 'number', label: text });
    }
    if (dateRangeActive(f.date)) {
      const from = parseDay(f.date!.from) !== null ? f.date!.from.trim() : null;
      const to = parseDay(f.date!.to) !== null ? f.date!.to.trim() : null;
      const text = from && to ? `${c}: ${from} – ${to}` : from ? `${c} desde ${from}` : `${c} hasta ${to}`;
      pills.push({ key: `c:${c}:date`, column: c, part: 'date', label: text });
    }
  }
  return pills;
}

// ── Persistencia ─────────────────────────────────────────────────────────────

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
const isDateRange = (x: unknown): x is DateRangeFilter =>
  !!x && typeof x === 'object' && typeof (x as DateRangeFilter).from === 'string' && typeof (x as DateRangeFilter).to === 'string';

/** Filtros de encabezado guardados: se conservan solo las partes con forma válida. */
function loadColumns(v: unknown): Record<string, ColumnFilter> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  let out: Record<string, ColumnFilter> = {};
  for (const [c, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    out = setColumnFilter(out, c, {
      values: isStringArray(f.values) ? f.values : undefined,
      number: isRange(f.number) ? { min: f.number.min, max: f.number.max } : undefined,
      date: isDateRange(f.date) ? { from: f.date.from, to: f.date.to } : undefined,
    });
  }
  return out;
}

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
        columns: loadColumns(f.columns),
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
