// Carga de CSV endurecida (v4-harden-send-job-queue): presign, trigger idempotente,
// reintento de UnprocessedItems, borrado del CSV, CSV ilegible y plantilla.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { ddbMock, s3Mock } from './helpers';

const access = vi.hoisted(() => ({ value: null as any }));
vi.mock('../src/lib/access', () => ({
  resolveUserAccess: async () => access.value,
  can: () => true,
  canRoute: () => true,
  routeAllowed: async () => true,
}));
vi.mock('../src/lib/campaignsDb', () => ({ campaignExists: async () => true }));

import { handler as api } from '../src/handlers/api';
import { handler as csvTrigger, timing, BATCH_RETRIES } from '../src/handlers/csvTrigger';

const KEY = 'csv-uploads/lider.didi/1761400000000_cartera.csv';

let jobs: any[];
let markers: Set<string>;
/** Respuestas de BatchWrite: cuántos items del lote dejar sin procesar en cada llamada. */
let unprocessedPlan: number[];

function installTables() {
  jobs = [];
  markers = new Set();
  unprocessedPlan = [];
  ddbMock.on(PutCommand, { TableName: 'jobs-test' }).callsFake((input: any) => {
    const k = `${input.Item.operatorId}|${input.Item.jobId}`;
    if (markers.has(k)) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    markers.add(k);
    return {};
  });
  ddbMock.on(PutCommand, { TableName: 'uploads-test' }).resolves({});
  ddbMock.on(BatchWriteCommand).callsFake((input: any) => {
    const reqs = input.RequestItems['jobs-test'] as any[];
    const leave = Math.min(unprocessedPlan.shift() ?? 0, reqs.length);
    const accepted = reqs.slice(0, reqs.length - leave);
    for (const r of accepted) jobs.push(r.PutRequest.Item);
    return leave > 0 ? { UnprocessedItems: { 'jobs-test': reqs.slice(reqs.length - leave) } } : {};
  });
}

function installObject(body: string, meta: Record<string, string>) {
  s3Mock.on(GetObjectCommand).resolves({ Body: { transformToString: async () => body } as any, Metadata: meta });
}

const s3Event = () =>
  ({ Records: [{ eventTime: '2026-10-25T15:00:01.000Z', s3: { bucket: { name: 'csv-test' }, object: { key: KEY, size: 100 } } }] }) as any;

const csvOf = (n: number) => ['telefono,mensaje', ...Array.from({ length: n }, (_, i) => `55${10000000 + i},hola`)].join('\n');
const META = { operatorid: 'lider.didi', campaign: 'didi_vip', campaignid: 'lider.didi/1761400000000_cartera.csv', label: 'cartera-52' };

let logs: any[];
beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  installTables();
  vi.restoreAllMocks();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((m: unknown) => {
    try {
      logs.push(JSON.parse(String(m)));
    } catch {
      /* texto libre */
    }
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  timing.sleep = async () => {};
});

describe('POST /uploads/presign', () => {
  it('campaignid = key sin csv-uploads/ y label = campaignId del cliente (≤100)', async () => {
    access.value = { username: 'lider.didi', campaigns: ['didi_vip'], permissions: [], isAdmin: false, isLeader: true };
    const r: any = await api({
      routeKey: 'POST /uploads/presign',
      body: JSON.stringify({ filename: 'cartera.csv', campaign: 'didi_vip', campaignId: 'cartera-52' }),
      requestContext: { authorizer: { jwt: { claims: { 'cognito:username': 'lider.didi' } } } },
    } as any);
    expect(r.statusCode).toBe(200);
    const b = JSON.parse(r.body);
    expect(b.key).toMatch(/^csv-uploads\/lider\.didi\/\d+_cartera\.csv$/);
    expect(b.metadata.campaignid).toBe(b.key.slice('csv-uploads/'.length));
    expect(b.metadata.label).toBe('cartera-52');

    const long: any = await api({
      routeKey: 'POST /uploads/presign',
      body: JSON.stringify({ filename: 'a.csv', campaign: 'didi_vip', campaignId: 'x'.repeat(150) }),
      requestContext: { authorizer: { jwt: { claims: { 'cognito:username': 'lider.didi' } } } },
    } as any);
    expect(JSON.parse(long.body).metadata.label).toHaveLength(100);
  });
});

describe('csvTrigger', () => {
  it('forma del job: jobId = <campaignid>#i, label, sin leaseUntil; CSV borrado', async () => {
    installObject(csvOf(3), META);
    await csvTrigger(s3Event());
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      jobId: 'lider.didi/1761400000000_cartera.csv#0',
      campaignId: 'lider.didi/1761400000000_cartera.csv',
      label: 'cartera-52',
      srcKey: KEY,
      status: 'pending',
      attempts: 0,
    });
    expect(jobs[0]).not.toHaveProperty('leaseUntil');
    const del = s3Mock.commandCalls(DeleteObjectCommand);
    expect(del).toHaveLength(1);
    expect(del[0].args[0].input).toEqual({ Bucket: 'csv-test', Key: KEY });
  });

  it('dos cargas del mismo archivo/lada → jobs distintos', async () => {
    installObject(csvOf(2), { ...META, campaignid: 'lider.didi/1_cartera.csv' });
    await csvTrigger({ Records: [{ s3: { bucket: { name: 'csv-test' }, object: { key: 'csv-uploads/lider.didi/1_cartera.csv', size: 1 } } }] } as any);
    installObject(csvOf(2), { ...META, campaignid: 'lider.didi/2_cartera.csv' });
    await csvTrigger({ Records: [{ s3: { bucket: { name: 'csv-test' }, object: { key: 'csv-uploads/lider.didi/2_cartera.csv', size: 1 } } }] } as any);
    expect(new Set(jobs.map((j) => j.jobId)).size).toBe(4);
  });

  it('evento duplicado → no escribe y registra csv_duplicate_event', async () => {
    installObject(csvOf(3), META);
    await csvTrigger(s3Event());
    await csvTrigger(s3Event());
    expect(jobs).toHaveLength(3);
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(1);
    expect(logs).toContainEqual({ evt: 'csv_duplicate_event', key: KEY });
  });

  it('UnprocessedItems en el primer intento → se reintenta y quedan todos escritos', async () => {
    unprocessedPlan = [10];
    installObject(csvOf(25), META);
    await csvTrigger(s3Event());
    expect(jobs).toHaveLength(25);
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(2);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  it('quedan sin escribir tras 6 reintentos → csv_jobs_partial, no lanza y conserva el CSV', async () => {
    unprocessedPlan = Array(BATCH_RETRIES + 1).fill(5);
    installObject(csvOf(25), META);
    await expect(csvTrigger(s3Event())).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(BATCH_RETRIES + 1);
    expect(logs).toContainEqual({ evt: 'csv_jobs_partial', key: KEY, written: 20, missing: 5 });
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it('comilla sin cerrar → csv_rejected parse_error, sin jobs, sin lanzar', async () => {
    installObject('telefono,mensaje\n5512345678,"hola', META);
    await expect(csvTrigger(s3Event())).resolves.toBeUndefined();
    expect(jobs).toHaveLength(0);
    expect(logs.find((l) => l.evt === 'csv_rejected')).toMatchObject({ reason: 'parse_error', key: KEY });
  });

  it('objeto ya borrado (evento tardío) → no lanza', async () => {
    s3Mock.on(GetObjectCommand).rejects(Object.assign(new Error('x'), { name: 'NoSuchKey' }));
    await expect(csvTrigger(s3Event())).resolves.toBeUndefined();
    expect(logs).toContainEqual({ evt: 'csv_missing_object', key: KEY });
  });
});

const cfnTags = ['!Sub', '!GetAtt', '!Ref'].map((tag) => ({ tag, resolve: (v: string) => ({ [tag.slice(1)]: v }) }));
const sls = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'), { customTags: cfnTags as any });

describe('serverless.yml: cola endurecida', () => {
  it('GSI campaign-status-index con estado proyectado, sin tocar campaign-index', () => {
    const gsis = sls.resources.Resources.JobsTable.Properties.GlobalSecondaryIndexes;
    const old = gsis.find((g: any) => g.IndexName === 'campaign-index');
    expect(old.Projection.NonKeyAttributes).toEqual(['campaignId', 'leaseUntil', 'ttl']);
    const idx = gsis.find((g: any) => g.IndexName === 'campaign-status-index');
    expect(idx.KeySchema).toEqual([
      { AttributeName: 'campaign', KeyType: 'HASH' },
      { AttributeName: 'operatorId', KeyType: 'RANGE' },
    ]);
    expect(idx.Projection).toEqual({
      ProjectionType: 'INCLUDE',
      NonKeyAttributes: ['campaignId', 'srcKey', 'status', 'sentAt', 'ttl', 'label'],
    });
    expect(sls.provider.environment.JOBS_CAMPAIGN_INDEX).toBe("${param:jobsCampaignIndex, 'campaign-index'}");
  });

  it('CsvBucket expira csv-uploads/ a los 7 días', () => {
    expect(sls.resources.Resources.CsvBucket.Properties.LifecycleConfiguration).toEqual({
      Rules: [{ Id: 'expire-csv-uploads', Status: 'Enabled', Prefix: 'csv-uploads/', ExpirationInDays: 7 }],
    });
  });
});
