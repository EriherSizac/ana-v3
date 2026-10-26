import { beforeEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();
const confirmSignIn = vi.fn();
const signOut = vi.fn();
const fetchAuthSession = vi.fn();
const getCurrentUser = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  signIn: (...a: unknown[]) => signIn(...a),
  confirmSignIn: (...a: unknown[]) => confirmSignIn(...a),
  signOut: (...a: unknown[]) => signOut(...a),
  fetchAuthSession: (...a: unknown[]) => fetchAuthSession(...a),
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
}));
vi.mock('@/lib/amplify', () => ({ configureAmplify: () => {} }));

import { confirmLogin, currentIdToken, hasSession, login, loginErrorMessage, logout } from '@/lib/auth-client';

const step = (signInStep: string, extra: Record<string, unknown> = {}) => ({
  isSignedIn: false,
  nextStep: { signInStep, ...extra },
});

describe('auth-client', () => {
  beforeEach(() => {
    for (const f of [signIn, confirmSignIn, signOut, fetchAuthSession, getCurrentUser]) f.mockReset();
  });

  it('login por username tal cual', async () => {
    signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    expect(await login('erick.silva', 'pw')).toEqual({ status: 'done' });
    expect(signIn).toHaveBeenCalledWith({ username: 'erick.silva', password: 'pw' });
  });

  it.each([
    ['CONFIRM_SIGN_IN_WITH_TOTP_CODE', {}, { status: 'totp' }],
    ['CONFIRM_SIGN_IN_WITH_SMS_CODE', {}, { status: 'sms' }],
    ['CONTINUE_SIGN_IN_WITH_MFA_SELECTION', { allowedMFATypes: ['TOTP', 'SMS'] }, { status: 'mfaSelect', options: ['TOTP', 'SMS'] }],
    ['CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED', {}, { status: 'newPassword' }],
  ])('mapea %s', async (name, extra, expected) => {
    signIn.mockResolvedValue(step(name, extra));
    expect(await login('u', 'p')).toEqual(expected);
  });

  it('alta de TOTP muestra secreto y URI', async () => {
    signIn.mockResolvedValue(
      step('CONTINUE_SIGN_IN_WITH_TOTP_SETUP', {
        totpSetupDetails: { sharedSecret: 'SECRETO', getSetupUri: (app: string, acc: string) => new URL(`otpauth://totp/${app}:${acc}?secret=SECRETO`) },
      }),
    );
    const s = await login('erick.silva', 'p');
    expect(s).toMatchObject({ status: 'totpSetup', secret: 'SECRETO' });
    expect((s as { uri: string }).uri).toContain('secret=SECRETO');
  });

  it('paso no soportado → unsupported y cierra la sesión a medias', async () => {
    signIn.mockResolvedValue(step('CONFIRM_SIGN_UP'));
    expect(await login('u', 'p')).toEqual({ status: 'unsupported', step: 'CONFIRM_SIGN_UP' });
    expect(signOut).toHaveBeenCalled();
  });

  it('confirmLogin envía el challengeResponse', async () => {
    confirmSignIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    expect(await confirmLogin('123456')).toEqual({ status: 'done' });
    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: '123456' });
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

  it('mensajes de error en español', () => {
    expect(loginErrorMessage({ name: 'NotAuthorizedException' })).toBe('Usuario o contraseña incorrectos');
    expect(loginErrorMessage({ name: 'CodeMismatchException' })).toMatch(/Código incorrecto/);
  });
});
