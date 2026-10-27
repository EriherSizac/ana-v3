import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listUploads, uploadContacts } from '../src/handlers/adminContacts';
import { getChats } from '../src/handlers/chats';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { ADMIN, LEADER_PRUEBA, adminEvent, derivedList, mockV4Me, parse } from './helpers/admin';

const s3mock = mockClient(S3Client);
let s3: CondS3;

const CSV_ANA = 'contact_phone,first_name,total_balance\n5215500000001,Ana,100\n5215500000002,Bea,200';
const CSV_LUIS = '﻿contact_phone,first_name,total_balance\n5215500000003,Carla,300';

const body = (over: Record<string, unknown> = {}) => ({
  uploadId: '20261026T100000-abcdef12',
  fileName: 'cartera.csv',
  mode: 'distribute',
  message: 'Hola {first_name}',
  files: [
    { agent: 'ana.lopez', csv: CSV_ANA },
    { agent: 'Luis', csv: CSV_LUIS },
  ],
  ...over,
});

const post = (b: unknown, username = 'erick.silva') => uploadContacts(adminEvent({ username, path: { campaign: 'prueba' }, body: b }));
/** Pendientes escritos por la carga (add-supervisor-contact-access: ya no van a agents/). */
const agentsPuts = () => s3.puts.filter((p) => p.key.startsWith('assignments/agents/'));

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis', 'c', 'd', 'e']));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /admin/campaigns/{campaign}/contacts', () => {
  it('carga a dos agentes: assignments/ + historic/ con el mismo ts, sin agents/, manifiesto completed', async () => {
    mockV4Me(LEADER_PRUEBA);
    const res = await post(body());
    expect(res.statusCode).toBe(200);
    const m = parse(res).data;
    expect(m).toMatchObject({
      schemaVersion: 1,
      uploadId: '20261026T100000-abcdef12',
      campaign: 'prueba',
      fileName: 'cartera.csv',
      mode: 'distribute',
      uploadedBy: 'erick.silva',
      status: 'completed',
      destination: 'assignments',
      message: null,
      totalRows: 3,
    });
    expect(m.perAgent.map((p: any) => [p.agent, p.rows])).toEqual([
      ['ana.lopez', 2],
      ['luis', 1],
    ]);
    const ts = m.perAgent[0].key.match(/-contacts-(.+)\.csv$/)[1];
    expect(m.perAgent[1].key).toBe(`assignments/agents/prueba/luis-contacts-${ts}.csv`);
    expect(m.perAgent[1].historicKey).toBe(`historic/agents/prueba/luis-contacts-${ts}.csv`);
    for (const p of m.perAgent) expect(s3.store.get(p.key)!.body).toBe(s3.store.get(p.historicKey)!.body);
    expect(s3.puts.some((p) => p.key.startsWith('agents/'))).toBe(false);
    expect(s3.json('uploads/prueba/20261026T100000-abcdef12.json').status).toBe('completed');
    // El BOM se elimina.
    expect(s3.store.get(m.perAgent[1].key)!.body.startsWith('contact_phone')).toBe(true);
  });

  it('GET /get/chats no entrega la carga: queda pendiente del agente', async () => {
    mockV4Me(LEADER_PRUEBA);
    await post(body());
    const res = await getChats({ pathParameters: { agentId: 'ana.lopez', campaignId: 'prueba' } } as unknown as APIGatewayProxyEvent);
    expect(res.statusCode).toBe(404);
  });

  it('message del body se ignora: el CSV no gana columna message', async () => {
    mockV4Me(ADMIN);
    await post(body({ message: 'Hola {first_name}\nSaldo: {total_balance}', files: [{ agent: 'ana.lopez', csv: CSV_ANA }] }));
    const lines = agentsPuts()[0]!.body.trimEnd().split('\n');
    expect(lines).toEqual([
      'contact_phone,first_name,total_balance,ana_upload_id',
      '5215500000001,Ana,100,20261026T100000-abcdef12',
      '5215500000002,Bea,200,20261026T100000-abcdef12',
    ]);
  });

  it('body > 5 500 000 bytes → 413 sin S3', async () => {
    const fetch = mockV4Me(ADMIN);
    const res = await uploadContacts(adminEvent({ path: { campaign: 'prueba' }, rawBody: 'x'.repeat(5_500_001) }));
    expect(res.statusCode).toBe(413);
    expect(parse(res)).toEqual({ success: false, message: 'Archivo demasiado grande' });
    expect(s3mock.calls()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('agente repetido tras normalizar → 400', async () => {
    mockV4Me(ADMIN);
    const res = await post(body({ files: [{ agent: 'Ana', csv: CSV_ANA }, { agent: 'ana', csv: CSV_ANA }] }));
    expect(parse(res)).toEqual({ success: false, message: 'Agente repetido: ana' });
    expect(s3.puts).toHaveLength(0);
  });

  it('sin permiso de reparto → 403 "Sin permiso" sin S3', async () => {
    mockV4Me({ ...LEADER_PRUEBA, permissions: ['ana:contacts:list:upload'], isLeader: false });
    const res = await post(body());
    expect(res.statusCode).toBe(403);
    expect(parse(res)).toEqual({ success: false, message: 'Sin permiso' });
    expect(s3mock.calls()).toHaveLength(0);
  });

  it('agente deshabilitado tras la vista previa → 409 sin escribir', async () => {
    mockV4Me(ADMIN);
    s3.set(
      'rosters/prueba.json',
      JSON.stringify({ schemaVersion: 2, campaign: 'prueba', overrides: { luis: { enabled: false, updatedAt: 't', updatedBy: 'x' } } }),
    );
    const res = await post(body());
    expect(res.statusCode).toBe(409);
    expect(parse(res)).toEqual({ success: false, message: 'Agentes no habilitados', data: { agents: ['luis'] } });
    expect(s3.puts).toHaveLength(0);
  });

  it('sin columna de teléfono → 400 con agente y causa', async () => {
    mockV4Me(ADMIN);
    const res = await post(body({ files: [{ agent: 'ana.lopez', csv: 'nombre,saldo\nAna,1' }] }));
    expect(parse(res)).toEqual({ success: false, message: 'ana.lopez: falta columna de teléfono' });
  });

  it('sin mensaje ni columna message → 200 (el agente escribe el mensaje)', async () => {
    mockV4Me(ADMIN);
    const res = await post(body({ message: undefined }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data.message).toBeNull();
  });

  it('un message no textual de un cliente anterior también se ignora', async () => {
    mockV4Me(ADMIN);
    expect((await post(body({ message: 42 }))).statusCode).toBe(200);
  });

  it('con columna message en todos los CSV el mensaje es opcional', async () => {
    mockV4Me(ADMIN);
    const res = await post(body({ message: undefined, files: [{ agent: 'ana.lopez', csv: 'phone,message\n5215500000001,Hola' }] }));
    expect(res.statusCode).toBe(200);
  });

  it.each([
    [{ uploadId: 'corto' }, 'uploadId inválido'],
    [{ mode: 'otro' }, 'mode inválido'],
    [{ files: [] }, 'files debe tener al menos un archivo'],
  ])('body inválido %j → 400', async (over, msg) => {
    mockV4Me(ADMIN);
    expect(parse(await post(body(over))).message).toBe(msg);
  });

  it('error en el tercer archivo de cinco: rollback de assignments/, manifiesto failed y 500 con lo escrito/revertido', async () => {
    mockV4Me(ADMIN);
    let agentWrites = 0;
    s3.beforePut = (key) => {
      if (key.startsWith('assignments/agents/') && ++agentWrites === 3) throw Object.assign(new Error('boom'), { name: 'InternalError' });
    };
    const files = ['ana.lopez', 'luis', 'c', 'd', 'e'].map((agent) => ({ agent, csv: CSV_ANA }));
    const res = await post(body({ files }));
    expect(res.statusCode).toBe(500);
    const r = parse(res);
    expect(r.message).toBe('Error interno del servidor');
    expect(r.data.written).toHaveLength(2);
    expect(r.data.rolledBack).toEqual(r.data.written);
    for (const k of r.data.written) expect(s3.store.has(k)).toBe(false);
    expect(s3.json('uploads/prueba/20261026T100000-abcdef12.json').status).toBe('failed');
  });

  it('doble envío con el mismo uploadId → 200 con el manifiesto original sin archivos nuevos', async () => {
    mockV4Me(ADMIN);
    const first = parse(await post(body())).data;
    const putsBefore = agentsPuts().length;
    const second = await post(body());
    expect(second.statusCode).toBe(200);
    expect(parse(second).data).toEqual(first);
    expect(agentsPuts()).toHaveLength(putsBefore);
  });

  it('manifiesto failed previo → se procesa de nuevo y se sobrescribe', async () => {
    mockV4Me(ADMIN);
    s3.set('uploads/prueba/20261026T100000-abcdef12.json', JSON.stringify({ status: 'failed' }));
    const res = await post(body());
    expect(parse(res).data.status).toBe('completed');
    expect(agentsPuts()).toHaveLength(2);
  });

  it('nunca registra contenido de los CSV', async () => {
    mockV4Me(ADMIN);
    const log = vi.spyOn(console, 'log');
    await post(body());
    const out = log.mock.calls.flat().join(' ');
    expect(out).not.toContain('5215500000001');
    expect(out).not.toContain('Hola {first_name}');
  });
});

describe('GET /admin/campaigns/{campaign}/uploads', () => {
  const manifest = (id: string, uploadedAt: string) =>
    JSON.stringify({ schemaVersion: 1, uploadId: id, campaign: 'prueba', uploadedAt, status: 'completed', message: 'secreto', perAgent: [] });

  it('más reciente primero, sin message', async () => {
    mockV4Me(LEADER_PRUEBA);
    s3.set('uploads/prueba/a.json', manifest('a', '2026-10-01T00:00:00Z'));
    s3.set('uploads/prueba/b.json', manifest('b', '2026-10-03T00:00:00Z'));
    s3.set('uploads/prueba/c.json', manifest('c', '2026-10-02T00:00:00Z'));
    const res = await listUploads(adminEvent({ path: { campaign: 'prueba' } }));
    const data = parse(res).data;
    expect(data.items.map((i: any) => i.uploadId)).toEqual(['b', 'c', 'a']);
    expect(JSON.stringify(data)).not.toContain('secreto');
  });

  it('vacío', async () => {
    mockV4Me(LEADER_PRUEBA);
    expect(parse(await listUploads(adminEvent({ path: { campaign: 'prueba' } })))).toEqual({ success: true, data: { campaign: 'prueba', items: [] } });
  });

  it('campaña ajena → 403 sin S3', async () => {
    mockV4Me(LEADER_PRUEBA);
    const res = await listUploads(adminEvent({ path: { campaign: 'zendere' } }));
    expect(res.statusCode).toBe(403);
    expect(s3mock.calls()).toHaveLength(0);
  });
});
