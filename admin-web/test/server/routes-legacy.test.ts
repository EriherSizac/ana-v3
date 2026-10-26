// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAgents } from '@/app/api/campaigns/[campaign]/legacy-agents/route';
import { GET as getChat } from '@/app/api/campaigns/[campaign]/legacy-chats/[agent]/[phone]/route';
import { GET as search } from '@/app/api/campaigns/[campaign]/legacy-chats/route';
import { signToken } from '../helpers/jwt';
import { ADMIN, authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V3 } from '../helpers/server';

beforeEach(() => setupServerTest());
afterEach(() => vi.unstubAllGlobals());

const NOT_LEADER = { ...LEADER, isLeader: false, roleNames: ['Carga'] };

describe('/api/campaigns/[campaign]/legacy-*', () => {
  it('usuario sin rol admin/líder → 403 en las tres rutas sin llamar a v3', async () => {
    const { calls } = mockFetch(NOT_LEADER);
    expect((await search(authedRequest('/api/campaigns/didi_vip/legacy-chats'), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
    expect((await getAgents(authedRequest('/api/campaigns/didi_vip/legacy-agents'), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
    expect((await getChat(authedRequest('/x'), ctx({ campaign: 'didi_vip', agent: 'erick', phone: '1' }))).status).toBe(403);
    expect(calls.filter((c) => c.url.startsWith(V3))).toHaveLength(0);
  });

  it('líder en campaña ajena → 403', async () => {
    mockFetch(LEADER);
    expect((await search(authedRequest('/api/campaigns/zendere/legacy-chats'), ctx({ campaign: 'zendere' }))).status).toBe(403);
  });

  it('propaga el token, los filtros y no envía llaves; sin caché', async () => {
    const token = signToken();
    const { calls } = mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/legacy-chats`]: () => Response.json({ total: 0, page: 1, conversations: [] }),
    });
    const res = await search(authedRequest('/api/campaigns/didi_vip/legacy-chats?phone=5512345678&agent=erick&from=2026-01-01&x=1', { token }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const c = calls.find((x) => x.url.startsWith(V3))!;
    expect(c.url).toBe(`${V3}/admin/campaigns/didi_vip/legacy-chats?agent=erick&phone=5512345678&from=2026-01-01`);
    expect(c.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(c.headers.get('x-admin-key')).toBeNull();
    expect(c.headers.get('x-api-key')).toBeNull();
  });

  it('conversación: proxy y 404 → "Conversación no encontrada"', async () => {
    mockFetch(ADMIN, {
      [`GET ${V3}/admin/campaigns/zendere/legacy-chats/erick/5215512345678`]: () => Response.json({ campaign: 'zendere', agent: 'erick', phone: '5215512345678', messages: [] }),
      [`GET ${V3}/admin/campaigns/zendere/legacy-chats/erick/1`]: () => Response.json({ error: 'not_found' }, { status: 404 }),
    });
    const ok = await getChat(authedRequest('/x'), ctx({ campaign: 'zendere', agent: 'erick', phone: '5215512345678' }));
    expect((await bodyOf(ok)).agent).toBe('erick');
    const nf = await getChat(authedRequest('/x'), ctx({ campaign: 'zendere', agent: 'erick', phone: '1' }));
    expect(nf.status).toBe(404);
    expect((await bodyOf(nf)).error).toEqual({ code: 'not_found', message: 'Conversación no encontrada' });
  });

  it('legacy-agents: proxy', async () => {
    mockFetch(LEADER, { [`GET ${V3}/admin/campaigns/didi_vip/legacy-agents`]: () => Response.json({ campaign: 'didi_vip', agents: ['erick'], extractedAt: null }) });
    expect(await bodyOf(await getAgents(authedRequest('/x'), ctx({ campaign: 'didi_vip' })))).toEqual({ campaign: 'didi_vip', agents: ['erick'], extractedAt: null });
  });
});
