import { describe, expect, it } from 'vitest';
import {
  amountColumns,
  applyFilters,
  categoryColumns,
  columnFilterActive,
  columnFilterKind,
  columnFilterPills,
  columnValueCounts,
  columnKind,
  distinctValues,
  emptyFilters,
  isFilterActive,
  loadTableState,
  MAX_FILTER_VALUES,
  nextSort,
  parseDate,
  parseDay,
  parseNumber,
  removeColumnFilterPart,
  saveTableState,
  setColumnFilter,
  sortRows,
  storageKey,
  visibleValues,
  type ColumnFilter,
  type MergedRow,
} from '@/lib/workspace';

/** add-agent-workspace: "Filtros y orden de contactos" (lógica pura). */
const row = (i: number, record: Record<string, string>): MergedRow => ({ id: `0:${i}`, file: 0, index: i, record, valid: true });
const ROWS = [
  row(0, { nombre: 'Beto', saldo_vencido_actual: '$1,200.50', fecha: '05/03/2026', segmento_credito: 'A', tramo_vencido: '1-30' }),
  row(1, { nombre: 'ana', saldo_vencido_actual: '300', fecha: '28/12/2025', segmento_credito: 'B ', tramo_vencido: '31-60' }),
  row(2, { nombre: 'Carla', saldo_vencido_actual: '', fecha: '', segmento_credito: 'A', tramo_vencido: '1-30' }),
  row(3, { nombre: 'Álvaro', saldo_vencido_actual: '15000', fecha: '01/03/2026', segmento_credito: 'C', tramo_vencido: '61-90' }),
];
const HEADER = ['nombre', 'saldo_vencido_actual', 'fecha', 'segmento_credito', 'tramo_vencido'];
const names = (rs: MergedRow[]) => rs.map((r) => r.record.nombre);
const EMPTY = { filters: emptyFilters(), sort: null };

describe('parseo', () => {
  it('números con $ y separador de miles', () => {
    expect(parseNumber('$1,200.50')).toBe(1200.5);
    expect(parseNumber(' -20 ')).toBe(-20);
    expect(parseNumber('12abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
  it('fechas dd/mm/yyyy (con hora opcional) e ISO', () => {
    expect(parseDate('05/03/2026')).toBe(Date.UTC(2026, 2, 5));
    expect(parseDate('5/3/2026 14:30')).toBe(Date.UTC(2026, 2, 5, 14, 30));
    expect(parseDate('2026-03-05')).toBe(Date.UTC(2026, 2, 5));
    expect(parseDate('31/13/2026')).toBeNull();
    expect(parseDate('hola')).toBeNull();
  });
  it('tipo de columna', () => {
    expect(columnKind(ROWS, 'saldo_vencido_actual')).toBe('number');
    expect(columnKind(ROWS, 'fecha')).toBe('date');
    expect(columnKind(ROWS, 'nombre')).toBe('text');
  });
});

describe('orden', () => {
  it('numérico (no lexicográfico) con vacíos al final en ambas direcciones', () => {
    expect(names(sortRows(ROWS, { column: 'saldo_vencido_actual', dir: 'asc' }))).toEqual(['ana', 'Beto', 'Álvaro', 'Carla']);
    expect(names(sortRows(ROWS, { column: 'saldo_vencido_actual', dir: 'desc' }))).toEqual(['Álvaro', 'Beto', 'ana', 'Carla']);
  });
  it('fechas dd/mm/yyyy por fecha real', () => {
    expect(names(sortRows(ROWS, { column: 'fecha', dir: 'asc' }))).toEqual(['ana', 'Álvaro', 'Beto', 'Carla']);
  });
  it('texto sin distinguir mayúsculas ni acentos', () => {
    expect(names(sortRows(ROWS, { column: 'nombre', dir: 'asc' }))).toEqual(['Álvaro', 'ana', 'Beto', 'Carla']);
  });
  it('sin orden conserva el original; nextSort alterna asc/desc', () => {
    expect(names(sortRows(ROWS, null))).toEqual(['Beto', 'ana', 'Carla', 'Álvaro']);
    expect(nextSort(null, 'a')).toEqual({ column: 'a', dir: 'asc' });
    expect(nextSort({ column: 'a', dir: 'asc' }, 'a')).toEqual({ column: 'a', dir: 'desc' });
    expect(nextSort({ column: 'a', dir: 'desc' }, 'a')).toEqual({ column: 'a', dir: 'asc' });
    expect(nextSort({ column: 'a', dir: 'desc' }, 'b')).toEqual({ column: 'b', dir: 'asc' });
  });
});

describe('filtros', () => {
  it('columnas categóricas presentes, de monto y valores distintos normalizados', () => {
    expect(categoryColumns(HEADER)).toEqual(['segmento_credito', 'tramo_vencido']);
    expect(amountColumns(HEADER, ROWS)).toEqual(['saldo_vencido_actual']);
    expect(amountColumns(HEADER, ROWS, ['saldo_vencido_actual'])).toEqual([]);
    expect(distinctValues(ROWS, 'segmento_credito')).toEqual(['A', 'B', 'C']);
  });
  it('multiselect: OR dentro de la columna, AND entre columnas', () => {
    const f = { ...emptyFilters(), values: { segmento_credito: ['A', 'B'], tramo_vencido: ['1-30'] } };
    expect(names(applyFilters(ROWS, HEADER, f))).toEqual(['Beto', 'Carla']);
    expect(names(applyFilters(ROWS, HEADER, { ...emptyFilters(), values: { segmento_credito: ['B'] } }))).toEqual(['ana']);
  });
  it('rango numérico min/max; vacíos quedan fuera; texto inválido se ignora', () => {
    expect(names(applyFilters(ROWS, HEADER, { ...emptyFilters(), ranges: { saldo_vencido_actual: { min: '500', max: '' } } }))).toEqual(['Beto', 'Álvaro']);
    expect(names(applyFilters(ROWS, HEADER, { ...emptyFilters(), ranges: { saldo_vencido_actual: { min: '', max: '1,500' } } }))).toEqual(['Beto', 'ana']);
    expect(applyFilters(ROWS, HEADER, { ...emptyFilters(), ranges: { saldo_vencido_actual: { min: 'x', max: '' } } })).toHaveLength(4);
  });
  it('búsqueda en cualquier columna; filtros de columnas ausentes se ignoran', () => {
    expect(names(applyFilters(ROWS, HEADER, { ...emptyFilters(), search: 'CAR' }))).toEqual(['Carla']);
    const ghost = { ...emptyFilters(), values: { estatus_credito: ['X'] } };
    expect(applyFilters(ROWS, HEADER, ghost)).toHaveLength(4);
    expect(isFilterActive(ghost, HEADER)).toBe(false);
    expect(isFilterActive({ ...emptyFilters(), search: ' a ' }, HEADER)).toBe(true);
  });
});

describe('persistencia por campaña', () => {
  const memory = () => {
    const m = new Map<string, string>();
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    };
    return { s: s as unknown as Storage, m };
  };

  it('guarda y carga por campaña', () => {
    const { s, m } = memory();
    const state = { filters: { search: 'x', values: { segmento_credito: ['A'] }, ranges: { saldo: { min: '1', max: '' } }, columns: { nombre: { values: ['Beto'] }, fecha: { date: { from: '01/03/2026', to: '' } } } }, sort: { column: 'saldo', dir: 'desc' as const } };
    saveTableState('prueba', state, s);
    expect(m.has(storageKey('prueba'))).toBe(true);
    expect(loadTableState('prueba', s)).toEqual(state);
    expect(loadTableState('otra', s)).toEqual(EMPTY);
  });

  it('JSON inválido, forma inválida o almacenamiento que lanza → estado vacío sin error', () => {
    const { s } = memory();
    s.setItem(storageKey('a'), '{nope');
    expect(loadTableState('a', s)).toEqual(EMPTY);
    s.setItem(storageKey('b'), JSON.stringify({ filters: { search: 3, values: { c: 'x' } }, sort: { column: 'c', dir: 'up' } }));
    expect(loadTableState('b', s)).toEqual(EMPTY);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    } as unknown as Storage;
    expect(loadTableState('a', throwing)).toEqual(EMPTY);
    expect(() => saveTableState('a', EMPTY, throwing)).not.toThrow();
  });
});

describe('filtros de encabezado (estilo Excel)', () => {
  const withCols = (columns: Record<string, ColumnFilter>) => ({ ...emptyFilters(), columns });

  it('valores: OR dentro de la columna; "" = celdas vacías; AND con la barra de filtros', () => {
    expect(names(applyFilters(ROWS, HEADER, withCols({ segmento_credito: { values: ['A', 'C'] } })))).toEqual(['Beto', 'Carla', 'Álvaro']);
    expect(names(applyFilters(ROWS, HEADER, withCols({ fecha: { values: [''] } })))).toEqual(['Carla']);
    const both = { ...withCols({ segmento_credito: { values: ['A'] } }), values: { tramo_vencido: ['1-30'] }, search: 'carla' };
    expect(names(applyFilters(ROWS, HEADER, both))).toEqual(['Carla']);
  });

  it('rango numérico y de fechas dd/mm/yyyy (extremos inclusivos; vacías fuera)', () => {
    expect(names(applyFilters(ROWS, HEADER, withCols({ saldo_vencido_actual: { number: { min: '300', max: '1200.50' } } })))).toEqual(['Beto', 'ana']);
    expect(names(applyFilters(ROWS, HEADER, withCols({ fecha: { date: { from: '01/03/2026', to: '05/03/2026' } } })))).toEqual(['Beto', 'Álvaro']);
    expect(names(applyFilters(ROWS, HEADER, withCols({ fecha: { date: { from: '', to: '31/12/2025' } } })))).toEqual(['ana']);
    // Texto inválido no filtra.
    expect(applyFilters(ROWS, HEADER, withCols({ fecha: { date: { from: '2026', to: '' } } }))).toHaveLength(4);
  });

  it('exceptColumn omite solo el filtro de esa columna; columnas ausentes se ignoran', () => {
    const f = withCols({ segmento_credito: { values: ['A'] }, tramo_vencido: { values: ['1-30'] }, otra: { values: ['x'] } });
    expect(names(applyFilters(ROWS, HEADER, f))).toEqual(['Beto', 'Carla']);
    expect(names(applyFilters(ROWS, HEADER, f, 'segmento_credito'))).toEqual(['Beto', 'Carla']);
    expect(names(applyFilters(ROWS, HEADER, withCols({ segmento_credito: { values: ['C'] }, tramo_vencido: { values: ['1-30'] } }), 'tramo_vencido'))).toEqual(['Álvaro']);
    expect(isFilterActive(withCols({ otra: { values: ['x'] } }), HEADER)).toBe(false);
    expect(isFilterActive(withCols({ nombre: { values: ['ana'] } }), HEADER)).toBe(true);
    expect(columnFilterActive({ number: { min: 'x', max: '' } })).toBe(false);
  });

  it('parseDay: dd/mm/yyyy con hora opcional e ISO → día UTC', () => {
    expect(parseDay('05/03/2026')).toBe(Date.UTC(2026, 2, 5));
    expect(parseDay('5/3/2026 14:30')).toBe(Date.UTC(2026, 2, 5));
    expect(parseDay('2026-03-05T10:00')).toBe(Date.UTC(2026, 2, 5));
    expect(parseDay('31/02/2026')).toBeNull();
    expect(parseDay('')).toBeNull();
  });

  it('tipo del filtro: fecha por nombre, número por contenido, teléfonos solo valores', () => {
    expect(columnFilterKind(ROWS, 'fecha')).toBe('date');
    expect(columnFilterKind(ROWS, 'saldo_vencido_actual')).toBe('number');
    expect(columnFilterKind(ROWS, 'saldo_vencido_actual', true)).toBe('text');
    expect(columnFilterKind(ROWS, 'nombre')).toBe('text');
  });

  it('conteos: más frecuentes primero, empates alfabéticos, vacías al final', () => {
    expect(columnValueCounts(ROWS, 'segmento_credito')).toEqual([
      { value: 'A', count: 2 },
      { value: 'B', count: 1 },
      { value: 'C', count: 1 },
    ]);
    expect(columnValueCounts(ROWS, 'fecha').at(-1)).toEqual({ value: '', count: 1 });
  });

  it('visibleValues: límite top N, búsqueda sin acentos y elegidos ausentes con 0', () => {
    const counts = Array.from({ length: 500 }, (_, i) => ({ value: `v${i}`, count: 500 - i }));
    const all = visibleValues(counts, '', []);
    expect(all.items).toHaveLength(MAX_FILTER_VALUES);
    expect(all.matches).toHaveLength(500);
    expect(visibleValues(counts, 'v499', []).items).toEqual([{ value: 'v499', count: 1 }]);
    expect(visibleValues([{ value: 'Álvaro', count: 1 }], 'alv', []).items).toHaveLength(1);
    expect(visibleValues(counts, 'zz', ['zz']).items).toEqual([{ value: 'zz', count: 0 }]);
    expect(visibleValues([{ value: '5215500000001', count: 1 }], '0001', [], 10, () => '52155****001').items).toHaveLength(1);
  });

  it('setColumnFilter/removeColumnFilterPart descartan partes vacías; pills por parte', () => {
    let cols = setColumnFilter({}, 'fecha', { values: [], date: { from: '01/03/2026', to: '' } });
    expect(cols).toEqual({ fecha: { date: { from: '01/03/2026', to: '' } } });
    cols = setColumnFilter(cols, 'nombre', { values: ['ana', 'Beto', 'Carla', ''] });
    cols = setColumnFilter(cols, 'saldo_vencido_actual', { number: { min: '', max: '500' } });
    expect(columnFilterPills(cols, HEADER).map((p) => p.label)).toEqual(['nombre: 4 valores', 'saldo_vencido_actual ≤ 500', 'fecha desde 01/03/2026']);
    expect(columnFilterPills({ nombre: { values: ['ana', ''] } }, HEADER).map((p) => p.label)).toEqual(['nombre: ana, (Vacías)']);
    expect(columnFilterPills({ fecha: { date: { from: '01/03/2026', to: '05/03/2026' } } }, HEADER)[0]!.label).toBe('fecha: 01/03/2026 – 05/03/2026');
    cols = removeColumnFilterPart(cols, 'fecha', 'date');
    expect(cols.fecha).toBeUndefined();
    expect(setColumnFilter(cols, 'nombre', undefined).nombre).toBeUndefined();
  });

  it('persistencia: partes inválidas de filtros de encabezado se descartan; estado viejo sin `columns` carga vacío', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage;
    m.set(storageKey('p'), JSON.stringify({ filters: { search: '', values: {}, ranges: {}, columns: { a: { values: ['x'], number: { min: 1 } }, b: 'nope', c: { date: { from: '', to: '' } } } }, sort: null }));
    expect(loadTableState('p', s).filters.columns).toEqual({ a: { values: ['x'] } });
    m.set(storageKey('q'), JSON.stringify({ filters: { search: 'z', values: {}, ranges: {} }, sort: null }));
    expect(loadTableState('q', s).filters).toEqual({ ...emptyFilters(), search: 'z' });
  });
});
