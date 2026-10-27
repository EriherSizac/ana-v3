import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadContacts } from '../src/handlers/adminContacts';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { ADMIN, adminEvent, derivedList, mockV4Me, parse } from './helpers/admin';

/** link-review-contacts-to-uploads 1.1/1.2: columna ana_upload_id y source. */
const s3mock = mockClient(S3Client);
let s3: CondS3;
const UPLOAD_ID = '20261026T1530-ab12cd34';

const body = (over: Record<string, unknown> = {}) => ({
  uploadId: UPLOAD_ID,
  fileName: 'c.csv',
  mode: 'distribute',
  files: [
    { agent: 'ana.lopez', csv: 'phone_number,first_name,message\n5215500000001,Ana,Hola {first_name}\n5215500000002,Bea,Hola {first_name}' },
    { agent: 'luis', csv: 'phone_number,first_name,message\n5215500000003,Carla,Hola' },
  ],
  ...over,
});
const post = (b: unknown) => uploadContacts(adminEvent({ path: { campaign: 'prueba' }, body: b }));

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis']));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockV4Me(ADMIN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Identificador de carga en las filas entregadas', () => {
  it('ana_upload_id como última columna en assignments/ e historic/ (contenido idéntico)', async () => {
    const res = await post(body());
    expect(res.statusCode).toBe(200);
    const m = parse(res).data;
    const file = s3.store.get(m.perAgent[0].key)!.body;
    const lines = file.trimEnd().split('\n');
    expect(lines[0]).toBe('phone_number,first_name,message,ana_upload_id');
    expect(lines.slice(1).every((l) => l.endsWith(`,${UPLOAD_ID}`))).toBe(true);
    for (const p of m.perAgent) expect(s3.store.get(p.key)!.body).toBe(s3.store.get(p.historicKey)!.body);
    expect(m.perAgent.map((p: any) => p.rows)).toEqual([2, 1]);
  });

  it('columna reservada en el archivo (sin distinguir mayúsculas) → 400 sin escribir', async () => {
    const res = await post(body({ files: [{ agent: 'luis', csv: 'phone,ANA_UPLOAD_ID,message\n5215500000003,x,Hola' }] }));
    expect(res.statusCode).toBe(400);
    expect(parse(res)).toEqual({ success: false, message: 'luis: columna reservada ana_upload_id' });
    expect(s3.puts).toHaveLength(0);
  });
});

describe('Origen de reasignación (source)', () => {
  const source = {
    type: 'review',
    fromUploadId: UPLOAD_ID,
    items: [
      { agent: 'ana.lopez', assignmentId: '20261026T1600-deadbeef', phone: '5215500000001' },
      { agent: 'ana.lopez', assignmentId: '20261026T1600-deadbeef', phone: '5215500000002' },
      { agent: 'ana.lopez', assignmentId: '20261026T1600-deadbeef', phone: '5215500000009' },
    ],
  };

  it('con source y mode single → el manifiesto lo incluye tal cual', async () => {
    const res = await post(body({ uploadId: '20261026T1700-00000001', mode: 'single', source, files: [body().files[1]] }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data.source).toEqual(source);
    expect(s3.json('uploads/prueba/20261026T1700-00000001.json').source).toEqual(source);
  });

  it('source + distribute → 400', async () => {
    const res = await post(body({ source }));
    expect(parse(res)).toEqual({ success: false, message: 'source requiere mode single' });
  });

  it('source inválido → 400', async () => {
    expect((await post(body({ mode: 'single', source: { ...source, items: [] } }))).statusCode).toBe(400);
    expect((await post(body({ mode: 'single', source: { ...source, fromUploadId: 'x' } }))).statusCode).toBe(400);
  });

  it('sin source → manifiesto sin el campo (igual que antes)', async () => {
    const res = await post(body());
    expect(parse(res).data).not.toHaveProperty('source');
  });
});
