// Rutas con llaves codificadas y campañas sin distinguir mayúsculas (v4-canonical-identity-keys).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({ value: null as any }));
const registered = vi.hoisted(() => ({ calls: [] as [string, string][] }));
vi.mock('../src/lib/access', () => ({ resolveUserAccess: async () => access.value, can: () => true }));
vi.mock('../src/lib/campaignsDb', () => ({
  listCampaignsDb: async () => ['didi_vip'],
  campaignExists: async () => true,
}));
vi.mock('../src/lib/agents', () => ({
  registerAgent: async (c: string, o: string) => void registered.calls.push([c, o]),
  listCampaignAgents: async () => [],
  setAgentOverrides: async () => {},
  listEnabledAgents: async () => [],
}));

import { handler as api } from '../src/handlers/api';
import { handler as agents } from '../src/handlers/agents';

const base = (username: string, over: Record<string, unknown> = {}) => ({
  username,
  roleIds: [],
  roleNames: [],
  campaigns: ['didi_vip'],
  permissions: [],
  isAdmin: false,
  isLeader: false,
  ...over,
});

const call = async (fn: any, routeKey: string, user: string, opts: { body?: unknown; qs?: Record<string, string> } = {}) => {
  const r: any = await fn({
    routeKey,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    queryStringParameters: opts.qs,
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': user } } } },
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

beforeEach(() => {
  registered.calls = [];
  delete process.env.MEDIA_LEGACY_OWNER;
});
afterEach(() => vi.restoreAllMocks());

describe('media y sesión de WhatsApp con segmento codificado', () => {
  it('a@b pide su propia media media/a~40b/... → 200', async () => {
    access.value = base('a@b');
    const r = await call(api, 'GET /media/url', 'a@b', { qs: { key: 'media/a~40b/123_a.jpg' } });
    expect(r.status).toBe(200);
    expect(r.body.url).toContain('media/a~40b/123_a.jpg');
  });

  it('a_b pide media/a~40b/... → 403; agente no admin con media de otro → 403', async () => {
    access.value = base('a_b');
    expect((await call(api, 'GET /media/url', 'a_b', { qs: { key: 'media/a~40b/123_a.jpg' } })).status).toBe(403);
    expect((await call(api, 'GET /media/url', 'a_b', { qs: { key: 'media/otro/123_a.jpg' } })).status).toBe(403);
  });

  it('segmento inválido → 400 key inválida', async () => {
    access.value = base('a@b');
    expect(await call(api, 'GET /media/url', 'a@b', { qs: { key: 'media/a@b/1.jpg' } })).toEqual({ status: 400, body: { error: 'key inválida' } });
  });

  it('MEDIA_LEGACY_OWNER=true acepta el segmento saneado propio (transición)', async () => {
    access.value = base('a@b');
    process.env.MEDIA_LEGACY_OWNER = 'true';
    expect((await call(api, 'GET /media/url', 'a@b', { qs: { key: 'media/a_b/1.jpg' } })).status).toBe(200);
    process.env.MEDIA_LEGACY_OWNER = 'false';
    expect((await call(api, 'GET /media/url', 'a@b', { qs: { key: 'media/a_b/1.jpg' } })).status).toBe(403);
  });

  it('wa-sessions de a@b y a_b no colisionan; media/presign usa el segmento codificado', async () => {
    access.value = base('a@b');
    expect((await call(api, 'POST /wa-session/presign', 'a@b', { body: { op: 'get' } })).body.key).toBe('wa-sessions/a~40b/session.zip');
    access.value = base('a_b');
    expect((await call(api, 'POST /wa-session/presign', 'a_b', { body: { op: 'get' } })).body.key).toBe('wa-sessions/a_b/session.zip');
    access.value = base('erick.silva');
    expect((await call(api, 'POST /media/presign', 'erick.silva', { body: { filename: 'x.jpg' } })).body.key).toMatch(/^media\/erick\.silva\//);
  });
});

describe('CSV: prefijo codificado y destinatarios canónicos', () => {
  it('a_b no puede borrar csv-uploads/a~40b/...; otro usuario tampoco', async () => {
    access.value = base('a_b');
    expect(await call(api, 'POST /uploads/delete', 'a_b', { body: { key: 'csv-uploads/a~40b/123_a.csv' } })).toEqual({
      status: 403,
      body: { error: 'key no permitida' },
    });
    expect((await call(api, 'POST /uploads/delete', 'a_b', { body: { key: 'csv-uploads/otro/123_a.csv' } })).status).toBe(403);
  });

  it('presign: campaña con otra grafía se permite y usa la del catálogo; assignments canónicos', async () => {
    access.value = base('lider', { campaigns: ['DIDI_VIP'], isLeader: true });
    const r = await call(api, 'POST /uploads/presign', 'lider', {
      body: { campaign: 'Didi_Vip', distribute: true, assignments: { 'Ana.Lopez': 1, 'ana.lopez': 1, luis: 1 } },
    });
    expect(r.status).toBe(200);
    expect(r.body.metadata.campaign).toBe('didi_vip');
    expect(JSON.parse(r.body.metadata.assignments)).toEqual({ 'ana.lopez': 2, luis: 1 });
    expect(r.body.key).toMatch(/^csv-uploads\/lider\//);
  });

  it('presign de a@b firma la key bajo csv-uploads/a~40b/', async () => {
    access.value = base('a@b', { isLeader: true });
    const r = await call(api, 'POST /uploads/presign', 'a@b', { body: { campaign: 'didi_vip' } });
    expect(r.body.key).toMatch(/^csv-uploads\/a~40b\/\d+_upload\.csv$/);
  });
});

describe('heartbeat con otra grafía', () => {
  it('agente de didi_vip envía DIDI_VIP → se registra en didi_vip', async () => {
    access.value = base('ana.lopez');
    const r = await call(agents, 'POST /agents/heartbeat', 'Ana.Lopez', { body: { campaign: 'DIDI_VIP' } });
    expect(r.status).toBe(200);
    expect(registered.calls).toEqual([['didi_vip', 'ana.lopez']]);
  });

  it('campaña ajena → 403', async () => {
    access.value = base('ana.lopez');
    expect((await call(agents, 'POST /agents/heartbeat', 'ana.lopez', { body: { campaign: 'zendere' } })).status).toBe(403);
  });
});
