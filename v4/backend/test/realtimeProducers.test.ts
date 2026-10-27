// Productores v4 del canal realtime (add-realtime-gateway): cada handler publica su
// evento / actualización forzada y su respuesta no cambia si la publicación falla.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { ddbMock, installAgentsTable, installV3Bucket, list, s3Mock } from './helpers';

const rt = vi.hoisted(() => ({ emit: vi.fn(async () => true), force: vi.fn(async () => true) }));
vi.mock('../src/lib/realtime', async (orig) => ({ ...(await orig<any>()), emitRealtime: rt.emit, forceRefresh: rt.force }));

const access = vi.hoisted(() => ({ value: null as any }));
vi.mock('../src/lib/access', () => ({
  resolveUserAccess: async () => access.value,
  can: () => true,
  canRoute: () => true,
  routeAllowed: async () => true,
}));
vi.mock('../src/lib/campaignsDb', () => ({
  listCampaignsDb: async () => ['didi_vip', 'prueba'],
  campaignExists: async () => true,
}));
vi.mock('../src/lib/dashboard', () => ({ fetchEligibleAgents: async () => ['ana', 'beto'] }));
vi.mock('../src/lib/rolePerms', () => ({ setRolePermissions: async () => {}, getRolePermissions: async () => [], getManyRolePermissions: async () => new Map() }));
vi.mock('../src/lib/accessCache', () => ({ invalidateByRole: async () => {}, getCached: async () => null, putCached: async () => {} }));

import { handler as directSend } from '../src/handlers/directSend';
import { handler as jobsPoll, resetUploadEventThrottleForTests, uploadsDue } from '../src/handlers/jobsPoll';
import { handler as jobsAdmin } from '../src/handlers/jobsAdmin';
import { handler as csvTrigger, timing } from '../src/handlers/csvTrigger';
import { handler as settings } from '../src/handlers/settings';
import { handler as agents } from '../src/handlers/agents';
import { handler as api } from '../src/handlers/api';
import { clearCampaignAgentsCache } from '../src/lib/campaignAgentsList';

const ADMIN = { username: 'admin', roleIds: [], roleNames: [], campaigns: ['*'], permissions: [], isAdmin: true, isLeader: true, isDeveloper: true };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const ev = (routeKey: string, body?: unknown, user = 'admin', extra: Record<string, unknown> = {}) =>
  ({
    routeKey,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': user } } } },
    ...extra,
  }) as any;
const call = async (fn: any, e: any) => {
  const r = await fn(e);
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

/** Corre el handler con la publicación OK y luego fallando: misma respuesta. */
async function sameWhenEmitFails(run: () => Promise<{ status: number; body: any }>, setup: () => void = () => {}) {
  // Misma hora en ambas corridas (las respuestas traen fechas de auditoría).
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(1_765_400_000_000);
    setup();
    const okRes = await run();
    rt.emit.mockResolvedValue(false);
    rt.force.mockResolvedValue(false);
    vi.setSystemTime(1_765_400_000_000);
    setup();
    const failRes = await run();
    expect(failRes).toEqual(okRes);
    return okRes;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  rt.emit.mockReset().mockResolvedValue(true);
  rt.force.mockReset().mockResolvedValue(true);
  access.value = ADMIN;
  resetUploadEventThrottleForTests();
  clearCampaignAgentsCache?.();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.SEND_API_KEY = 'k';
});

describe('POST /send', () => {
  it('jobs.changed al agente; respuesta igual si la publicación falla', async () => {
    ddbMock.on(PutCommand).resolves({});
    const run = () => call(directSend, { routeKey: 'POST /send', headers: { 'x-api-key': 'k' }, body: JSON.stringify({ message: 'hola', username: 'Ana', phone: '5512345678', campaign: 'prueba' }) });
    const r = await run();
    expect(r.status).toBe(200);
    expect(rt.emit).toHaveBeenCalledWith({ type: 'jobs.changed', users: ['ana'], campaign: 'prueba' });
    rt.emit.mockResolvedValue(false);
    expect((await run()).status).toBe(200);
  });
});

describe('POST /jobs/ack', () => {
  it('uploads.changed por carga, máximo uno cada 10 s', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { campaign: 'prueba', srcKey: 'csv-uploads/a/1.csv' } });
    const body = { acks: [{ jobId: 'c#1', status: 'sent' }, { jobId: 'c#2', status: 'sent' }, { jobId: 'c#3', status: 'sent' }] };
    const r = await call(jobsPoll, ev('POST /jobs/ack', body, 'ana'));
    expect(r.body).toEqual({ acked: 3, notFound: [], invalid: [] });
    expect(rt.emit).toHaveBeenCalledTimes(1);
    expect(rt.emit).toHaveBeenCalledWith([{ type: 'uploads.changed', campaign: 'prueba', ref: { srcKey: 'csv-uploads/a/1.csv', uploadId: 'csv-uploads/a/1.csv' } }]);
    await call(jobsPoll, ev('POST /jobs/ack', body, 'ana'));
    expect(rt.emit).toHaveBeenCalledTimes(1);
    expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ReturnValues).toBe('ALL_NEW');
  });

  it('ventana de 10 s por carga', () => {
    const m = new Map([['k1', 'prueba']]);
    expect(uploadsDue(m, 1_000_000)).toHaveLength(1);
    expect(uploadsDue(m, 1_005_000)).toHaveLength(0);
    expect(uploadsDue(m, 1_010_000)).toHaveLength(1);
  });

  it('respuesta igual si la publicación falla', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { campaign: 'prueba', srcKey: 'k' } });
    await sameWhenEmitFails(
      () => call(jobsPoll, ev('POST /jobs/ack', { acks: [{ jobId: 'c#1', status: 'sent' }] }, 'ana')),
      resetUploadEventThrottleForTests,
    );
  });
});

describe('POST /jobs/reassign y /jobs/review/resolve', () => {
  const job = (op: string, id: string, extra: Record<string, unknown> = {}) => ({
    operatorId: op,
    jobId: id,
    campaignId: 'c',
    campaign: 'prueba',
    phone: '1',
    template: 't',
    row: {},
    countryCode: '52',
    srcKey: 'k',
    status: 'pending',
    attempts: 0,
    ttl: FUTURE,
    ...extra,
  });

  it('reasignación: jobs.changed a ambos operadores y review.changed a la campaña', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [job('ana', 'c#1')] });
    ddbMock.on(GetCommand).resolves({ Item: job('ana', 'c#1') });
    ddbMock.on(TransactWriteCommand).resolves({});
    const r = await sameWhenEmitFails(() => call(jobsAdmin, ev('POST /jobs/reassign', { campaign: 'prueba', from: 'ana', to: 'beto' })));
    expect(r.body.moved).toBe(1);
    expect(rt.emit).toHaveBeenCalledWith([
      { type: 'jobs.changed', users: ['ana', 'beto'], campaign: 'prueba' },
      { type: 'review.changed', campaign: 'prueba' },
    ]);
  });

  it('resolución: jobs.changed al operador y review.changed', async () => {
    ddbMock.on(GetCommand).resolves({ Item: job('ana', 'c#1', { status: 'review' }) });
    ddbMock.on(UpdateCommand).resolves({});
    const r = await call(jobsAdmin, ev('POST /jobs/review/resolve', { campaign: 'prueba', action: 'discard', items: [{ operatorId: 'ana', jobId: 'c#1' }] }));
    expect(r.body.results[0].ok).toBe(true);
    expect(rt.emit).toHaveBeenCalledWith([
      { type: 'jobs.changed', users: ['ana'], campaign: 'prueba' },
      { type: 'review.changed', campaign: 'prueba' },
    ]);
  });

  it('sin jobs movidos no publica', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await call(jobsAdmin, ev('POST /jobs/reassign', { campaign: 'prueba', from: 'ana', to: 'beto' }));
    expect(rt.emit).not.toHaveBeenCalled();
  });
});

describe('csvTrigger', () => {
  it('reparto de un CSV: jobs.changed a cada destinatario y uploads.changed a la campaña', async () => {
    timing.sleep = async () => {};
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => 'telefono,mensaje\n5511111111,a\n5522222222,b' } as any,
      Metadata: { operatorid: 'lider', campaign: 'prueba', assignments: JSON.stringify({ ana: 1, beto: 1 }) },
    });
    s3Mock.on(DeleteObjectCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(BatchWriteCommand).resolves({});
    await csvTrigger({ Records: [{ s3: { bucket: { name: 'csv-test' }, object: { key: 'csv-uploads/lider/1.csv', size: 10 } } }] } as any);
    expect(rt.emit).toHaveBeenCalledWith({ type: 'jobs.changed', users: ['ana', 'beto'], campaign: 'prueba' });
    expect(rt.emit).toHaveBeenCalledWith({ type: 'uploads.changed', campaign: 'prueba', ref: { srcKey: 'csv-uploads/lider/1.csv', uploadId: 'csv-uploads/lider/1.csv' } });
  });
});

describe('PUT /admin/desktop-settings', () => {
  it('settings.changed desktop y actualización forzada de los desktops', async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    const r = await sameWhenEmitFails(() => call(settings, ev('PUT /admin/desktop-settings', { version: 0, values: { sendMinGapSeconds: 180 } }, 'dev')));
    expect(r.status).toBe(200);
    expect(rt.emit).toHaveBeenCalledWith({ type: 'settings.changed', ref: { scope: 'desktop' } });
    expect(rt.force).toHaveBeenCalledWith({ reason: 'settings', target: { kind: 'client', client: 'desktop' }, by: 'admin' });
  });
});

describe('POST /admin/agent-roster', () => {
  it('roster.changed a la campaña y session.refresh a los agentes del cuerpo', async () => {
    installAgentsTable({ didi_vip: {} });
    installV3Bucket({ 'campaign-agents/didi_vip.json': list('didi_vip', [['jperez', 'JPerez']]) });
    const r = await sameWhenEmitFails(() =>
      call(agents, ev('POST /admin/agent-roster', { campaign: 'didi_vip', agents: [{ operatorId: 'jperez', enabled: false }] })),
    );
    expect(r.status).toBe(200);
    expect(rt.emit).toHaveBeenCalledWith({ type: 'roster.changed', campaign: 'didi_vip' });
    expect(rt.force).toHaveBeenCalledWith({ reason: 'roster', target: { kind: 'user', users: ['JPerez'] }, by: 'admin' });
  });
});

describe('PUT /admin/role-permissions/{roleId}', () => {
  it('fuerza la actualización de las conexiones con el rol', async () => {
    const run = () =>
      call(api, ev('PUT /admin/role-permissions/{roleId}', { permissions: ['ana:contacts:list:upload'] }, 'admin', { pathParameters: { roleId: 'r-123' } }));
    const r = await sameWhenEmitFails(run);
    expect(r).toEqual({ status: 200, body: { roleId: 'r-123', permissions: ['ana:contacts:list:upload'] } });
    expect(rt.force).toHaveBeenCalledWith({ reason: 'permissions', target: { kind: 'role', roleId: 'r-123' } });
  });

  it('sin admin → 403 y no fuerza nada', async () => {
    access.value = { ...ADMIN, isAdmin: false };
    const r = await call(api, ev('PUT /admin/role-permissions/{roleId}', { permissions: [] }, 'x', { pathParameters: { roleId: 'r1' } }));
    expect(r.status).toBe(403);
    expect(rt.force).not.toHaveBeenCalled();
  });
});
