import { describe, expect, it } from 'vitest';
import {
  amountColumns,
  applyFilters,
  categoryColumns,
  columnKind,
  distinctValues,
  emptyFilters,
  isFilterActive,
  loadTableState,
  nextSort,
  parseDate,
  parseNumber,
  saveTableState,
  sortRows,
  storageKey,
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
    const state = { filters: { search: 'x', values: { segmento_credito: ['A'] }, ranges: { saldo: { min: '1', max: '' } } }, sort: { column: 'saldo', dir: 'desc' as const } };
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
