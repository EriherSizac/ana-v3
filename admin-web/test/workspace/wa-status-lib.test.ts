import { describe, expect, it } from 'vitest';
import { loadFile, mergeFiles, planPhones, publishOverrides, publishSources } from '@/lib/workspace';
import {
  countWaStates,
  formatWaDate,
  lookupPhonesOf,
  noWaPhonesOf,
  normalizeWaPhone,
  parseWaItems,
  rowWaState,
  waAutoOverrides,
  waBadgeText,
  waFilterPredicate,
  type WaMap,
  type WaRecord,
} from '@/lib/wa-status';
// Lo que de verdad publica v3: la elección automática debe producir el mismo archivo.
import { buildPublication, overridesBySource } from '../../../v3/ana-backend/src/lib/publication';
import { parseAssignmentCsv as backendParse } from '../../../v3/ana-backend/src/lib/assignmentCsv';

/** add-whatsapp-status-registry: lógica pura del registro en ANA Admin. */
const rec = (status: WaRecord['status'], over: Partial<WaRecord> = {}): WaRecord => ({
  status,
  updatedAt: '2026-10-29T17:00:00.000Z',
  updatedBy: 'luis',
  source: 'cli_send',
  lastNoWaAt: status === 'no_whatsapp' ? '2026-10-29T17:00:00.000Z' : null,
  noWaCount: status === 'no_whatsapp' ? 1 : 0,
  ...over,
});

const KEY = 'assignments/agents/prueba/ana-contacts-T1.csv';
const CSV =
  'telefono_1,telefono_2,credito,nombre\n' +
  '5215500000001,5215500000002,CR-1,Ana\n' + // 1º marcado sin WA → 2º
  '5215500000003,5215500000004,CR-2,Beto\n' + // sin marcas
  '5215500000005,5215500000006,CR-3,Carla\n' + // ambos marcados → sin cambio
  '5215500000007,,CR-4,Dora\n' + // un solo teléfono marcado → sin cambio
  '5215500000008,5215500000009,CR-5,Eva\n'; // 1º con WhatsApp
const MAP: WaMap = {
  '525500000001': rec('no_whatsapp'),
  '525500000005': rec('no_whatsapp'),
  '525500000006': rec('no_whatsapp'),
  '525500000007': rec('no_whatsapp'),
  '525500000008': rec('has_whatsapp'),
};
const COLS = ['telefono_1', 'telefono_2'];
const files = [loadFile(KEY, '"e1"', CSV)];
const merged = mergeFiles(files);

describe('normalización', () => {
  // Misma tabla que test/waStatus.test.ts de v3 (sin importar el módulo: depende del SDK de DynamoDB).
  it('igual que v3 en formatos MX y no MX', () => {
    const cases: Array<[string, string | null]> = [
      ['5512345678', '525512345678'],
      ['525512345678', '525512345678'],
      ['5215512345678', '525512345678'],
      ['+52 1 55 1234 5678', '525512345678'],
      ['15512345678', null],
      ['4415512345678', null],
      ['', null],
      ['abc', null],
    ];
    for (const [p, want] of cases) expect(normalizeWaPhone(p), p).toBe(want);
  });
});

describe('estado por fila y filtro (D8)', () => {
  it('clasifica y cuenta filas', () => {
    expect(merged.rows.map((r) => rowWaState(r.record, COLS, MAP))).toEqual(['no', 'unknown', 'no', 'no', 'yes']);
    expect(countWaStates(merged.rows, COLS, MAP)).toEqual({ no: 3, yes: 1, unknown: 1 });
    expect(lookupPhonesOf(merged.rows, COLS)).toHaveLength(9);
  });

  it('el predicado combina con otros filtros (Todos deja pasar todo)', () => {
    const ids = (f: Parameters<typeof waFilterPredicate>[2]) => merged.rows.filter(waFilterPredicate(COLS, MAP, f)).map((r) => r.record.nombre);
    expect(ids('all')).toHaveLength(5);
    expect(ids('no')).toEqual(['Ana', 'Carla', 'Dora']);
    expect(ids('has')).toEqual(['Eva']);
    expect(ids('unknown')).toEqual(['Beto']);
    expect(merged.rows.filter((r) => /^[AE]/.test(r.record.nombre ?? '')).filter(waFilterPredicate(COLS, MAP, 'no')).map((r) => r.record.nombre)).toEqual(['Ana']);
  });

  it('teléfonos sin WhatsApp a marcar', () => {
    expect(noWaPhonesOf(merged.rows.slice(0, 3), COLS, MAP).sort()).toEqual(['525500000001', '525500000005', '525500000006']);
  });

  it('textos de la insignia con fecha MX y autor', () => {
    expect(waBadgeText(rec('no_whatsapp', { lastNoWaAt: '2026-10-29T03:00:00.000Z' }))).toBe('Sin WhatsApp (marcado el 28/10/2026 por luis)');
    expect(waBadgeText(rec('has_whatsapp'))).toBe('Con WhatsApp');
    expect(formatWaDate('x')).toBe('');
  });

  it('parseWaItems descarta registros inválidos', () => {
    expect(parseWaItems({ a: { status: 'raro' }, b: rec('has_whatsapp') })).toEqual({ b: rec('has_whatsapp') });
    expect(parseWaItems(null)).toEqual({});
  });
});

describe('elección automática en modo first (D9)', () => {
  it('salta al siguiente teléfono no marcado; la elección manual gana; en all no cambia', () => {
    const auto = waAutoOverrides(merged.rows, COLS, 'first', MAP, new Map());
    expect([...auto.changed]).toEqual(['0:0']);
    expect(auto.overrides.get('0:0')).toBe('5215500000002');
    const manual = waAutoOverrides(merged.rows, COLS, 'first', MAP, new Map([['0:0', '5215500000001']]));
    expect(manual.changed.size).toBe(0);
    expect(manual.overrides.get('0:0')).toBe('5215500000001');
    expect(waAutoOverrides(merged.rows, COLS, 'all', MAP, new Map()).changed.size).toBe(0);
  });

  it('el archivo que publica v3 coincide con la vista previa', () => {
    const selected = merged.rows.filter((r) => r.valid);
    const { overrides } = waAutoOverrides(selected, COLS, 'first', MAP, new Map());
    const plan = planPhones(selected, COLS, 'first', overrides);
    const req = { sources: publishSources(files, selected), overrides: publishOverrides(files, selected, COLS, overrides) };
    expect(req.overrides).toEqual({ [`${KEY}#0`]: '5215500000002' });
    const out = buildPublication([backendParse(CSV)], req.sources.map((s) => s.rows), 'Hola {{nombre}}', COLS, { phoneMode: 'first', overrides: overridesBySource(req) });
    expect(out.rows.map((r) => r[0])).toEqual(selected.flatMap((r) => plan.get(r.id) ?? []));
    expect(out.rows[0]![0]).toBe('5215500000002');
  });
});
