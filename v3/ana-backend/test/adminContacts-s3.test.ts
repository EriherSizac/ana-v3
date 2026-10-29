import { createHash } from 'node:crypto';
import { mockClient } from 'aws-sdk-client-mock';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presignContacts, uploadContacts } from '../src/handlers/adminContacts';
import { incomingKey, MAX_SOURCE_BYTES, splitMaster } from '../src/lib/contactsSource';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { AGENT, LEADER_PRUEBA, adminEvent, derivedList, mockV4Me, parse } from './helpers/admin';

// support-crm-base-upload: "Carga v3 grande por S3".

const s3mock = mockClient(S3Client);
let s3: CondS3;

const UPLOAD_ID = '20261029T100000-abcdef12';
const KEY = incomingKey('prueba', UPLOAD_ID);
const MASTER = [
  'id_credito,nombre_cliente,telefono_1,telefono_2,fecha_corte,saldo_total',
  '1,Ana,5215500000001,,45961,45961',
  '2,Bea,,5215500000002,31/10/2025,100',
  '3,Carla,5215500000003,,,200',
].join('\n') + '\n';

/** Misma fórmula que `planHash` de ANA Admin (fila i → agente i mod n, dígitos del teléfono). */
const hashOf = (mode: string, agents: string[], digits: string[]) =>
  createHash('sha256')
    .update([`v3|${mode}|${agents.join(',')}`, ...digits.map((d, i) => `${i}\t${agents[i % agents.length]}\t${d}`)].join('\n'))
    .digest('hex');

const PLAN = { agents: ['ana.lopez', 'luis'], counts: { 'ana.lopez': 2, luis: 1 }, hash: hashOf('distribute', ['ana.lopez', 'luis'], ['5215500000001', '5215500000002', '5215500000003']) };

const body = (over: Record<string, unknown> = {}) => ({ uploadId: UPLOAD_ID, fileName: 'base.csv', mode: 'distribute', sourceKey: KEY, plan: PLAN, ...over });
const post = (b: unknown) => uploadContacts(adminEvent({ username: 'erick.silva', path: { campaign: 'prueba' }, body: b }));
const presign = (b: unknown, me = LEADER_PRUEBA) => {
  mockV4Me(me);
  return presignContacts(adminEvent({ username: 'erick.silva', path: { campaign: 'prueba' }, body: b }));
};
const pending = () => s3.puts.filter((p) => p.key.startsWith('assignments/agents/'));

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
  process.env.AWS_SECRET_ACCESS_KEY = 'secret';
  s3 = installCondS3(s3mock);
  s3mock.on(DeleteObjectCommand).callsFake((input: any) => {
    s3.store.delete(input.Key);
    return {};
  });
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis']));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /admin/campaigns/{campaign}/contacts/presign', () => {
  it('firma un PUT de 15 min a uploads-incoming/{campaign}/{uploadId}.csv con Content-Length firmado', async () => {
    const res = await presign({ uploadId: UPLOAD_ID, bytes: 1234 });
    expect(res.statusCode).toBe(200);
    const d = parse(res).data;
    expect(d).toMatchObject({ uploadId: UPLOAD_ID, sourceKey: KEY, expiresIn: 900, headers: { 'Content-Type': 'text/csv' }, maxBytes: MAX_SOURCE_BYTES });
    const url = new URL(d.url);
    expect(url.pathname).toContain(`/uploads-incoming/prueba/${UPLOAD_ID}.csv`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
  });

  it('rechaza más de 50 MB (413), bytes inválido y uploadId inválido (400)', async () => {
    expect((await presign({ uploadId: UPLOAD_ID, bytes: MAX_SOURCE_BYTES + 1 })).statusCode).toBe(413);
    expect((await presign({ uploadId: UPLOAD_ID, bytes: 0 })).statusCode).toBe(400);
    expect((await presign({ uploadId: '../x', bytes: 10 })).statusCode).toBe(400);
  });

  it('exige los mismos permisos que la carga', async () => {
    expect((await presign({ uploadId: UPLOAD_ID, bytes: 10 }, AGENT)).statusCode).toBe(403);
  });
});

describe('POST /admin/campaigns/{campaign}/contacts con sourceKey', () => {
  it('lee el CSV maestro, reparte round-robin, convierte fechas de Excel, escribe manifiesto y borra el objeto', async () => {
    mockV4Me(LEADER_PRUEBA);
    s3.set(KEY, MASTER);
    const res = await post(body());
    expect(res.statusCode).toBe(200);
    const m = parse(res).data;
    expect(m).toMatchObject({ status: 'completed', totalRows: 3, uploadId: UPLOAD_ID });
    expect(m.perAgent.map((p: any) => [p.agent, p.rows])).toEqual([
      ['ana.lopez', 2],
      ['luis', 1],
    ]);
    const ana = pending().find((p) => p.key.includes('/ana.lopez-contacts-'))!.body;
    expect(ana).toBe(
      'id_credito,nombre_cliente,telefono_1,telefono_2,fecha_corte,saldo_total,ana_upload_id\n' +
        `1,Ana,5215500000001,,31/10/2025,45961,${UPLOAD_ID}\n` +
        `3,Carla,5215500000003,,,200,${UPLOAD_ID}\n`,
    );
    expect(s3.store.has(KEY)).toBe(false);
    expect(s3.store.has(`uploads/prueba/${UPLOAD_ID}.json`)).toBe(true);
  });

  it('equivale a la carga en línea con los mismos archivos por agente', async () => {
    mockV4Me(LEADER_PRUEBA);
    s3.set(KEY, MASTER);
    await post(body());
    const viaS3 = pending().map((p) => p.body);
    s3.puts.length = 0;
    const split = splitMaster(MASTER, PLAN.agents, 'distribute');
    if ('error' in split) throw new Error(split.error);
    const res = await post({ uploadId: '20261029T100000-inline00', fileName: 'base.csv', mode: 'distribute', files: split.files });
    expect(res.statusCode).toBe(200);
    const inline = pending().map((p) => p.body.replaceAll('20261029T100000-inline00', UPLOAD_ID));
    expect(inline).toEqual(viaS3);
  });

  it('objeto inexistente → 400 sin escribir archivos', async () => {
    mockV4Me(LEADER_PRUEBA);
    const res = await post(body());
    expect(res.statusCode).toBe(400);
    expect(parse(res).message).toMatch(/No se encontró el archivo/);
    expect(pending()).toHaveLength(0);
  });

  it('objeto de más de 50 MB → 413', async () => {
    mockV4Me(LEADER_PRUEBA);
    s3.set(KEY, MASTER);
    s3mock.on(GetObjectCommand, { Key: KEY }).resolves({ ContentLength: MAX_SOURCE_BYTES + 1, Body: { transformToString: async () => MASTER } as any });
    const res = await post(body());
    expect(res.statusCode).toBe(413);
    expect(pending()).toHaveLength(0);
  });

  it('plan distinto del archivo (conteos o hash) → 409', async () => {
    mockV4Me(LEADER_PRUEBA);
    s3.set(KEY, MASTER);
    expect((await post(body({ plan: { ...PLAN, counts: { 'ana.lopez': 1, luis: 2 } } }))).statusCode).toBe(409);
    expect((await post(body({ plan: { ...PLAN, hash: 'a'.repeat(64) } }))).statusCode).toBe(409);
    expect(pending()).toHaveLength(0);
    expect(s3.store.has(KEY)).toBe(true);
  });

  it('sourceKey de otra carga → 400; files y sourceKey juntos → 400', async () => {
    mockV4Me(LEADER_PRUEBA);
    expect((await post(body({ sourceKey: 'uploads-incoming/otra/x.csv' }))).statusCode).toBe(400);
    expect((await post(body({ files: [] }))).statusCode).toBe(400);
  });

  it('valida igual que en línea: crédito duplicado → 400', async () => {
    mockV4Me(LEADER_PRUEBA);
    s3.set(KEY, MASTER.replace('3,Carla', '1,Carla'));
    const res = await post(body());
    expect(res.statusCode).toBe(400);
    expect(parse(res).message).toBe('Crédito duplicado: 1');
  });

  it('agente no habilitado → 409', async () => {
    mockV4Me(LEADER_PRUEBA);
    s3.set(KEY, MASTER);
    const agents = ['ana.lopez', 'otro'];
    const res = await post(body({ plan: { agents, counts: { 'ana.lopez': 2, otro: 1 }, hash: hashOf('distribute', agents, ['5215500000001', '5215500000002', '5215500000003']) } }));
    expect(res.statusCode).toBe(409);
  });
});

describe('splitMaster', () => {
  it('fila sin teléfono válido → error; límite de filas', () => {
    expect(splitMaster('telefono_1,x\n123,a\n', ['a'], 'single')).toEqual({ error: 'Fila 2: sin teléfono válido' });
    expect(splitMaster('x\n1\n', ['a'], 'single')).toEqual({ error: 'falta columna de teléfono' });
    const many = 'phone\n' + '5215500000001\n'.repeat(200_001);
    expect(splitMaster(many, ['a'], 'single')).toMatchObject({ error: expect.stringMatching(/supera/) });
  });
});
