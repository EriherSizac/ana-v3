// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as agentGET } from '@/app/api/agent/results/[campaign]/route';
import { GET as campaignGET } from '@/app/api/campaigns/[campaign]/results/route';
import { signToken } from '../helpers/jwt';
import { clearAccessCache } from '@/server/access/resolveAccess';
import { authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V3, type MeAccess } from '../helpers/server';

/** add-agent-send-history: BFF del historial de envíos. */
const SENDER: MeAccess = { permissions: ['ana:campaign:message:send'], campaigns: ['didi_vip'], roleNames: ['Agente'], isAdmin: false, isLeader: false };
const PAGE = { campaign: 'didi_vip', agent: 'ana', agents: ['ana'], total: 0, items: [], nextCursor: null, publications: [] };

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/agent/results/[campaign]', () => {
  it('reenvía token y solo los parámetros conocidos (sin agent)', async () => {
    const token = signToken();
    const { calls } = mockFetch(SENDER, {
      [`GET ${V3}/agent/results/didi_vip`]: () => Response.json({ success: true, data: PAGE }),
    });
    const res = await agentGET(authedRequest('/x?from=2026-10-23&to=2026-10-29&status=sent,error&q=CR-1&agent=otro&foo=1&sort=credit&order=asc', { token }), ctx({ campaign: 'DIDI_VIP' }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).agents).toEqual(['ana']);
    const c = calls.find((x) => x.url.startsWith(V3))!;
    const u = new URL(c.url);
    expect(u.searchParams.get('status')).toBe('sent,error');
    expect(u.searchParams.get('q')).toBe('CR-1');
    expect(u.searchParams.get('agent')).toBeNull();
    expect(u.searchParams.get('foo')).toBeNull();
    expect(c.headers.get('authorization')).toBe(`Bearer ${token}`);
  });

  it('parámetro inválido → 400 sin llamar a v3', async () => {
    const { calls } = mockFetch(SENDER);
    expect((await agentGET(authedRequest('/x?from=ayer'), ctx({ campaign: 'didi_vip' }))).status).toBe(400);
    expect(calls.filter((c) => c.url.startsWith(V3))).toHaveLength(0);
  });

  it('sin permiso de envío → 403; v3 403 → mensaje de agente', async () => {
    mockFetch({ ...SENDER, permissions: ['ana:chats:conversation:view'] });
    expect((await agentGET(authedRequest('/x'), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
    vi.unstubAllGlobals();
    clearAccessCache();
    mockFetch(SENDER, { [`GET ${V3}/agent/results/didi_vip`]: () => Response.json({ message: 'Forbidden' }, { status: 403 }) });
    const res = await agentGET(authedRequest('/x'), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.message).toBe('No estás habilitado como agente v3 en esta campaña');
  });

  it('400 de v3 conserva el mensaje', async () => {
    mockFetch(SENDER, { [`GET ${V3}/agent/results/didi_vip`]: () => Response.json({ success: false, message: 'El rango admite como máximo 31 días' }, { status: 400 }) });
    const res = await agentGET(authedRequest('/x?from=2026-01-01&to=2026-10-29'), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.message).toBe('El rango admite como máximo 31 días');
  });
});

describe('/api/campaigns/[campaign]/results', () => {
  it('líder: reenvía agent a la ruta admin de v3', async () => {
    const { calls } = mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/results`]: () => Response.json({ success: true, data: { ...PAGE, agent: 'luis' } }),
    });
    const res = await campaignGET(authedRequest('/x?agent=luis&status=no_whatsapp'), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(200);
    const u = new URL(calls.find((x) => x.url.startsWith(V3))!.url);
    expect(u.searchParams.get('agent')).toBe('luis');
    expect(u.searchParams.get('status')).toBe('no_whatsapp');
  });

  it('sin permisos de Contactos o fuera de alcance → 403 sin llamar a v3', async () => {
    const { calls } = mockFetch(SENDER);
    expect((await campaignGET(authedRequest('/x'), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
    vi.unstubAllGlobals();
    clearAccessCache();
    const second = mockFetch(LEADER);
    expect((await campaignGET(authedRequest('/x'), ctx({ campaign: 'otra' }))).status).toBe(403);
    expect([...calls, ...second.calls].filter((c) => c.url.startsWith(V3))).toHaveLength(0);
  });

  it('agent inválido → 400', async () => {
    mockFetch(LEADER);
    expect((await campaignGET(authedRequest('/x?agent=a%2Fb'), ctx({ campaign: 'didi_vip' }))).status).toBe(400);
  });
});
