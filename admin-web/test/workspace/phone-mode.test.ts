// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  defaultPhoneColumns,
  loadFile,
  mergeFiles,
  movePhoneColumn,
  phoneCandidates,
  planPhones,
  publishOverrides,
  publishSources,
  renderRow,
  reorderSelection,
  rowKeyOf,
  type PhoneMode,
} from '@/lib/workspace';
// Lo que de verdad publica v3:
import { buildPublication, overridesBySource } from '../../../v3/ana-backend/src/lib/publication';
import { parseAssignmentCsv as backendParse } from '../../../v3/ana-backend/src/lib/assignmentCsv';

/** add-agent-workspace "Modo de teléfono de la publicación" / "Teléfono elegido por fila". */
const F1 = [
  'id_credito,nombre,telefono_1,telefono_2,telefono_3',
  'C1,Ana,5215500000001,5215500000002,',
  'C2,Beto,123,5215500000020,5215500000021',
  'C1,Ana bis,5215500000003,,',
  'C3,Carla,,,',
].join('\n') + '\n';
const F2 = ['id_credito,nombre,telefono_2,telefono_1', 'C2,Beto otra,5215500000021,5215500000030', ',Sin crédito,5215500000040,5215500000041'].join('\n') + '\n';
const files = [loadFile('k/a.csv', 'e1', F1), loadFile('k/b#2.csv', 'e2', F2)];
const merged = mergeFiles(files);
const selected = merged.rows.filter((r) => r.valid);
const TPL = 'Hola {{nombre}} ({{phone}})';

function preview(mode: PhoneMode, cols: string[], overrides: Map<string, string>) {
  const plan = planPhones(selected, cols, mode, overrides);
  return selected.flatMap((r) => plan.get(r.id)!.map((p) => [p, renderRow(TPL, merged.header, r.record, p).text]));
}

function backend(mode: PhoneMode, cols: string[], overrides: Map<string, string>) {
  const body = {
    publishId: '20261026T120000-abcdef12',
    template: TPL,
    phoneColumns: cols,
    phoneMode: mode,
    sources: publishSources(files, selected),
    overrides: publishOverrides(files, selected, cols, overrides),
  };
  // Lo que recibe v3 (JSON del publish).
  const req = JSON.parse(JSON.stringify(body)) as typeof body;
  const parsed = req.sources.map((s) => backendParse(s.key === 'k/a.csv' ? F1 : F2));
  const built = buildPublication(
    parsed,
    req.sources.map((s) => s.rows),
    req.template,
    req.phoneColumns,
    { phoneMode: req.phoneMode, overrides: overridesBySource(req) },
  );
  const m = built.header.indexOf('message');
  return built.rows.map((r) => [r[0], r[m]]);
}

describe('modo de teléfono: vista previa ≡ publicación del backend', () => {
  const COLS = ['telefono_1', 'telefono_2', 'telefono_3'];
  const cases: Array<[string, PhoneMode, string[], Map<string, string>]> = [
    ['first, orden por omisión', 'first', COLS, new Map()],
    ['first, orden invertido', 'first', ['telefono_3', 'telefono_2', 'telefono_1'], new Map()],
    ['all', 'all', COLS, new Map()],
    ['first con override', 'first', COLS, new Map([['0:0', '5215500000002'], ['1:1', '5215500000040']])],
    ['all con override', 'all', COLS, new Map([['0:1', '5215500000021']])],
  ];
  it.each(cases)('%s', (_n, mode, cols, ov) => {
    expect(backend(mode, cols, ov)).toEqual(preview(mode, cols, ov));
  });

  it('first: un mensaje por crédito, al primer teléfono válido en orden', () => {
    expect(preview('first', COLS, new Map()).map((x) => x[0])).toEqual(['5215500000001', '5215500000020', '5215500000041']);
  });
});

describe('helpers de teléfono', () => {
  it('candidatos con columna, en orden, sin repetir', () => {
    expect(phoneCandidates(merged.rows[0]!.record, ['telefono_2', 'telefono_1'])).toEqual([
      { column: 'telefono_2', phone: '5215500000002' },
      { column: 'telefono_1', phone: '5215500000001' },
    ]);
  });
  it('rowKey = <key>#<índice>; overrides ajenos a la fila no se envían', () => {
    expect(rowKeyOf(files, merged.rows[5]!)).toBe('k/b#2.csv#1');
    expect(publishOverrides(files, selected, ['telefono_1'], new Map([['0:0', '5215500000002'], ['0:1', '5215500000020']]))).toEqual({});
    expect(publishOverrides(files, selected, ['telefono_1', 'telefono_2'], new Map([['0:0', '5215500000002']]))).toEqual({ 'k/a.csv#0': '5215500000002' });
  });
  it('columnas por omisión telefono_1..3 o la del CLI', () => {
    expect(defaultPhoneColumns(['telefono_2', 'x', 'telefono_1'])).toEqual(['telefono_1', 'telefono_2']);
    expect(defaultPhoneColumns(['phone_number', 'x'])).toEqual(['phone_number']);
    expect(defaultPhoneColumns(['x'])).toEqual([]);
  });
  it('reordenar y conservar el orden al agregar/quitar', () => {
    expect(movePhoneColumn(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(movePhoneColumn(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(reorderSelection(['c', 'a'], ['a', 'b', 'c'], 5)).toEqual(['c', 'a', 'b']);
    expect(reorderSelection(['c', 'a'], ['a'], 5)).toEqual(['a']);
  });
});

describe('BFF parsePublishInput', () => {
  const base = { template: 'Hola', phoneColumns: ['telefono_1'], sources: [{ key: 'k', etag: 'e', rows: [0] }] };
  it('pasa phoneMode y overrides; sin ellos no los agrega', async () => {
    const { parsePublishInput } = await import('@/server/backends/agentWorkspace');
    expect(parsePublishInput(base)).not.toHaveProperty('phoneMode');
    expect(parsePublishInput({ ...base, phoneMode: 'first', overrides: { 'k#0': '5215500000001' } })).toMatchObject({ phoneMode: 'first', overrides: { 'k#0': '5215500000001' } });
    expect(() => parsePublishInput({ ...base, phoneMode: 'x' })).toThrow('Modo de teléfono inválido');
    expect(() => parsePublishInput({ ...base, overrides: { 'k#0': 1 } })).toThrow('Teléfonos elegidos inválidos');
  });
});
