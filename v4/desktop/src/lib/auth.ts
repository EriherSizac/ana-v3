// File: Sesión de Amplify en el renderer y entrega/renovación del ID token al main.
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import {
  signIn,
  confirmSignIn,
  signOut,
  fetchAuthSession,
  getCurrentUser,
} from 'aws-amplify/auth';
import { renewDelayMs, RENEW_RETRY_MS } from './tokenTiming';

/**
 * ID token (JWT) actual o null. Se usa el ID token (no el access token) porque
 * el authorizer JWT de API Gateway valida el claim `aud`, que solo traen los
 * id tokens de Cognito; los access tokens llevan `client_id`, no `aud`.
 * El id token además trae `cognito:username` que el backend usa como operatorId.
 */
export async function currentToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

/** ¿Hay sesión viva? */
export async function hasSession(): Promise<boolean> {
  try {
    await getCurrentUser();
    return (await currentToken()) != null;
  } catch {
    return false;
  }
}

// Resultado de un paso de login. 'done' = sesión lista; el resto pide otro paso.
export type LoginStep =
  | { status: 'done' }
  | { status: 'totp' } // pide código TOTP (MFA ya configurado)
  | { status: 'sms' } // pide código SMS
  | { status: 'mfaSelect'; options: string[] } // elegir método MFA
  | { status: 'totpSetup'; secret?: string; uri?: string } // primera vez: enrolar TOTP
  | { status: 'newPassword' }; // forzar cambio de contraseña

function mapStep(nextStep: any): LoginStep {
  switch (nextStep?.signInStep) {
    case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
      return { status: 'totp' };
    case 'CONFIRM_SIGN_IN_WITH_SMS_CODE':
      return { status: 'sms' };
    case 'CONTINUE_SIGN_IN_WITH_MFA_SELECTION':
      return { status: 'mfaSelect', options: nextStep.allowedMFATypes ?? ['TOTP'] };
    case 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP':
      return {
        status: 'totpSetup',
        secret: nextStep.totpSetupDetails?.sharedSecret,
        uri: nextStep.totpSetupDetails?.getSetupUri?.('ana')?.toString(),
      };
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      return { status: 'newPassword' };
    default:
      return { status: 'done' }; // DONE u otro → tratamos como completado
  }
}

/** Login por username (NO email — regla design-system). Puede pedir MFA. */
export async function login(username: string, password: string): Promise<LoginStep> {
  const { isSignedIn, nextStep } = await signIn({ username, password });
  if (isSignedIn) {
    await pushTokenToMain();
    return { status: 'done' };
  }
  return mapStep(nextStep);
}

/** Responde un challenge (código TOTP/SMS, nueva contraseña, o método MFA). */
export async function confirmLogin(answer: string): Promise<LoginStep> {
  const { isSignedIn, nextStep } = await confirmSignIn({ challengeResponse: answer });
  if (isSignedIn) {
    await pushTokenToMain();
    return { status: 'done' };
  }
  return mapStep(nextStep);
}

export async function logout(): Promise<void> {
  stopRenewal();
  await signOut();
  await window.ana.setAuthToken(null);
}

/** Empuja el token al main process (poller + backend lo usan) y programa su renovación. */
export async function pushTokenToMain(): Promise<void> {
  const token = await currentToken();
  await window.ana.setAuthToken(token);
  if (token) scheduleRenewal(token);
}

// ---- Renovación del ID token ----
// El renderer es el dueño de la renovación (el main no tiene Amplify ni el
// refresh token): 5 min antes de `exp` fuerza `fetchAuthSession` y re-entrega
// el token. El main también puede pedirlo (`onTokenRequest`) si recibe un 401.

export const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró. Vuelve a iniciar sesión.';

let renewTimer: ReturnType<typeof setTimeout> | null = null;
let renewing: Promise<string | null> | null = null;
const expiredListeners = new Set<() => void>();

function stopRenewal() {
  if (renewTimer) clearTimeout(renewTimer);
  renewTimer = null;
}

function scheduleRenewal(token: string) {
  stopRenewal();
  const delay = renewDelayMs(token);
  if (delay == null) return;
  renewTimer = setTimeout(() => void renewToken(), delay);
}

/** Se suscribe a la expiración de la sesión (la app vuelve al login con aviso). */
export function onSessionExpired(cb: () => void): () => void {
  expiredListeners.add(cb);
  return () => expiredListeners.delete(cb);
}

const isAuthRejection = (e: any) =>
  /NotAuthorized|UserUnAuthenticated|RefreshToken|TokenRevoked/i.test(`${e?.name ?? ''} ${e?.message ?? ''}`);

async function expireSession() {
  stopRenewal();
  await window.ana.setAuthToken(null, { reason: 'expired' });
  expiredListeners.forEach((cb) => cb());
}

/**
 * Fuerza la renovación y re-entrega el token al main. Sin tokens o con el
 * refresh token rechazado → sesión expirada. Error transitorio (red) → reintenta
 * en 30 s y devuelve null (el main sigue con el token anterior).
 */
export function renewToken(): Promise<string | null> {
  if (renewing) return renewing;
  renewing = (async () => {
    try {
      const session = await fetchAuthSession({ forceRefresh: true });
      const token = session.tokens?.idToken?.toString() ?? null;
      if (!token) {
        await expireSession();
        return null;
      }
      await window.ana.setAuthToken(token);
      scheduleRenewal(token);
      return token;
    } catch (e) {
      if (isAuthRejection(e)) {
        await expireSession();
        return null;
      }
      console.warn('[auth] renovación falló (transitorio), reintento en 30 s', e);
      stopRenewal();
      renewTimer = setTimeout(() => void renewToken(), RENEW_RETRY_MS);
      return null;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

let bridgeInstalled = false;
/** Responde las solicitudes de token del main. Llamar una vez al montar la app. */
export function installTokenBridge(): void {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  window.ana.onTokenRequest(() => {
    void renewToken().then((t) => window.ana.provideToken(t));
  });
}
