import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-client', () => ({ currentIdToken: vi.fn() }));

import { ApiError, apiFetch, setApiDepsForTests } from '@/lib/api-client';
import { safeNext } from '@/lib/safe-next';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('api-client', () => {
  afterEach(() => setApiDepsForTests(null));

  it('envía Authorization con el id token', async () => {
    const fetchImpl = vi.fn(async () => json(200, { ok: 1 }));
    setApiDepsForTests({ getToken: async () => 'tok', fetchImpl: fetchImpl as never, redirect: vi.fn(), currentPath: () => '/' });
    expect(await apiFetch('/api/me')).toEqual({ ok: 1 });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
  });

  it('401 con refresh válido → renueva, reintenta una vez y no hay error', async () => {
    const getToken = vi.fn(async (force?: boolean) => (force ? 'nuevo' : 'viejo'));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'unauthenticated', message: 'Sesión inválida' } }))
      .mockResolvedValueOnce(json(200, { ok: 2 }));
    const redirect = vi.fn();
    setApiDepsForTests({ getToken, fetchImpl, redirect, currentPath: () => '/agentes' });
    expect(await apiFetch('/api/x')).toEqual({ ok: 2 });
    expect(getToken).toHaveBeenCalledWith(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new Headers((fetchImpl.mock.calls[1] as [string, RequestInit])[1].headers).get('authorization')).toBe('Bearer nuevo');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('401 tras reintentar → redirige a /login?next=<ruta actual>', async () => {
    const fetchImpl = vi.fn(async () => json(401, {}));
    const redirect = vi.fn();
    setApiDepsForTests({ getToken: async () => 't', fetchImpl: fetchImpl as never, redirect, currentPath: () => '/agentes?c=1' });
    await expect(apiFetch('/api/x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(redirect).toHaveBeenCalledWith('/login?next=%2Fagentes%3Fc%3D1');
  });

  it('sin sesión renovable → redirige sin llamar al BFF', async () => {
    const fetchImpl = vi.fn();
    const redirect = vi.fn();
    setApiDepsForTests({ getToken: async () => null, fetchImpl, redirect, currentPath: () => '/agentes' });
    await expect(apiFetch('/api/x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/login?next=%2Fagentes');
  });

  it('errores uniformes → ApiError con code y message', async () => {
    setApiDepsForTests({
      getToken: async () => 't',
      fetchImpl: (async () => json(403, { error: { code: 'forbidden', message: 'Campaña no permitida' } })) as never,
      redirect: vi.fn(),
      currentPath: () => '/',
    });
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 403, code: 'forbidden', message: 'Campaña no permitida' });
  });
});

describe('safeNext', () => {
  it.each([
    ['/agentes', '/agentes'],
    ['%2Fagentes%3Fc%3D1', '/agentes?c=1'],
    ['https://ejemplo.com', '/'],
    ['//ejemplo.com', '/'],
    ['/\\ejemplo.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/login', '/'],
    [null, '/'],
    ['/%09/ejemplo.com', '/'],
  ])('%s → %s', (input, out) => {
    expect(safeNext(input)).toBe(out);
  });
});
