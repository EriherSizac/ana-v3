// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDeveloper, isDeveloperRole } from '@/lib/access';
import { resolveAccess } from '@/server/access/resolveAccess';
import { withAccess } from '@/server/access/withAccess';
import { jsonResponse } from '@/server/errors';
import { signToken } from '../helpers/jwt';
import { ADMIN, AGENT, authedRequest, bodyOf, ctx, DEVELOPER, LEADER, mockFetch, setupServerTest } from '../helpers/server';

const ok = vi.fn(async (_req: Request, _ctx: unknown) => jsonResponse({ ok: true }));
const scoped = withAccess(ok, { permission: 'ana:contacts:list:upload', campaignFrom: 'path' });

describe('resolveAccess (v4 GET /me)', () => {
  beforeEach(() => {
    setupServerTest();
    ok.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('usa el token del usuario y cachea 60 s', async () => {
    const { calls } = mockFetch(LEADER);
    const a = await resolveAccess('lider.didi', 'tok-1');
    await resolveAccess('lider.didi', 'tok-1');
    expect(a.isLeader).toBe(true);
    expect(a.isDeveloper).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer tok-1');
  });

  it('la caché expira a los 60 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { calls } = mockFetch(LEADER);
    await resolveAccess('u', 't');
    vi.setSystemTime(Date.now() + 61_000);
    await resolveAccess('u', 't');
    expect(calls).toHaveLength(2);
  });

  it('v4 5xx → 503 access_unavailable y no se cachea el error', async () => {
    let fail = true;
    const { calls } = mockFetch(() => (fail ? new Response('boom', { status: 502 }) : Response.json({ access: LEADER })));
    const res = await scoped(authedRequest('/api/x'), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(503);
    expect(await bodyOf(res)).toEqual({
      error: { code: 'access_unavailable', message: 'No se pudo verificar tu acceso. Intenta de nuevo.' },
    });
    expect(ok).not.toHaveBeenCalled();
    fail = false;
    const res2 = await scoped(authedRequest('/api/x'), ctx({ campaign: 'didi_vip' }));
    expect(res2.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('timeout de v4 → 503', async () => {
    mockFetch(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    await expect(resolveAccess('u', 't')).rejects.toMatchObject({ code: 'access_unavailable' });
  });

  it.each(['Developer', 'developer', 'Developér', 'Senior DEVELOPER Team'])('detecta rol Developer: %s', (r) => {
    expect(isDeveloperRole(r)).toBe(true);
  });

  it('sin rol Developer → false', () => {
    expect(isDeveloper(['Líder Didi', 'Agente Zendere'])).toBe(false);
  });
});

describe('withAccess', () => {
  beforeEach(() => {
    setupServerTest();
    ok.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('campaña ajena → 403 "Campaña no permitida" sin llamar al handler', async () => {
    mockFetch(LEADER);
    const res = await scoped(authedRequest('/api/x'), ctx({ campaign: 'zendere' }));
    expect(res.status).toBe(403);
    expect(await bodyOf(res)).toEqual({ error: { code: 'forbidden', message: 'Campaña no permitida' } });
    expect(ok).not.toHaveBeenCalled();
  });

  it('campaña propia con mayúsculas se normaliza y pasa', async () => {
    mockFetch(LEADER);
    const res = await scoped(authedRequest('/api/x'), ctx({ campaign: ' DIDI_VIP ' }));
    expect(res.status).toBe(200);
    expect(ok.mock.calls[0]![1]).toMatchObject({ campaign: 'didi_vip' });
  });

  it('admin pasa en cualquier campaña', async () => {
    mockFetch(ADMIN);
    const res = await scoped(authedRequest('/api/x'), ctx({ campaign: 'zendere' }));
    expect(res.status).toBe(200);
  });

  it('`*` en campaigns pasa', async () => {
    mockFetch({ ...LEADER, campaigns: ['*'] });
    const res = await scoped(authedRequest('/api/x'), ctx({ campaign: 'zendere' }));
    expect(res.status).toBe(200);
  });

  it('agente sin permisos de entrada → 403', async () => {
    mockFetch(AGENT);
    const res = await scoped(authedRequest('/api/x', { token: signToken({ username: 'agente.1' }) }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.code).toBe('forbidden');
  });

  it('Developer entra pero no obtiene permisos ana:* por el rol', async () => {
    mockFetch(DEVELOPER);
    const res = await scoped(authedRequest('/api/x'), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(403);
    const devOnly = withAccess(ok, { permission: (a) => a.isDeveloper });
    expect((await devOnly(authedRequest('/api/y'), ctx())).status).toBe(200);
  });

  it('campaña inválida → 400', async () => {
    mockFetch(ADMIN);
    const res = await scoped(authedRequest('/api/x'), ctx({ campaign: '../etc' }));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.code).toBe('invalid_request');
  });
});
