import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { BatchWriteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ddbMock, s3Mock } from './helpers';

const access = vi.hoisted(() => ({ value: null as any }));
vi.mock('../src/lib/access', () => ({
  resolveUserAccess: async () => access.value,
  can: () => true,
  canRoute: () => true,
  routeAllowed: async () => true,
}));
vi.mock('../src/lib/dashboard', () => ({ getEligibleAgents: async () => [] }));
vi.mock('../src/lib/campaignsDb', () => ({ campaignExists: async () => true }));

import { handler as api } from '../src/handlers/api';
import { handler as csvTrigger } from '../src/handlers/csvTrigger';
import { fileNameFromKey, listUploads, recordUpload } from '../src/lib/uploads';

const KEY = 'csv-uploads/lider.didi/1761400000000_cartera_octubre.csv';
const OBJ_DATE = new Date('2026-10-25T15:00:00.000Z');

/** Tabla de historial en memoria (PK campaign, SK srcKey). */
let table: Map<string, Record<string, any>>;
let jobs: any[];
/** Marcadores UPLOAD#<srcKey> en la tabla de jobs (procesamiento único). */
let markers: Set<string>;

function installUploadsTable() {
  table = new Map();
  markers = new Set();
  ddbMock.on(PutCommand, { TableName: 'jobs-test' }).callsFake((input: any) => {
    const k = `${input.Item.operatorId}|${input.Item.jobId}`;
    if (markers.has(k)) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    markers.add(k);
    return {};
  });
  ddbMock.on(PutCommand, { TableName: 'uploads-test' }).callsFake((input: any) => {
    table.set(`${input.Item.campaign}|${input.Item.srcKey}`, input.Item);
    return {};
  });
  ddbMock.on(QueryCommand).callsFake((input: any) => {
    const v = input.ExpressionAttributeValues;
    return { Items: [...table.values()].filter((i) => i.campaign === v[':c'] && (!v[':k'] || i.srcKey === v[':k'])) };
  });
  ddbMock.on(BatchWriteCommand).callsFake((input: any) => {
    for (const items of Object.values(input.RequestItems) as any[]) for (const it of items) jobs.push(it.PutRequest.Item);
    return {};
  });
}

function installObject(body: string, meta: Record<string, string>) {
  s3Mock.on(GetObjectCommand).resolves({ Body: { transformToString: async () => body } as any, Metadata: meta, LastModified: OBJ_DATE });
  s3Mock.on(HeadObjectCommand).resolves({ Metadata: meta, LastModified: OBJ_DATE });
}

const s3Event = (size = 1000) =>
  ({
    Records: [{ eventTime: '2026-10-25T15:00:01.000Z', s3: { bucket: { name: 'csv-test' }, object: { key: KEY, size } } }],
  }) as any;

const csvOf = (n: number, withoutPhone = 0) =>
  ['telefono,mensaje', ...Array.from({ length: n }, (_, i) => (i < withoutPhone ? ',sin' : `55${String(10000000 + i)},hola`))].join('\n');

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  jobs = [];
  installUploadsTable();
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('csvTrigger: registro de cargas', () => {
  it('reparto explícito: 100 filas, 98 con teléfono, pesos 1/1 → 49/49', async () => {
    installObject(csvOf(100, 2), {
      operatorid: 'lider.didi',
      campaign: 'didi_vip',
      distribute: '1',
      assignments: JSON.stringify({ 'ana.lopez': 1, luis: 1 }),
    });
    await csvTrigger(s3Event());
    expect(jobs).toHaveLength(98);
    const rec = table.get(`didi_vip|${KEY}`)!;
    expect(rec).toMatchObject({
      campaign: 'didi_vip',
      srcKey: KEY,
      fileName: 'cartera_octubre.csv',
      uploadedBy: 'lider.didi',
      uploadedAt: OBJ_DATE.toISOString(),
      mode: 'assignments',
      totalRows: 100,
      validRows: 98,
      jobs: 98,
      perAgent: { 'ana.lopez': 49, luis: 49 },
      status: 'processed',
    });
    // TTL 180 días.
    expect(rec.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000) + 179 * 86400);
  });

  it('modo self (sin distribute ni assignments)', async () => {
    installObject(csvOf(3), { operatorid: 'lider.didi', campaign: 'didi_vip' });
    await csvTrigger(s3Event());
    expect(table.get(`didi_vip|${KEY}`)).toMatchObject({ mode: 'self', perAgent: { 'lider.didi': 3 } });
  });

  it('evento duplicado → un solo registro', async () => {
    installObject(csvOf(4), { operatorid: 'lider.didi', campaign: 'didi_vip', assignments: '{"ana.lopez":1}' });
    await csvTrigger(s3Event());
    await csvTrigger(s3Event());
    expect(table.size).toBe(1);
    expect(table.get(`didi_vip|${KEY}`)!.jobs).toBe(4);
  });

  it('más de 50 000 filas → rechazada too_many_rows y sin jobs', async () => {
    installObject(csvOf(50_001), { operatorid: 'lider.didi', campaign: 'didi_vip' });
    await csvTrigger(s3Event());
    expect(jobs).toHaveLength(0);
    expect(table.get(`didi_vip|${KEY}`)).toMatchObject({ status: 'rejected', reason: 'too_many_rows', jobs: 0, totalRows: 50_001 });
  });

  it('más de 10 MB → rechazada too_large sin leer el cuerpo', async () => {
    installObject('no se lee', { operatorid: 'lider.didi', campaign: 'didi_vip' });
    await csvTrigger(s3Event(11 * 1024 * 1024));
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(table.get(`didi_vip|${KEY}`)).toMatchObject({ status: 'rejected', reason: 'too_large', uploadedAt: OBJ_DATE.toISOString() });
  });

  it('sin operador → rechazada missing_operator', async () => {
    installObject(csvOf(2), { campaign: 'didi_vip' });
    await csvTrigger(s3Event());
    expect(table.get(`didi_vip|${KEY}`)).toMatchObject({ status: 'rejected', reason: 'missing_operator', uploadedBy: null });
  });

  it('sin campaña en la metadata → no se registra', async () => {
    installObject(csvOf(2), { operatorid: 'lider.didi' });
    await csvTrigger(s3Event());
    expect(jobs).toHaveLength(2);
    expect(table.size).toBe(0);
  });

  it('fallo al registrar no rompe la creación de jobs', async () => {
    ddbMock.on(PutCommand, { TableName: 'uploads-test' }).rejects(Object.assign(new Error('boom'), { name: 'ProvisionedThroughputExceededException' }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    installObject(csvOf(3), { operatorid: 'lider.didi', campaign: 'didi_vip' });
    await expect(csvTrigger(s3Event())).resolves.toBeUndefined();
    expect(jobs).toHaveLength(3);
    expect(JSON.parse(err.mock.calls[0]![0] as string)).toMatchObject({ evt: 'upload_history', status: 'failed' });
  });
});

describe('lib/uploads', () => {
  it('fileNameFromKey quita el prefijo de tiempo', () => {
    expect(fileNameFromKey(KEY)).toBe('cartera_octubre.csv');
  });

  it('listUploads: 50 más recientes por uploadedAt desc, sin ttl', async () => {
    for (let i = 0; i < 60; i++) {
      await recordUpload({
        campaign: 'didi_vip',
        srcKey: `k${i}`,
        fileName: 'f.csv',
        uploadedBy: 'x',
        uploadedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
        mode: 'self',
        totalRows: 1,
        validRows: 1,
        jobs: 1,
        perAgent: { x: 1 },
        status: 'processed',
      });
    }
    const items = await listUploads('didi_vip');
    expect(items).toHaveLength(50);
    expect(items[0]!.srcKey).toBe('k59');
    expect(items[49]!.srcKey).toBe('k10');
    expect(items[0]).not.toHaveProperty('ttl');
  });
});

const call = async (qs: Record<string, string> | undefined) => {
  const r: any = await api({
    routeKey: 'GET /uploads/history',
    queryStringParameters: qs,
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': 'lider.didi' } } } },
  } as any);
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

const LEADER = {
  username: 'lider.didi',
  roleIds: [],
  roleNames: ['Líder DIDI VIP'],
  campaigns: ['didi_vip'],
  permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute'],
  isAdmin: false,
  isLeader: true,
};

describe('GET /uploads/history', () => {
  beforeEach(() => {
    table.set(`didi_vip|${KEY}`, {
      campaign: 'didi_vip',
      srcKey: KEY,
      uploadedAt: '2026-10-25T15:00:00.000Z',
      status: 'processed',
      ttl: 1,
    });
    table.set('didi_vip|k-old', { campaign: 'didi_vip', srcKey: 'k-old', uploadedAt: '2026-10-01T00:00:00.000Z', status: 'rejected', reason: 'too_many_rows' });
  });

  it('líder de la campaña → 200, más reciente primero', async () => {
    access.value = LEADER;
    const r = await call({ campaign: 'didi_vip' });
    expect(r.status).toBe(200);
    expect(r.body.campaign).toBe('didi_vip');
    expect(r.body.items.map((i: any) => i.srcKey)).toEqual([KEY, 'k-old']);
  });

  it('campaña ajena → 403 {"error":"sin permiso"} aunque PERMISSIONS_ENFORCED=false', async () => {
    access.value = LEADER;
    const r = await call({ campaign: 'zendere' });
    expect(r).toEqual({ status: 403, body: { error: 'sin permiso' } });
  });

  it('agente sin permiso de carga → 403', async () => {
    access.value = { ...LEADER, permissions: ['ana:chats:conversation:view'], isLeader: false };
    expect((await call({ campaign: 'didi_vip' })).status).toBe(403);
  });

  it('admin → cualquier campaña; `*` también', async () => {
    access.value = { ...LEADER, isAdmin: true, campaigns: [] };
    expect((await call({ campaign: 'zendere' })).status).toBe(200);
    access.value = { ...LEADER, campaigns: ['*'] };
    expect((await call({ campaign: 'zendere' })).status).toBe(200);
  });

  it('falta campaign → 400', async () => {
    access.value = LEADER;
    expect(await call(undefined)).toEqual({ status: 400, body: { error: 'falta campaign' } });
  });

  it('srcKey filtra; aún no procesado → items vacío', async () => {
    access.value = LEADER;
    expect((await call({ campaign: 'didi_vip', srcKey: KEY })).body.items).toHaveLength(1);
    expect(await call({ campaign: 'didi_vip', srcKey: 'csv-uploads/x/2_pendiente.csv' })).toEqual({
      status: 200,
      body: { campaign: 'didi_vip', items: [] },
    });
  });
});

const cfnTags = ['!Sub', '!GetAtt', '!Ref'].map((tag) => ({ tag, resolve: (v: string) => ({ [tag.slice(1)]: v }) }));
const sls = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'), { customTags: cfnTags as any });

describe('serverless.yml: tabla de historial', () => {
  it('tabla PK campaign / SK srcKey, PAY_PER_REQUEST y TTL', () => {
    const t = sls.resources.Resources.UploadsTable;
    expect(t.Type).toBe('AWS::DynamoDB::Table');
    expect(t.Properties.TableName).toBe('${self:provider.environment.UPLOADS_TABLE}');
    expect(sls.provider.environment.UPLOADS_TABLE).toBe('${self:service}-uploads-${self:provider.stage}');
    expect(t.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    expect(t.Properties.KeySchema).toEqual([
      { AttributeName: 'campaign', KeyType: 'HASH' },
      { AttributeName: 'srcKey', KeyType: 'RANGE' },
    ]);
    expect(t.Properties.TimeToLiveSpecification).toEqual({ AttributeName: 'ttl', Enabled: true });
  });

  it('IAM limitado a Put/Update/Query/Get sobre la tabla', () => {
    const stmt = sls.provider.iam.role.statements.find((s: any) =>
      (s.Resource ?? []).some((r: any) => r?.GetAtt === 'UploadsTable.Arn'),
    );
    expect(stmt.Action.sort()).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem']);
    expect(stmt.Resource).toEqual([{ GetAtt: 'UploadsTable.Arn' }]);
  });

  it('ruta GET /uploads/history con authorizer JWT', () => {
    const ev = sls.functions.api.events.find((e: any) => e.httpApi?.path === '/uploads/history');
    expect(ev.httpApi).toEqual({ path: '/uploads/history', method: 'get', authorizer: { name: 'cognitoJwt' } });
  });
});
