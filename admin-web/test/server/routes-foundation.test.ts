// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getCampaigns } from '@/app/api/campaigns/route';
import { GET as getMe } from '@/app/api/me/route';
import { signToken } from '../helpers/jwt';
import { AGENT, authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V4 } from '../helpers/server';

describe('GET /api/me', () => {
  beforeEach(() => setupServerTest());
  afterEach(() => vi.unstubAllGlobals());

  it('devuelve el acceso de v4 con isDeveloper', async () => {
    mockFetch({ ...LEADER, roleNames: ['Líder Didi', 'developer'] });
    const res = await getMe(authedRequest('/api/me'), ctx());
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({
      username: 'lider.didi',
      permissions: LEADER.permissions,
      campaigns: ['didi_vip'],
      roleNames: ['Líder Didi', 'developer'],
      isAdmin: false,
      isLeader: true,
      isDeveloper: true,
    });
  });

  it('un agente sin permisos también obtiene su acceso (la UI muestra "Sin acceso")', async () => {
    mockFetch(AGENT);
    const res = await getMe(authedRequest('/api/me', { token: signToken({ username: 'agente.1' }) }), ctx());
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).username).toBe('agente.1');
  });
});

describe('GET /api/campaigns', () => {
  beforeEach(() => setupServerTest());
  afterEach(() => vi.unstubAllGlobals());

  it('proxy a v4 /agents/campaigns con el token del usuario y sin llaves', async () => {
    const token = signToken();
    const { calls } = mockFetch(LEADER, {
      [`GET ${V4}/agents/campaigns`]: () => Response.json({ campaigns: ['didi_vip'] }),
    });
    const res = await getCampaigns(authedRequest('/api/campaigns', { token }), ctx());
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ campaigns: ['didi_vip'] });
    const call = calls.find((c) => c.url.endsWith('/agents/campaigns'))!;
    expect(call.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(call.headers.get('x-api-key')).toBeNull();
    expect(call.headers.get('x-admin-key')).toBeNull();
    for (const c of calls) {
      for (const [, v] of c.headers) expect(v).not.toContain(process.env.ROLES_API_KEY!);
    }
  });

  it('agente sin permisos → 403 sin llamar a /agents/campaigns', async () => {
    const { calls } = mockFetch(AGENT);
    const res = await getCampaigns(authedRequest('/api/campaigns'), ctx());
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.url.endsWith('/agents/campaigns'))).toBe(false);
  });

  it('error 500 de v4 → 503 upstream_unavailable genérico', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(LEADER, {
      [`GET ${V4}/agents/campaigns`]: () => Response.json({ error: 'pg: connection refused at 10.0.0.1' }, { status: 500 }),
    });
    const res = await getCampaigns(authedRequest('/api/campaigns'), ctx());
    expect(res.status).toBe(503);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('upstream_unavailable');
    expect(JSON.stringify(body)).not.toContain('10.0.0.1');
    spy.mockRestore();
  });
});
