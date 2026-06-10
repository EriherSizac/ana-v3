// File: Token de acceso actual (JWT) o null.
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import {
  signIn,
  confirmSignIn,
  signOut,
  fetchAuthSession,
  getCurrentUser,
} from 'aws-amplify/auth';

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
  await signOut();
  await window.ana.setAuthToken(null);
}

/** Empuja el token al main process (poller + backend lo usan). */
export async function pushTokenToMain(): Promise<void> {
  const token = await currentToken();
  await window.ana.setAuthToken(token);
}
