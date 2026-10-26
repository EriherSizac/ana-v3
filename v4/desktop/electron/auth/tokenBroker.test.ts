import { describe, it, expect, vi, afterEach } from 'vitest';
import { TokenBroker, createAuthFetch, NoSessionError, jwtExpMs } from './tokenBroker';

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: Record<string, unknown>) => `${b64u({ alg: 'none' })}.${b64u(claims)}.sig`;

const NOW = 1_800_000_000_000;
const tokenExpiringIn = (ms: number, extra: Record<string, unknown> = {}) =>
  jwt({ exp: Math.floor((NOW + ms) / 1000), ...extra });

afterEach(() => vi.useRealTimers());

describe('jwtExpMs', () => {
  it('lee exp en ms', () => expect(jwtExpMs(jwt({ exp: 100 }))).toBe(100_000));
  it('null si no es JWT', () => expect(jwtExpMs('basura')).toBeNull());
});

describe('TokenBroker', () => {
  it('token vigente: lo devuelve sin pedir uno', async () => {
    const request = vi.fn();
    const b = new TokenBroker({ request, now: () => NOW });
    const t = tokenExpiringIn(30 * 60_000);
    b.setToken(t);
    expect(await b.getFreshToken()).toBe(t);
    expect(request).not.toHaveBeenCalled();
  });

  it('token por vencer (90 s): pide uno y usa el nuevo', async () => {
    const fresh = tokenExpiringIn(60 * 60_000, { v: 2 });
    const b: TokenBroker = new TokenBroker({ request: () => b.provide(fresh), now: () => NOW });
    b.setToken(tokenExpiringIn(90_000));
    expect(await b.getFreshToken()).toBe(fresh);
    expect(b.getToken()).toBe(fresh);
  });

  it('solicitudes concurrentes comparten la misma promesa', async () => {
    const request = vi.fn();
    const b = new TokenBroker({ request, now: () => NOW });
    b.setToken(tokenExpiringIn(60_000));
    const p1 = b.getFreshToken();
    const p2 = b.getFreshToken();
    expect(request).toHaveBeenCalledTimes(1);
    const fresh = tokenExpiringIn(3600_000, { v: 3 });
    b.provide(fresh);
    expect(await p1).toBe(fresh);
    expect(await p2).toBe(fresh);
  });

  it('timeout: devuelve el token anterior', async () => {
    vi.useFakeTimers();
    const b = new TokenBroker({ request: () => {}, now: () => NOW, timeoutMs: 10_000 });
    const old = tokenExpiringIn(60_000);
    b.setToken(old);
    const p = b.getFreshToken();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toBe(old);
  });

  it('provide(null) resuelve con el token anterior', async () => {
    const b = new TokenBroker({ request: () => {}, now: () => NOW });
    const old = tokenExpiringIn(60_000);
    b.setToken(old);
    const p = b.getFreshToken();
    b.provide(null);
    expect(await p).toBe(old);
  });

  it('invalidate() fuerza una solicitud aunque el token no venza', async () => {
    const request = vi.fn();
    const b = new TokenBroker({ request, now: () => NOW });
    b.setToken(tokenExpiringIn(3600_000));
    b.invalidate();
    void b.getFreshToken();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('sin sesión: null sin pedir nada', async () => {
    const request = vi.fn();
    const b = new TokenBroker({ request });
    expect(await b.getFreshToken()).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('createAuthFetch', () => {
  const resp = (status: number) => new Response('{}', { status });

  it('pone el header Authorization', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => resp(200));
    const af = createAuthFetch({ getFreshToken: async () => 'T1', invalidate: () => {} }, f as any);
    await af('u', { method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(f.mock.calls[0][1]?.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer T1',
    });
  });

  it('401 → invalidate + 1 reintento con token nuevo', async () => {
    const tokens = ['T1', 'T2'];
    const invalidate = vi.fn();
    const f = vi.fn().mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(200));
    const af = createAuthFetch({ getFreshToken: async () => tokens.shift()!, invalidate }, f as any);
    const r = await af('u');
    expect(r.status).toBe(200);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[1] as any)[1].headers.authorization).toBe('Bearer T2');
  });

  it('segundo 401 → se devuelve el error, sin más reintentos', async () => {
    const f = vi.fn(async () => resp(401));
    const af = createAuthFetch({ getFreshToken: async () => 'T', invalidate: () => {} }, f as any);
    const r = await af('u');
    expect(r.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('sin token → NoSessionError sin llamar fetch', async () => {
    const f = vi.fn();
    const af = createAuthFetch({ getFreshToken: async () => null, invalidate: () => {} }, f as any);
    await expect(af('u')).rejects.toBeInstanceOf(NoSessionError);
    expect(f).not.toHaveBeenCalled();
  });
});
