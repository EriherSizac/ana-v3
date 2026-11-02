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

/** Apex del SSO de Pernexium: lo comparte el login central (login.pernexium.com.mx). */
export const APEX = 'pernexium.com.mx';

/**
 * Configuración de la cookie según el host (exportada para pruebas). Igual que
 * el login central: el domain del apex solo dentro del apex y sobre https; en
 * localhost o previews (*.amplifyapp.com) la cookie es host-only o se ignora
 * en silencio.
 */
export function cookieConfig(
  hostname: string = window.location.hostname,
  protocol: string = window.location.protocol,
): CookieConfig {
  const https = protocol === 'https:';
  const inApex = hostname === APEX || hostname.endsWith(`.${APEX}`);
  return {
    ...(inApex && https ? { domain: `.${APEX}` } : {}),
    path: '/',
    expires: 30, // días, igual que el login central
    // 'lax' funciona entre subdominios same-site; 'strict' puede romper
    // navegación cross-subdominio.
    sameSite: 'lax',
    secure: https,
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
