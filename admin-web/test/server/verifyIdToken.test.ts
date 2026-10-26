// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getMe } from '@/app/api/me/route';
import { signToken } from '../helpers/jwt';
import { authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest } from '../helpers/server';

describe('verificación del id token en el BFF', () => {
  beforeEach(() => setupServerTest());
  afterEach(() => vi.unstubAllGlobals());

  it('token válido → procesa con el username del token', async () => {
    const { calls } = mockFetch(LEADER);
    const res = await getMe(authedRequest('/api/me', { token: signToken({ username: 'lider.didi' }) }), ctx());
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).username).toBe('lider.didi');
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['aud fuera de la allowlist', () => signToken({ aud: 'otro-client' })],
    ['access token en lugar de id token', () => signToken({ tokenUse: 'access' })],
    ['token expirado', () => signToken({ expiresIn: -60 })],
    ['emisor de otro pool', () => signToken({ issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_Otro' })],
    ['firma alterada', () => `${signToken().slice(0, -4)}AAAA`],
    ['sin header', () => ''],
  ])('%s → 401 sin llamar a ningún backend', async (_name, make) => {
    const { calls } = mockFetch(LEADER);
    const res = await getMe(authedRequest('/api/me', { token: make() }), ctx());
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toEqual({ error: { code: 'unauthenticated', message: 'Sesión inválida' } });
    expect(calls).toHaveLength(0);
  });
});
