import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn();
const fetchAuthSession = vi.fn();
const getCurrentUser = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  signOut: (...a: unknown[]) => signOut(...a),
  fetchAuthSession: (...a: unknown[]) => fetchAuthSession(...a),
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
}));
vi.mock('@/lib/amplify', () => ({ configureAmplify: () => {} }));

import * as authClient from '@/lib/auth-client';
import { currentIdToken, hasSession, logout } from '@/lib/auth-client';

describe('auth-client', () => {
  beforeEach(() => {
    for (const f of [signOut, fetchAuthSession, getCurrentUser]) f.mockReset();
  });

  it('no inicia sesión por su cuenta: eso es del login central', () => {
    expect(Object.keys(authClient).sort()).toEqual(['currentIdToken', 'hasSession', 'logout']);
  });

  it('currentIdToken / hasSession', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: { idToken: { toString: () => 'jwt' } } });
    getCurrentUser.mockResolvedValue({ username: 'u' });
    expect(await currentIdToken()).toBe('jwt');
    expect(await hasSession()).toBe(true);
    await currentIdToken(true);
    expect(fetchAuthSession).toHaveBeenLastCalledWith({ forceRefresh: true });
    getCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));
    expect(await hasSession()).toBe(false);
    fetchAuthSession.mockResolvedValue({ tokens: undefined });
    expect(await currentIdToken()).toBeNull();
  });

  it('logout cierra la sesión', async () => {
    signOut.mockResolvedValue(undefined);
    await logout();
    expect(signOut).toHaveBeenCalled();
  });
});
