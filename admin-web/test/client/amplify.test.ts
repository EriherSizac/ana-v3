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

  it('producción: domain del entorno y secure', async () => {
    const { cookieConfig } = await import('@/lib/amplify');
    expect(cookieConfig('production', '.pernexium.com.mx')).toEqual({
      domain: '.pernexium.com.mx',
      path: '/',
      expires: 1,
      sameSite: 'lax',
      secure: true,
    });
  });

  it('desarrollo: sin domain y sin secure', async () => {
    const { cookieConfig } = await import('@/lib/amplify');
    expect(cookieConfig('development', '.pernexium.com.mx')).toEqual({ path: '/', expires: 1, sameSite: 'lax', secure: false });
    expect(cookieConfig('production', 'localhost')).not.toHaveProperty('domain');
  });

  it('configureAmplify registra CookieStorage (no localStorage) con el pool del entorno, una sola vez', async () => {
    vi.stubEnv('NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'us-east-2_UepfOyKpd');
    vi.stubEnv('NEXT_PUBLIC_COGNITO_CLIENT_ID', '1r6niimhkl2fmias6kk85n4ou4');
    vi.stubEnv('NEXT_PUBLIC_COOKIE_DOMAIN', '.pernexium.com.mx');
    vi.stubEnv('NODE_ENV', 'production');
    const { configureAmplify } = await import('@/lib/amplify');
    configureAmplify();
    configureAmplify();
    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledWith({
      Auth: { Cognito: { userPoolId: 'us-east-2_UepfOyKpd', userPoolClientId: '1r6niimhkl2fmias6kk85n4ou4' } },
    });
    expect(setKeyValueStorage).toHaveBeenCalledTimes(1);
    expect(cookieCtor).toHaveBeenCalledWith(expect.objectContaining({ domain: '.pernexium.com.mx', secure: true }));
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
