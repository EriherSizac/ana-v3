import { beforeEach, describe, expect, it, vi } from 'vitest';

const configure = vi.fn();
const setKeyValueStorage = vi.fn();
const cookieCtor = vi.fn();

vi.mock('aws-amplify', () => ({ Amplify: { configure: (...a: unknown[]) => configure(...a) } }));
vi.mock('aws-amplify/auth/cognito', () => ({
  cognitoUserPoolsTokenProvider: { setKeyValueStorage: (...a: unknown[]) => setKeyValueStorage(...a) },
}));
vi.mock('aws-amplify/utils', () => ({
  CookieStorage: class {
    constructor(public cfg: unknown) {
      cookieCtor(cfg);
    }
  },
}));

describe('SSO por cookie (lib/amplify)', () => {
  beforeEach(() => {
    vi.resetModules();
    configure.mockClear();
    setKeyValueStorage.mockClear();
    cookieCtor.mockClear();
    vi.unstubAllEnvs();
  });

  it('apex por https: domain del apex, secure y 30 días', async () => {
    const { cookieConfig } = await import('@/lib/amplify');
    expect(cookieConfig('ana-admin.pernexium.com.mx', 'https:')).toEqual({
      domain: '.pernexium.com.mx',
      path: '/',
      expires: 30,
      sameSite: 'lax',
      secure: true,
    });
    expect(cookieConfig('pernexium.com.mx', 'https:')).toHaveProperty('domain', '.pernexium.com.mx');
  });

  it('localhost: sin domain y sin secure', async () => {
    const { cookieConfig } = await import('@/lib/amplify');
    expect(cookieConfig('localhost', 'http:')).toEqual({ path: '/', expires: 30, sameSite: 'lax', secure: false });
  });

  it('fuera del apex o sin https: nunca el domain del apex', async () => {
    const { cookieConfig } = await import('@/lib/amplify');
    expect(cookieConfig('main.d1abc.amplifyapp.com', 'https:')).toEqual({ path: '/', expires: 30, sameSite: 'lax', secure: true });
    expect(cookieConfig('ana-admin.pernexium.com.mx', 'http:')).not.toHaveProperty('domain');
    expect(cookieConfig('evilpernexium.com.mx', 'https:')).not.toHaveProperty('domain');
  });

  it('configureAmplify registra CookieStorage (no localStorage) con el pool del entorno, una sola vez', async () => {
    vi.stubEnv('NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'us-east-2_UepfOyKpd');
    vi.stubEnv('NEXT_PUBLIC_COGNITO_CLIENT_ID', '1r6niimhkl2fmias6kk85n4ou4');
    const { configureAmplify } = await import('@/lib/amplify');
    configureAmplify();
    configureAmplify();
    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledWith({
      Auth: { Cognito: { userPoolId: 'us-east-2_UepfOyKpd', userPoolClientId: '1r6niimhkl2fmias6kk85n4ou4' } },
    });
    expect(setKeyValueStorage).toHaveBeenCalledTimes(1);
    // jsdom corre en http://localhost: cookie host-only, decidida por el host real.
    expect(cookieCtor).toHaveBeenCalledWith({ path: '/', expires: 30, sameSite: 'lax', secure: false });
  });

  it('sin variables no configura', async () => {
    vi.stubEnv('NEXT_PUBLIC_COGNITO_USER_POOL_ID', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { configureAmplify } = await import('@/lib/amplify');
    configureAmplify();
    expect(configure).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
