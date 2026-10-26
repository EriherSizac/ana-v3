// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PUT } from '@/app/api/v4/desktop-settings/route';
import { signToken } from '../helpers/jwt';
import { ADMIN, authedRequest, bodyOf, ctx, DEVELOPER, LEADER, mockFetch, setupServerTest, V4 } from '../helpers/server';

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const upstream = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith(V4) && !c.url.endsWith('/me'));

describe('/api/v4/desktop-settings', () => {
  it('GET de Developer propaga el id token a v4', async () => {
    const token = signToken();
    const { calls } = mockFetch(DEVELOPER, {
      [`GET ${V4}/admin/desktop-settings`]: () => Response.json({ version: 0, settings: [] }),
    });
    const res = await GET(authedRequest('/x', { token }), ctx());
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ version: 0, settings: [] });
    expect((upstream(calls)[0] as any).headers.get('authorization')).toBe(`Bearer ${token}`);
  });

  it('no Developer (admin o líder) → 403 sin llamar a v4', async () => {
    for (const me of [ADMIN, LEADER]) {
      const { calls } = mockFetch(me);
      expect((await GET(authedRequest('/x'), ctx())).status).toBe(403);
      expect((await PUT(authedRequest('/x', { method: 'PUT', body: JSON.stringify({ version: 0, values: { sendMaxPerWindow: 5 } }) }), ctx())).status).toBe(403);
      expect(upstream(calls)).toHaveLength(0);
    }
  });

  it('PUT propaga {version, values} y traduce 409', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { calls } = mockFetch(DEVELOPER, {
      [`PUT ${V4}/admin/desktop-settings`]: () => Response.json({ error: 'la configuración cambió' }, { status: 409 }),
    });
    const res = await PUT(authedRequest('/x', { method: 'PUT', body: JSON.stringify({ version: 3, values: { sendMinGapSeconds: 180 } }) }), ctx());
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error.message).toBe('La configuración cambió; recarga para ver el valor actual');
    expect(JSON.parse((upstream(calls)[0] as any).body)).toEqual({ version: 3, values: { sendMinGapSeconds: 180 } });
  });

  it('PUT inválido → 400 sin llamar a v4', async () => {
    const { calls } = mockFetch(DEVELOPER);
    expect((await PUT(authedRequest('/x', { method: 'PUT', body: JSON.stringify({ values: {} }) }), ctx())).status).toBe(400);
    expect(upstream(calls)).toHaveLength(0);
  });
});
