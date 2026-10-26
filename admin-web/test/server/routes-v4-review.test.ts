// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/v4/campaigns/[campaign]/review/route';
import { POST } from '@/app/api/v4/campaigns/[campaign]/review/resolve/route';
import { signToken } from '../helpers/jwt';
import { authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V4 } from '../helpers/server';

const SRC = 'csv-uploads/lider/1761400000000_cartera.csv';
const ITEM = { operatorId: 'ana.lopez', jobId: 'lider/1761400000000_cartera.csv#3' };

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const v4Calls = <T extends { url: string }>(calls: T[]) => calls.filter((c) => c.url.startsWith(V4) && !c.url.endsWith('/me'));

describe('/api/v4/campaigns/[campaign]/review', () => {
  it('GET propaga el id token, la campaña y srcKey a v4 /jobs/review', async () => {
    const token = signToken();
    const { calls } = mockFetch(LEADER, {
      [`GET ${V4}/jobs/review`]: () => Response.json({ campaign: 'didi_vip', items: [{ ...ITEM, status: 'review' }] }),
    });
    const res = await GET(authedRequest(`/x?srcKey=${encodeURIComponent(SRC)}`, { token }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).items).toHaveLength(1);
    const c = v4Calls(calls)[0]!;
    const u = new URL(c.url);
    expect(u.searchParams.get('campaign')).toBe('didi_vip');
    expect(u.searchParams.get('srcKey')).toBe(SRC);
    expect(c.headers.get('authorization')).toBe(`Bearer ${token}`);
  });

  it('campaña fuera de alcance → 403 sin llamar a v4', async () => {
    const { calls } = mockFetch(LEADER);
    const res = await GET(authedRequest('/x'), ctx({ campaign: 'zendere' }));
    expect(res.status).toBe(403);
    expect(v4Calls(calls)).toHaveLength(0);
  });

  it('srcKey inválido → 400 sin llamar a v4', async () => {
    const { calls } = mockFetch(LEADER);
    expect((await GET(authedRequest('/x?srcKey=../etc'), ctx({ campaign: 'didi_vip' }))).status).toBe(400);
    expect(v4Calls(calls)).toHaveLength(0);
  });

  it('sin permisos de Contactos → 403', async () => {
    mockFetch({ ...LEADER, permissions: ['ana:admin:agents:manage'], isLeader: false });
    expect((await GET(authedRequest('/x'), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
  });
});

describe('/api/v4/campaigns/[campaign]/review/resolve', () => {
  it('requeue propaga items y to; el log no lleva teléfonos ni filas', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { calls } = mockFetch(LEADER, {
      [`POST ${V4}/jobs/review/resolve`]: () => Response.json({ results: [{ ...ITEM, ok: true, to: 'luis' }] }),
    });
    const res = await POST(
      authedRequest('/x', { method: 'POST', body: JSON.stringify({ action: 'requeue', items: [ITEM], to: 'luis' }) }),
      ctx({ campaign: 'didi_vip' }),
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).results[0]).toMatchObject({ ok: true, to: 'luis' });
    expect(JSON.parse(v4Calls(calls)[0]!.body!)).toEqual({ campaign: 'didi_vip', action: 'requeue', items: [ITEM], to: 'luis' });
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ evt: 'v4_review_resolve', count: 1 });
  });

  it('campaña fuera de alcance → 403 sin llamar a v4', async () => {
    const { calls } = mockFetch(LEADER);
    const res = await POST(
      authedRequest('/x', { method: 'POST', body: JSON.stringify({ action: 'discard', items: [ITEM] }) }),
      ctx({ campaign: 'zendere' }),
    );
    expect(res.status).toBe(403);
    expect(v4Calls(calls)).toHaveLength(0);
  });

  it('acción inválida, sin items o más de 100 → 400', async () => {
    mockFetch(LEADER);
    const post = (b: unknown) => POST(authedRequest('/x', { method: 'POST', body: JSON.stringify(b) }), ctx({ campaign: 'didi_vip' }));
    expect((await post({ action: 'reassign', items: [ITEM] })).status).toBe(400);
    expect((await post({ action: 'discard', items: [] })).status).toBe(400);
    expect((await post({ action: 'discard', items: Array(101).fill(ITEM) })).status).toBe(400);
    expect((await post({ action: 'discard', items: [{ operatorId: 'a' }] })).status).toBe(400);
  });
});
