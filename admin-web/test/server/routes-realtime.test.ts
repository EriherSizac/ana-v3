// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/realtime/refresh/route';
import { signToken } from '../helpers/jwt';
import { ADMIN, authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V4 } from '../helpers/server';

beforeEach(() => {
  setupServerTest();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const upstream = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith(V4) && !c.url.endsWith('/me'));
const post = (body: unknown, token?: string) =>
  POST(authedRequest('/api/realtime/refresh', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), ...(token ? { token } : {}) }), ctx());

describe('POST /api/realtime/refresh', () => {
  it('admin: reenvía el alcance a v4 con su token y responde 202', async () => {
    const token = signToken();
    const { calls } = mockFetch(ADMIN, {
      [`POST ${V4}/admin/realtime/refresh`]: () => Response.json({ ok: true, scope: 'user', target: 'jperez' }, { status: 202 }),
    });
    const res = await post({ scope: 'user', username: ' jperez ' }, token);
    expect(res.status).toBe(202);
    expect(await bodyOf(res)).toEqual({ ok: true, scope: 'user', target: 'jperez' });
    const call = upstream(calls)[0] as any;
    expect(JSON.parse(call.body)).toEqual({ scope: 'user', username: 'jperez' });
    expect(call.headers.get('authorization')).toBe(`Bearer ${token}`);
  });

  it('campaña y todos', async () => {
    const { calls } = mockFetch(ADMIN, { [`POST ${V4}/admin/realtime/refresh`]: () => Response.json({ ok: true }, { status: 202 }) });
    expect((await post({ scope: 'campaign', campaign: 'prueba' })).status).toBe(202);
    expect((await post({ scope: 'all' })).status).toBe(202);
    expect(upstream(calls).map((c: any) => JSON.parse(c.body))).toEqual([{ scope: 'campaign', campaign: 'prueba' }, { scope: 'all' }]);
  });

  it('sin ana:admin:console:manage → 403 sin llamar a v4', async () => {
    const { calls } = mockFetch(LEADER);
    expect((await post({ scope: 'all' })).status).toBe(403);
    expect(upstream(calls)).toHaveLength(0);
  });

  it('alcance inválido o sin destino → 400 sin llamar a v4', async () => {
    const { calls } = mockFetch(ADMIN);
    for (const b of [{ scope: 'user' }, { scope: 'campaign', campaign: '*' }, { scope: 'x' }, '{no json']) {
      expect((await post(b)).status).toBe(400);
    }
    expect(upstream(calls)).toHaveLength(0);
  });
});
