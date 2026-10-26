import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ddbMock, installAgentsTable, list, s3Mock } from './helpers';

const eligible = vi.hoisted(() => ({ value: [] as string[] }));
const access = vi.hoisted(() => ({ value: null as any }));

vi.mock('../src/lib/dashboard', () => ({ getEligibleAgents: async () => eligible.value }));
vi.mock('../src/lib/access', () => ({
  resolveUserAccess: async () => access.value,
  can: () => true,
  canRoute: () => true,
  routeAllowed: async () => true,
}));
vi.mock('../src/lib/campaignsDb', () => ({ campaignExists: async () => true }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://signed.invalid/put' }));

import { handler as api } from '../src/handlers/api';
import { handler as csvTrigger } from '../src/handlers/csvTrigger';
import { getDistributableAgents } from '../src/lib/distribution';
import { clearCampaignAgentsCache } from '../src/lib/campaignAgentsList';

const LEADER = {
  username: 'lider.didi',
  roleIds: [],
  roleNames: ['Líder DIDI VIP'],
  campaigns: ['didi_vip'],
  permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute'],
  isAdmin: false,
  isLeader: true,
};

let objects: Record<string, { body: string; meta?: Record<string, string> }>;

function installS3() {
  s3Mock.on(GetObjectCommand).callsFake((input: any) => {
    const o = objects[input.Key];
    if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { Body: { transformToString: async () => o.body }, Metadata: o.meta ?? {} };
  });
}

const presign = async (body: unknown) => {
  const r: any = await api({
    routeKey: 'POST /uploads/presign',
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': 'lider.didi' } } } },
  } as any);
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

async function runTrigger(meta: Record<string, string>) {
  objects['csv-uploads/lider.didi/1_x.csv'] = { body: 'telefono,mensaje\n5512345678,a\n5512345679,b\n5512345670,c\n', meta };
  const writes: any[] = [];
  ddbMock.on(BatchWriteCommand).callsFake((input: any) => {
    for (const items of Object.values(input.RequestItems) as any[]) for (const it of items) writes.push(it.PutRequest.Item);
    return {};
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await csvTrigger({
    Records: [{ s3: { bucket: { name: 'csv-test' }, object: { key: 'csv-uploads/lider.didi/1_x.csv', size: 100 } } }],
  } as any);
  return writes.map((w) => w.operatorId);
}

describe('AGENT_ROSTER_FILTER', () => {
  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    clearCampaignAgentsCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    access.value = LEADER;
    eligible.value = ['Ana.Lopez', 'luis', 'pedro'];
    objects = { 'campaign-agents/didi_vip.json': { body: list('didi_vip', [['ana.lopez', 'Ana.Lopez'], ['luis', 'luis']]) } };
    installS3();
    installAgentsTable({ didi_vip: { luis: { enabled: false } } });
  });

  it('flag apagado: elegibles del Dashboard sin cambios', async () => {
    expect(await getDistributableAgents('didi_vip')).toEqual(['Ana.Lopez', 'luis', 'pedro']);
    const r = await presign({ campaign: 'didi_vip', distribute: true });
    expect(r.body.eligibleAgents).toEqual(['Ana.Lopez', 'luis', 'pedro']);
    expect(await runTrigger({ operatorid: 'lider.didi', distribute: '1', campaign: 'didi_vip' })).toEqual(['Ana.Lopez', 'luis', 'pedro']);
  });

  it('flag encendido: filtra deshabilitado (luis) y no derivado (pedro)', async () => {
    vi.stubEnv('AGENT_ROSTER_FILTER', 'true');
    expect(await getDistributableAgents('didi_vip')).toEqual(['Ana.Lopez']);
    const r = await presign({ campaign: 'didi_vip', distribute: true });
    expect(r.body.eligibleAgents).toEqual(['Ana.Lopez']);
    expect(await runTrigger({ operatorid: 'lider.didi', distribute: '1', campaign: 'didi_vip' })).toEqual(['Ana.Lopez', 'Ana.Lopez', 'Ana.Lopez']);
  });

  it('flag encendido sin habilitados → jobs al uploader', async () => {
    vi.stubEnv('AGENT_ROSTER_FILTER', 'true');
    eligible.value = ['pedro'];
    expect(await runTrigger({ operatorid: 'lider.didi', distribute: '1', campaign: 'didi_vip' })).toEqual([
      'lider.didi',
      'lider.didi',
      'lider.didi',
    ]);
  });

  it('flag encendido con lista en error → jobs al uploader', async () => {
    vi.stubEnv('AGENT_ROSTER_FILTER', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    objects['campaign-agents/didi_vip.json'] = { body: '{roto' };
    expect(await getDistributableAgents('didi_vip')).toEqual([]);
  });

  it('presign con assignments a un deshabilitado → 400 sin URL', async () => {
    vi.stubEnv('AGENT_ROSTER_FILTER', 'true');
    const r = await presign({ campaign: 'didi_vip', distribute: true, assignments: { luis: 1 } });
    expect(r).toEqual({ status: 400, body: { error: 'agente no habilitado: luis' } });
  });

  it('presign con assignments y lista en error → 503', async () => {
    vi.stubEnv('AGENT_ROSTER_FILTER', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    objects['campaign-agents/didi_vip.json'] = { body: '{roto' };
    const r = await presign({ campaign: 'didi_vip', distribute: true, assignments: { 'Ana.Lopez': 1 } });
    expect(r).toEqual({ status: 503, body: { error: 'roster no disponible' } });
  });

  it('presign con assignments a habilitados → URL; con flag apagado no se valida', async () => {
    vi.stubEnv('AGENT_ROSTER_FILTER', 'true');
    expect((await presign({ campaign: 'didi_vip', distribute: true, assignments: { 'ana.lopez': 2 } })).body.url).toBe('https://signed.invalid/put');
    vi.stubEnv('AGENT_ROSTER_FILTER', 'false');
    expect((await presign({ campaign: 'didi_vip', distribute: true, assignments: { luis: 1 } })).status).toBe(200);
  });
});
