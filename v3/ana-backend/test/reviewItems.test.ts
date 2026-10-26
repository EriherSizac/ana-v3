import { mockClient } from 'aws-sdk-client-mock';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listReview, resolveReview } from '../src/handlers/adminReview';
import { listReviewItems, ReviewConflictError, writeStates } from '../src/lib/reviewItems';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { ADMIN, LEADER_DIDI, adminEvent, mockV4Me, parse } from './helpers/admin';

const s3mock = mockClient(S3Client);
let s3: CondS3;
const U1 = '20261026T1530-ab12cd34';
const U2 = '20261026T1531-00000002';
const U9 = '20261027T0900-99999999';
const H = 'phone_number,first_name,message,ana_upload_id';

const seed = () => {
  s3.set(`review/prueba/ana.lopez/A1.csv`, [H, `5215500000001,Ana,Hola,${U1}`, `5215500000002,Bea,Hola,${U1}`, `5215500000003,Cel,Hola,${U2}`].join('\n'));
  s3.set(`review/prueba/luis/B1.csv`, ['contact_phone,first_name', '5215500000010,Curl'].join('\n'));
  // Fila mal formada (comillas sin escapar del serializador de contacts.ts).
  s3.set(`review/prueba/luis/B2.csv`, [H, `5215500000011,"Dijo "hola"",x,y,${U1}`].join('\n'));
};

const manifest = (id: string, items: Array<{ agent: string; assignmentId: string; phone: string }>, status = 'completed') =>
  JSON.stringify({ schemaVersion: 1, uploadId: id, campaign: 'prueba', mode: 'single', status, perAgent: [{ agent: 'luis', rows: items.length, key: 'k', historicKey: 'h' }], source: { type: 'review', fromUploadId: U1, items } });

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  seed();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lib/reviewItems', () => {
  it('filtro por carga: 2 filas de U1 en ana.lopez con state pending', async () => {
    const items = await listReviewItems('prueba', U1);
    const ana = items.filter((i) => i.agent === 'ana.lopez');
    expect(ana.map((i) => i.phone)).toEqual(['5215500000001', '5215500000002']);
    expect(ana.every((i) => i.state === 'pending' && i.assignmentId === 'A1')).toBe(true);
    expect(ana[0]!.row).toMatchObject({ first_name: 'Ana', ana_upload_id: U1 });
  });

  it('none: filas sin la columna', async () => {
    const items = await listReviewItems('prueba', 'none');
    expect(items.map((i) => [i.agent, i.phone])).toEqual([['luis', '5215500000010']]);
  });

  it('fila mal formada → row null y parseError, sin bloquear', async () => {
    const items = await listReviewItems('prueba', U1);
    const bad = items.find((i) => i.assignmentId === 'B2')!;
    expect(bad).toMatchObject({ row: null, parseError: true, phone: '5215500000011' });
  });

  it('conflicto concurrente fusiona; tras 3 fallos → ReviewConflictError', async () => {
    let once = false;
    s3.beforePut = (key) => {
      if (!once && key.startsWith('review-state/')) {
        once = true;
        s3.set(key, JSON.stringify({ schemaVersion: 1, items: { '5215500000002': { state: 'discarded', by: 'otro', at: 't' } } }));
      }
    };
    await writeStates('prueba', [{ agent: 'ana.lopez', assignmentId: 'A1', phone: '5215500000001' }], () => ({ state: 'discarded', by: 'erick.silva', at: 'x' }));
    const doc = s3.json('review-state/prueba/ana.lopez/A1.json');
    expect(Object.keys(doc.items).sort()).toEqual(['5215500000001', '5215500000002']);

    s3.beforePut = (key) => s3.set(key, JSON.stringify({ schemaVersion: 1, items: {} }));
    await expect(
      writeStates('prueba', [{ agent: 'ana.lopez', assignmentId: 'A1', phone: '5215500000003' }], () => ({ state: 'discarded', by: 'e', at: 'x' })),
    ).rejects.toBeInstanceOf(ReviewConflictError);
  });
});

describe('GET /admin/campaigns/{campaign}/review-items', () => {
  it('uploadId válido → filas de esa carga', async () => {
    mockV4Me(ADMIN);
    const res = await listReview(adminEvent({ path: { campaign: 'prueba' }, query: { uploadId: U1 } }));
    const data = parse(res).data;
    expect(data.uploadId).toBe(U1);
    expect(data.items).toHaveLength(3);
    expect(data.items[0]).toEqual(
      expect.objectContaining({ agent: 'ana.lopez', assignmentId: 'A1', phone: '5215500000001', state: 'pending', stateBy: null, stateAt: null, reassignUploadId: null, targetAgent: null }),
    );
  });

  it.each([[{}], [{ uploadId: 'x' }], [{ uploadId: 'a/b-123456' }]])('parámetro inválido %j → 400 sin S3', async (query) => {
    mockV4Me(ADMIN);
    s3mock.resetHistory();
    const res = await listReview(adminEvent({ path: { campaign: 'prueba' }, query: query as Record<string, string> }));
    expect(res.statusCode).toBe(400);
    expect(s3mock.calls()).toHaveLength(0);
  });

  it('líder de otra campaña → 403 "Sin permiso" sin S3', async () => {
    mockV4Me(LEADER_DIDI);
    s3mock.resetHistory();
    const res = await listReview(adminEvent({ path: { campaign: 'zendere' }, query: { uploadId: U1 } }));
    expect(res.statusCode).toBe(403);
    expect(parse(res)).toEqual({ success: false, message: 'Sin permiso' });
    expect(s3mock.calls()).toHaveLength(0);
  });
});

describe('POST /admin/campaigns/{campaign}/review-items/resolve', () => {
  const A = (phone: string) => ({ agent: 'ana.lopez', assignmentId: 'A1', phone });
  const post = (b: unknown, username = 'erick.silva') => resolveReview(adminEvent({ username, path: { campaign: 'prueba' }, body: b }));

  it('descartar: estado discarded con by y at; nunca escribe bajo review/', async () => {
    mockV4Me(ADMIN);
    const res = await post({ action: 'discard', items: [A('5215500000001')] });
    expect(res.statusCode).toBe(200);
    expect(parse(res).data.items[0]).toMatchObject({ phone: '5215500000001', state: 'discarded', stateBy: 'erick.silva' });
    const doc = s3.json('review-state/prueba/ana.lopez/A1.json');
    expect(doc.items['5215500000001']).toMatchObject({ state: 'discarded', by: 'erick.silva' });
    expect(Date.parse(doc.items['5215500000001'].at)).not.toBeNaN();
    const writes = [...s3mock.commandCalls(PutObjectCommand), ...s3mock.commandCalls(DeleteObjectCommand)].map((c) => String(c.args[0].input.Key));
    expect(writes.some((k) => k.startsWith('review/'))).toBe(false);
  });

  it('reasignar: manifiesto completed con source → reassigned con targetAgent del manifiesto', async () => {
    mockV4Me(ADMIN);
    const items = [A('5215500000001'), A('5215500000002')];
    s3.set(`uploads/prueba/${U9}.json`, manifest(U9, items));
    const res = await post({ action: 'reassign', items, reassignUploadId: U9 });
    expect(res.statusCode).toBe(200);
    for (const it of parse(res).data.items) expect(it).toMatchObject({ state: 'reassigned', reassignUploadId: U9, targetAgent: 'luis' });
  });

  it('reintento con el mismo reassignUploadId → 200 sin cambiar by/at', async () => {
    mockV4Me(ADMIN);
    const items = [A('5215500000001')];
    s3.set(`uploads/prueba/${U9}.json`, manifest(U9, items));
    await post({ action: 'reassign', items, reassignUploadId: U9 });
    const before = s3.json('review-state/prueba/ana.lopez/A1.json').items['5215500000001'];
    mockV4Me(ADMIN);
    const res = await post({ action: 'reassign', items, reassignUploadId: U9 }, 'otro.lider');
    expect(res.statusCode).toBe(200);
    expect(s3.json('review-state/prueba/ana.lopez/A1.json').items['5215500000001']).toEqual(before);
  });

  it.each([
    ['inexistente', () => {}],
    ['failed', () => s3.set(`uploads/prueba/${U9}.json`, manifest(U9, [A('5215500000001')], 'failed'))],
    ['source sin el item', () => s3.set(`uploads/prueba/${U9}.json`, manifest(U9, [A('5215500000002')]))],
  ])('reasignación sin carga válida (%s) → 409', async (_n, prep) => {
    mockV4Me(ADMIN);
    prep();
    const res = await post({ action: 'reassign', items: [A('5215500000001')], reassignUploadId: U9 });
    expect(res.statusCode).toBe(409);
    expect(parse(res)).toEqual({ success: false, message: 'Carga de reasignación no válida' });
  });

  it('item ya resuelto → 409 listándolo sin cambios', async () => {
    mockV4Me(ADMIN);
    await post({ action: 'discard', items: [A('5215500000001')] });
    const before = s3.store.get('review-state/prueba/ana.lopez/A1.json')!.body;
    mockV4Me(ADMIN);
    const res = await post({ action: 'discard', items: [A('5215500000001'), A('5215500000002')] });
    expect(res.statusCode).toBe(409);
    expect(parse(res).data.items).toHaveLength(1);
    expect(s3.store.get('review-state/prueba/ana.lopez/A1.json')!.body).toBe(before);
  });

  it('items inexistentes o body inválido → 400', async () => {
    mockV4Me(ADMIN);
    expect((await post({ action: 'discard', items: [A('5215599999999')] })).statusCode).toBe(400);
    mockV4Me(ADMIN);
    expect((await post({ action: 'otra', items: [A('1')] })).statusCode).toBe(400);
    mockV4Me(ADMIN);
    expect((await post({ action: 'reassign', items: [A('5215500000001')] })).statusCode).toBe(400);
  });

  it('sin permiso → 403 sin S3', async () => {
    mockV4Me({ permissions: ['ana:contacts:list:upload'], campaigns: ['prueba'] });
    s3mock.resetHistory();
    expect((await post({ action: 'discard', items: [A('5215500000001')] })).statusCode).toBe(403);
    expect(s3mock.calls()).toHaveLength(0);
  });
});
