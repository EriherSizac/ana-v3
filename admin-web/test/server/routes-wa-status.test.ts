// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as markPOST } from '@/app/api/agent/wa-status/[campaign]/route';
import { POST as lookupPOST } from '@/app/api/agent/wa-status/[campaign]/lookup/route';
import { POST as campaignLookupPOST } from '@/app/api/campaigns/[campaign]/wa-status/lookup/route';
import { signToken } from '../helpers/jwt';
import { clearAccessCache } from '@/server/access/resolveAccess';
import { authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V3, type MeAccess } from '../helpers/server';

/** add-whatsapp-status-registry: BFF del registro de WhatsApp. */
const SENDER: MeAccess = { permissions: ['ana:campaign:message:send'], campaigns: ['didi_vip'], roleNames: ['Agente'], isAdmin: false, isLeader: false };
const post = (body: unknown, token?: string) => authedRequest('/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...(token ? { token } : {}) });
const ITEMS = { '525512345678': { status: 'no_whatsapp', updatedAt: '2026-10-29T17:00:00.000Z', updatedBy: 'luis', source: 'cli_send', lastNoWaAt: '2026-10-29T17:00:00.000Z', noWaCount: 1 } };

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/agent/wa-status/[campaign]/lookup', () => {
  it('reenvía campaña normalizada, teléfonos y token a v3', async () => {
    const token = signToken();
    const { calls } = mockFetch(SENDER, { [`POST ${V3}/agent/wa-status/lookup`]: () => Response.json({ success: true, data: { items: ITEMS } }) });
    const res = await lookupPOST(post({ phones: ['5215512345678'] }, token), ctx({ campaign: 'DIDI_VIP' }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).items).toEqual(ITEMS);
    const c = calls.find((x) => x.url.startsWith(V3))!;
    expect(JSON.parse(c.body!)).toEqual({ campaign: 'didi_vip', phones: ['5215512345678'] });
    expect(c.headers.get('authorization')).toBe(`Bearer ${token}`);
  });

  it('más de 2000 teléfonos o teléfono no textual → 400 sin llamar a v3', async () => {
    const { calls } = mockFetch(SENDER);
    expect((await lookupPOST(post({ phones: Array(2001).fill('5500000000') }), ctx({ campaign: 'didi_vip' }))).status).toBe(400);
    expect((await lookupPOST(post({ phones: [{ x: 1 }] }), ctx({ campaign: 'didi_vip' }))).status).toBe(400);
    expect(calls.filter((c) => c.url.startsWith(V3))).toHaveLength(0);
  });

  it('sin permiso de envío → 403; v3 403 → mensaje de agente', async () => {
    mockFetch({ ...SENDER, permissions: ['ana:chats:conversation:view'] });
    expect((await lookupPOST(post({ phones: ['5500000000'] }), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
    vi.unstubAllGlobals();
    clearAccessCache();
    mockFetch(SENDER, { [`POST ${V3}/agent/wa-status/lookup`]: () => Response.json({ error: 'Forbidden' }, { status: 403 }) });
    const res = await lookupPOST(post({ phones: ['5500000000'] }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.message).toBe('No estás habilitado como agente v3 en esta campaña');
  });
});

describe('/api/agent/wa-status/[campaign]', () => {
  it('marca has_whatsapp en v3 con la campaña de la ruta', async () => {
    const { calls } = mockFetch(SENDER, { [`POST ${V3}/agent/wa-status`]: () => Response.json({ success: true, data: { updated: 1, rejected: [] } }) });
    const res = await markPOST(post({ phones: ['5512345678'], status: 'has_whatsapp' }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).updated).toBe(1);
    expect(JSON.parse(calls.find((x) => x.url.startsWith(V3))!.body!)).toEqual({ campaign: 'didi_vip', phones: ['5512345678'], status: 'has_whatsapp' });
  });

  it('status inválido o más de 500 teléfonos → 400', async () => {
    const { calls } = mockFetch(SENDER);
    expect((await markPOST(post({ phones: ['5512345678'], status: 'quizas' }), ctx({ campaign: 'didi_vip' }))).status).toBe(400);
    expect((await markPOST(post({ phones: Array(501).fill('5512345678'), status: 'has_whatsapp' }), ctx({ campaign: 'didi_vip' }))).status).toBe(400);
    expect(calls.filter((c) => c.url.startsWith(V3))).toHaveLength(0);
  });
});

describe('/api/campaigns/[campaign]/wa-status/lookup', () => {
  it('líder: usa la ruta admin de v3', async () => {
    const { calls } = mockFetch(LEADER, { [`POST ${V3}/admin/campaigns/didi_vip/wa-status/lookup`]: () => Response.json({ success: true, data: { items: ITEMS } }) });
    const res = await campaignLookupPOST(post({ phones: ['5512345678'] }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(200);
    expect(JSON.parse(calls.find((x) => x.url.startsWith(V3))!.body!)).toEqual({ phones: ['5512345678'] });
  });

  it('sin permiso de subir Contactos o fuera de alcance → 403', async () => {
    mockFetch(SENDER);
    expect((await campaignLookupPOST(post({ phones: ['5512345678'] }), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
    vi.unstubAllGlobals();
    clearAccessCache();
    mockFetch(LEADER);
    expect((await campaignLookupPOST(post({ phones: ['5512345678'] }), ctx({ campaign: 'otra' }))).status).toBe(403);
  });
});
