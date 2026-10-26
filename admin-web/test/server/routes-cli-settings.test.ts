// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/cli-settings/route';
import { signToken } from '../helpers/jwt';
import { ADMIN, authedRequest, bodyOf, ctx, DEVELOPER, mockFetch, setupServerTest, V3 } from '../helpers/server';

const VIEW = {
  settings: { noWhatsappConsultRegistration: false },
  catalog: [{ key: 'noWhatsappConsultRegistration', type: 'boolean', default: false, description: 'd' }],
  updatedAt: null,
  updatedBy: null,
};

beforeEach(() => setupServerTest());
afterEach(() => vi.unstubAllGlobals());

describe('/api/cli-settings', () => {
  it('admin sin Developer → 403 sin llamar a v3', async () => {
    const { calls } = mockFetch(ADMIN);
    const res = await GET(authedRequest('/api/cli-settings'), ctx());
    expect(res.status).toBe(403);
    const res2 = await POST(authedRequest('/api/cli-settings', { method: 'POST', body: JSON.stringify({ settings: { noWhatsappConsultRegistration: true } }) }), ctx());
    expect(res2.status).toBe(403);
    expect(calls.filter((c) => c.url.startsWith(V3))).toHaveLength(0);
  });

  it('Developer → 200 con el token del usuario y sin llaves', async () => {
    const token = signToken({ username: 'erick.silva' });
    const { calls } = mockFetch(DEVELOPER, { [`GET ${V3}/admin/cli-settings`]: () => Response.json({ success: true, data: VIEW }) });
    const res = await GET(authedRequest('/api/cli-settings', { token }), ctx());
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual(VIEW);
    const c = calls.find((x) => x.url.startsWith(V3))!;
    expect(c.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(c.headers.get('x-admin-key')).toBeNull();
  });

  it('POST envía solo la llave cambiada y propaga el 409 uniforme', async () => {
    const { calls } = mockFetch(DEVELOPER, {
      [`POST ${V3}/admin/cli-settings`]: () => Response.json({ success: false, message: 'La configuración cambió, intenta de nuevo' }, { status: 409 }),
    });
    const res = await POST(authedRequest('/api/cli-settings', { method: 'POST', body: JSON.stringify({ settings: { noWhatsappConsultRegistration: true } }) }), ctx());
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error).toEqual({ code: 'conflict', message: 'La configuración cambió; recarga para ver el valor actual' });
    expect(JSON.parse(calls.find((x) => x.url.startsWith(V3))!.body!)).toEqual({ settings: { noWhatsappConsultRegistration: true } });
  });

  it('POST 400 de v3 se traduce con su mensaje', async () => {
    mockFetch(DEVELOPER, { [`POST ${V3}/admin/cli-settings`]: () => Response.json({ success: false, message: 'Configuración desconocida: modoTurbo' }, { status: 400 }) });
    const res = await POST(authedRequest('/api/cli-settings', { method: 'POST', body: JSON.stringify({ settings: { modoTurbo: true } }) }), ctx());
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.message).toBe('Configuración desconocida: modoTurbo');
  });
});
