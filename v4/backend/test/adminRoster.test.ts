import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ddbMock, installAgentsTable, installV3Bucket, list, s3Mock } from './helpers';

const access = vi.hoisted(() => ({ value: null as any }));
const catalog = vi.hoisted(() => ({ value: ['didi_vip', 'zendere', 'prueba'] }));

vi.mock('../src/lib/access', () => ({ resolveUserAccess: async () => access.value }));
vi.mock('../src/lib/campaignsDb', () => ({
  listCampaignsDb: async () => catalog.value,
  campaignExists: async (c: string) => catalog.value.includes(c),
}));

import { handler } from '../src/handlers/agents';
import { clearCampaignAgentsCache } from '../src/lib/campaignAgentsList';

const LEADER = {
  username: 'lider.didi',
  roleIds: [],
  roleNames: ['Líder DIDI VIP'],
  campaigns: ['didi_vip'],
  permissions: ['ana:admin:agents:manage', 'ana:contacts:list:upload'],
  isAdmin: false,
  isLeader: true,
};
const AGENT = { ...LEADER, username: 'agente', permissions: ['ana:chats:conversation:view'], isLeader: false };
const ADMIN = { ...LEADER, username: 'admin', isAdmin: true, campaigns: [] };

const ev = (routeKey: string, opts: { body?: unknown; query?: Record<string, string> } = {}) =>
  ({
    routeKey,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    queryStringParameters: opts.query,
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': access.value.username } } } },
  }) as any;

const call = async (e: any) => {
  const r: any = await handler(e);
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

describe('/admin/agent-roster', () => {
  let table: ReturnType<typeof installAgentsTable>;
  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    clearCampaignAgentsCache();
    vi.unstubAllEnvs();
    access.value = LEADER;
    table = installAgentsTable({
      didi_vip: { 'Ana.Lopez': { lastSeen: Date.now() }, viejo: { enabled: false, enabledUpdatedBy: 'x', enabledUpdatedAt: 'y' } },
    });
    installV3Bucket({
      'campaign-agents/didi_vip.json': list('didi_vip', [['ana.lopez', 'Ana.Lopez'], ['luis', 'luis']]),
      'campaign-agents/zendere.json': list('zendere', [['a', 'a'], ['b', 'b']]),
    });
  });

  it('GET: lista derivada con estado, lastSeen/active e inactiveOverrides', async () => {
    const { status, body } = await call(ev('GET /admin/agent-roster', { query: { campaign: 'didi_vip' } }));
    expect(status).toBe(200);
    expect(body.agents).toEqual([
      { operatorId: 'Ana.Lopez', enabled: true, override: null, lastSeen: expect.any(Number), active: true, kind: 'agent' },
      { operatorId: 'luis', enabled: true, override: null, lastSeen: null, active: false, kind: 'agent' },
    ]);
    expect(body.inactiveOverrides).toEqual([{ operatorId: 'viejo', enabled: false, updatedAt: 'y', updatedBy: 'x' }]);
  });

  it('GET sin excepciones: todos enabled y override null (admin en campaña ajena)', async () => {
    access.value = ADMIN;
    const { body } = await call(ev('GET /admin/agent-roster', { query: { campaign: 'zendere' } }));
    expect(body.agents.map((a: any) => [a.enabled, a.override])).toEqual([[true, null], [true, null]]);
  });

  it('supervisor (upload + distribute) lee el roster de su campaña con kind, pero no escribe', async () => {
    installV3Bucket({
      'campaign-agents/didi_vip.json': JSON.stringify({
        schemaVersion: 1,
        campaign: 'didi_vip',
        generatedAt: new Date().toISOString(),
        agents: [
          { username: 'ana.lopez', cognitoUsername: 'Ana.Lopez', roleIds: ['r1'], kind: 'agent' },
          { username: 'sara', cognitoUsername: 'sara', roleIds: ['s1'], kind: 'supervisor' },
        ],
      }),
    });
    vi.stubEnv('PERMISSIONS_ENFORCED', 'false');
    access.value = { ...AGENT, username: 'sara', permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute'] };
    const r = await call(ev('GET /admin/agent-roster', { query: { campaign: 'didi_vip' } }));
    expect(r.status).toBe(200);
    expect(r.body.agents.map((a: any) => [a.operatorId, a.kind])).toEqual([
      ['Ana.Lopez', 'agent'],
      ['sara', 'supervisor'],
    ]);
    const w = await call(ev('POST /admin/agent-roster', { body: { campaign: 'didi_vip', agents: [{ operatorId: 'sara', enabled: false }] } }));
    expect(w).toEqual({ status: 403, body: { error: 'sin permiso' } });
    // Campaña ajena: 403 también para leer.
    expect((await call(ev('GET /admin/agent-roster', { query: { campaign: 'zendere' } }))).status).toBe(403);
  });

  it('solo carga (sin reparto) no lee el roster', async () => {
    access.value = { ...AGENT, permissions: ['ana:contacts:list:upload'] };
    expect((await call(ev('GET /admin/agent-roster', { query: { campaign: 'didi_vip' } }))).status).toBe(403);
  });

  it('el líder deshabilita a una supervisora derivada como a un agente', async () => {
    installV3Bucket({
      'campaign-agents/didi_vip.json': JSON.stringify({
        schemaVersion: 1,
        campaign: 'didi_vip',
        generatedAt: new Date().toISOString(),
        agents: [{ username: 'sara', cognitoUsername: 'sara', roleIds: ['s1'], kind: 'supervisor' }],
      }),
    });
    const r = await call(ev('POST /admin/agent-roster', { body: { campaign: 'didi_vip', agents: [{ operatorId: 'sara', enabled: false }] } }));
    expect(r.status).toBe(200);
    expect(r.body.agents[0]).toMatchObject({ operatorId: 'sara', kind: 'supervisor', enabled: false });
  });

  it('GET sin campaign → 400 falta campaign', async () => {
    expect(await call(ev('GET /admin/agent-roster'))).toEqual({ status: 400, body: { error: 'falta campaign' } });
  });

  it('agente sin permiso → 403 aunque PERMISSIONS_ENFORCED=false', async () => {
    vi.stubEnv('PERMISSIONS_ENFORCED', 'false');
    access.value = AGENT;
    const r = await call(ev('POST /admin/agent-roster', { body: { campaign: 'didi_vip', agents: [{ operatorId: 'luis', enabled: false }] } }));
    expect(r).toEqual({ status: 403, body: { error: 'sin permiso' } });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('líder en campaña ajena → 403', async () => {
    const r = await call(ev('POST /admin/agent-roster', { body: { campaign: 'zendere', agents: [{ operatorId: 'a', enabled: false }] } }));
    expect(r.status).toBe(403);
  });

  it('campaña inexistente → 400', async () => {
    access.value = ADMIN;
    const r = await call(ev('POST /admin/agent-roster', { body: { campaign: 'nope', agents: [{ operatorId: 'a', enabled: false }] } }));
    expect(r).toEqual({ status: 400, body: { error: 'la campaña "nope" no existe' } });
  });

  it.each([
    ['vacío', []],
    ['101 entradas', Array.from({ length: 101 }, (_, i) => ({ operatorId: `u${i}`, enabled: false }))],
    ['enabled no booleano', [{ operatorId: 'luis', enabled: 'false' }]],
    ['repetido', [{ operatorId: 'luis', enabled: false }, { operatorId: 'LUIS', enabled: true }]],
  ])('body inválido (%s) → 400 sin escribir', async (_n, agents) => {
    const r = await call(ev('POST /admin/agent-roster', { body: { campaign: 'didi_vip', agents } }));
    expect(r.status).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('habilitar a quien no es agente → 409 sin escribir', async () => {
    const r = await call(ev('POST /admin/agent-roster', { body: { campaign: 'didi_vip', agents: [{ operatorId: 'pedro', enabled: true }] } }));
    expect(r).toEqual({ status: 409, body: { error: 'no es agente de la campaña: pedro' } });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('deshabilitar → 200 con roster actualizado; autor = usuario del token', async () => {
    const r = await call(ev('POST /admin/agent-roster', { body: { campaign: 'didi_vip', agents: [{ operatorId: 'luis', enabled: false }] } }));
    expect(r.status).toBe(200);
    const luis = r.body.agents.find((a: any) => a.operatorId === 'luis');
    expect(luis).toMatchObject({ enabled: false, override: { enabled: false, updatedBy: 'lider.didi' } });
    expect(table.get('didi_vip')!.get('luis')).toMatchObject({ enabled: false, enabledUpdatedBy: 'lider.didi' });
  });

  it('usa el operatorId del pool (ana.lopez → Ana.Lopez) y no toca lastSeen', async () => {
    const before = table.get('didi_vip')!.get('Ana.Lopez').lastSeen;
    await call(ev('POST /admin/agent-roster', { body: { campaign: 'didi_vip', agents: [{ operatorId: 'ana.lopez', enabled: false }] } }));
    expect(table.get('didi_vip')!.get('Ana.Lopez')).toMatchObject({ enabled: false, lastSeen: before });
    expect(table.get('didi_vip')!.has('ana.lopez')).toBe(false);
  });

  it('lista vencida → 503 roster no disponible', async () => {
    installV3Bucket({ 'campaign-agents/didi_vip.json': list('didi_vip', [], new Date(Date.now() - 25 * 3600_000).toISOString()) });
    const r = await call(ev('GET /admin/agent-roster', { query: { campaign: 'didi_vip' } }));
    expect(r).toEqual({ status: 503, body: { error: 'roster no disponible' } });
  });

  it('heartbeat de un agente deshabilitado conserva enabled:false', async () => {
    table.get('didi_vip')!.set('luis', { campaign: 'didi_vip', operatorId: 'luis', enabled: false });
    access.value = { ...AGENT, username: 'luis' };
    const r = await call(ev('POST /agents/heartbeat', { body: { campaign: 'didi_vip' } }));
    expect(r.status).toBe(200);
    expect(table.get('didi_vip')!.get('luis')).toMatchObject({ enabled: false, lastSeen: expect.any(Number) });
  });
});

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
