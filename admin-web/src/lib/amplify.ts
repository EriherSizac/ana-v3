'use client';

import { Amplify } from 'aws-amplify';
import { CookieStorage } from 'aws-amplify/utils';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';

// Réplica de docs/sso-cognito-cookie-storage.md: tokens en cookie del apex
// común para compartir sesión con las demás apps Pernexium.

export interface CookieConfig {
  domain?: string;
  path: string;
  expires: number;
  sameSite: 'lax';
  secure: boolean;
}

/** Configuración de la cookie según entorno (exportada para pruebas). */
export function cookieConfig(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  cookieDomain: string | undefined = process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
): CookieConfig {
  const isProd = nodeEnv === 'production';
  // Un domain con punto solo funciona sobre https; en localhost hay que omitir
  // el domain y secure o la cookie se ignora en silencio.
  const useApexDomain = isProd && !!cookieDomain && cookieDomain !== 'localhost';
  return {
    ...(useApexDomain ? { domain: cookieDomain } : {}),
    path: '/',
    expires: 1, // días
    // 'lax' funciona entre subdominios same-site; 'strict' puede romper
    // navegación cross-subdominio.
    sameSite: 'lax',
    secure: isProd,
  };
}

let configured = false;

/** Idempotente. Seguro llamarla desde el provider y lazy desde helpers de auth. */
export const configureAmplify = (): void => {
  if (configured) return;
  if (typeof window === 'undefined') return;
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  if (!userPoolId || !userPoolClientId) {
    console.error('[amplify] NEXT_PUBLIC_COGNITO_USER_POOL_ID / NEXT_PUBLIC_COGNITO_CLIENT_ID missing');
    return;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
      },
    },
  });

  cognitoUserPoolsTokenProvider.setKeyValueStorage(new CookieStorage(cookieConfig()));

  configured = true;
};

/** Solo pruebas. */
export function resetAmplifyForTests(): void {
  configured = false;
}
