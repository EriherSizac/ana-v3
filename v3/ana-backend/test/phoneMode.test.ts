import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAssignmentCsv } from '../src/lib/assignmentCsv';
import { buildPublication, phoneCandidates } from '../src/lib/publication';
import { parsePublishBody, parseRowKey, publishAssignments, type AgentEvent } from '../src/handlers/agentAssignments';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { derivedList } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

/** add-agent-workspace "Modo de teléfono de la publicación" / "Teléfono elegido por fila". */
const CSV = [
  'id_credito,nombre,telefono_1,telefono_2,telefono_3',
  'C1,Ana,5215500000001,5215500000002,',
  'C2,Beto,123,5215500000020,5215500000021',
  'C1,Ana bis,5215500000003,,',
  'C3,Carla,,,',
].join('\n') + '\n';
const COLS = ['telefono_1', 'telefono_2', 'telefono_3'];
const p = () => parseAssignmentCsv(CSV);
const phonesOf = (b: { rows: string[][] }) => b.rows.map((r) => r[0]);

describe('buildPublication: phoneMode', () => {
  it('candidatos: válidos en orden de columnas, sin repetir dígitos', () => {
    expect(phoneCandidates({ a: '5215500000001', b: '52 1550 000 0001', c: '12' }, ['a', 'b', 'c'])).toEqual([{ column: 'a', phone: '5215500000001' }]);
  });

  it('sin phoneMode → all (un mensaje por teléfono válido; compatibilidad)', () => {
    expect(phonesOf(buildPublication([p()], [[0, 1, 2, 3]], 'Hola', COLS))).toEqual([
      '5215500000001',
      '5215500000002',
      '5215500000020',
      '5215500000021',
      '5215500000003',
    ]);
  });

  it('first: un mensaje por crédito al primer teléfono válido en orden', () => {
    expect(phonesOf(buildPublication([p()], [[0, 1, 2, 3]], 'Hola', COLS, { phoneMode: 'first' }))).toEqual(['5215500000001', '5215500000020']);
  });

  it('first respeta el orden de columnas elegido', () => {
    expect(phonesOf(buildPublication([p()], [[0, 1]], 'Hola', ['telefono_3', 'telefono_2', 'telefono_1'], { phoneMode: 'first' }))).toEqual([
      '5215500000002',
      '5215500000021',
    ]);
  });

  it('override: solo ese teléfono de la fila (en ambos modos)', () => {
    const overrides = [new Map([[0, '5215500000002']])];
    expect(phonesOf(buildPublication([p()], [[0, 1]], 'Hola {{phone}}', COLS, { phoneMode: 'first', overrides }))).toEqual(['5215500000002', '5215500000020']);
    expect(phonesOf(buildPublication([p()], [[0, 1]], 'Hola', COLS, { phoneMode: 'all', overrides }))).toEqual(['5215500000002', '5215500000020', '5215500000021']);
  });

  it('override con teléfono ajeno a la fila o inválido → 400', () => {
    for (const phone of ['5215500000020', '123', '']) {
      expect(() => buildPublication([p()], [[0]], 'Hola', COLS, { phoneMode: 'first', overrides: [new Map([[0, phone]])] })).toThrow(
        expect.objectContaining({ status: 400, message: 'El teléfono elegido no pertenece a la fila 1' }),
      );
    }
  });

  it('override de una columna no elegida → 400', () => {
    expect(() => buildPublication([p()], [[0]], 'Hola', ['telefono_1'], { overrides: [new Map([[0, '5215500000002']])] })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('override para una fila no seleccionada → 400', () => {
    expect(() => buildPublication([p()], [[0]], 'Hola', COLS, { overrides: [new Map([[1, '5215500000020']])] })).toThrow(
      expect.objectContaining({ status: 400, message: 'Teléfono elegido para una fila no seleccionada: 2' }),
    );
  });
});

describe('parsePublishBody: phoneMode / overrides', () => {
  const base = { publishId: '20261026T120000-abcdef12', template: 'Hola', phoneColumns: ['telefono_1'], sources: [{ key: 'k/a.csv', etag: 'e', rows: [0, 1] }] };
  it('rowKey = <key>#<índice>', () => {
    expect(parseRowKey('a#b.csv#3')).toEqual({ key: 'a#b.csv', index: 3 });
    expect(parseRowKey('a.csv')).toBeNull();
    expect(parseRowKey('a.csv#x')).toBeNull();
  });
  it('por omisión all y sin overrides', () => {
    expect(parsePublishBody(base)).toMatchObject({ phoneMode: 'all', overrides: {} });
  });
  it.each([
    [{ phoneMode: 'uno' }, 'Modo de teléfono inválido'],
    [{ overrides: [] }, 'Teléfonos elegidos inválidos'],
    [{ overrides: { 'k/a.csv': '5215500000001' } }, 'Teléfonos elegidos inválidos'],
    [{ overrides: { 'k/a.csv#0': 5 } }, 'Teléfonos elegidos inválidos'],
    [{ overrides: { 'k/a.csv#5': '5215500000001' } }, 'Teléfono elegido para una fila no seleccionada: 6'],
    [{ overrides: { 'otra.csv#0': '5215500000001' } }, 'Teléfono elegido para una fila no seleccionada: 1'],
  ])('%j → error', (over, error) => {
    expect(parsePublishBody({ ...base, ...over })).toEqual({ error });
  });
});

describe('POST publish con phoneMode', () => {
  const s3mock = mockClient(S3Client);
  let s3: CondS3;
  const A = 'assignments/agents/prueba/ana.lopez-contacts-2026-10-26T10-00-00-000Z.csv';
  const ev = (body: unknown): AgentEvent => ({
    headers: bearer(signIdToken({ 'cognito:username': 'ana.lopez' })),
    pathParameters: { campaign: 'prueba' },
    queryStringParameters: {},
    body: JSON.stringify(body),
  });
  beforeEach(() => {
    // Reloj fijo: los pendientes de más de 90 días se rechazan.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    s3mock.reset();
    process.env.BUCKET_NAME = 'ana-backend-storage-test';
    s3 = installCondS3(s3mock, {}, 2);
    setupAgentAuth({ enforced: true });
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
    s3.set(A, CSV);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const body = (over: Record<string, unknown>) => ({
    publishId: '20261026T120000-abcdef12',
    template: 'Hola {{nombre}}',
    phoneColumns: COLS,
    sources: [{ key: A, etag: s3.store.get(A)!.etag, rows: [0, 1] }],
    ...over,
  });

  it('first + override → archivo con lo que mostró la vista previa; manifiesto con phoneMode', async () => {
    const res = await publishAssignments(ev(body({ phoneMode: 'first', overrides: { [`${A}#1`]: '5215500000021' } })));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data).toMatchObject({ contacts: 2, phoneMode: 'first' });
    const lines = s3.store.get(data.key)!.body.trimEnd().split('\n');
    expect(lines.slice(1).map((l: string) => l.split(',')[0])).toEqual(['5215500000001', '5215500000021']);
  });

  it('override ajeno → 400 sin escribir', async () => {
    const res = await publishAssignments(ev(body({ phoneMode: 'first', overrides: { [`${A}#0`]: '5215500000020' } })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('El teléfono elegido no pertenece a la fila 1');
    expect(s3.puts).toHaveLength(0);
  });
});
