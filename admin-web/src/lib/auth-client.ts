'use client';

import { signIn, confirmSignIn, signOut, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { configureAmplify } from './amplify';

// Patrón de v4/desktop/src/lib/auth.ts, sin el puente a Electron.

/** Resultado de un paso de login. 'done' = sesión lista; el resto pide otro paso. */
export type LoginStep =
  | { status: 'done' }
  | { status: 'totp' } // código TOTP (MFA ya configurado)
  | { status: 'sms' } // código SMS
  | { status: 'mfaSelect'; options: string[] } // elegir método MFA
  | { status: 'totpSetup'; secret?: string; uri?: string } // primera vez: enrolar TOTP
  | { status: 'newPassword' } // nueva contraseña obligatoria
  | { status: 'unsupported'; step: string }; // paso no soportado

interface NextStepLike {
  signInStep?: string;
  allowedMFATypes?: string[];
  totpSetupDetails?: { sharedSecret?: string; getSetupUri?: (appName: string, account?: string) => URL | string };
}

export function mapStep(nextStep: NextStepLike | undefined, username?: string): LoginStep {
  switch (nextStep?.signInStep) {
    case 'DONE':
      return { status: 'done' };
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
        uri: nextStep.totpSetupDetails?.getSetupUri?.('ANA Admin', username)?.toString(),
      };
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      return { status: 'newPassword' };
    default:
      // A diferencia del desktop, un paso desconocido NO se trata como completado.
      return { status: 'unsupported', step: nextStep?.signInStep ?? 'UNKNOWN' };
  }
}

/** ID token (JWT) actual o null. El BFF valida `aud`, que solo traen los id tokens. */
export async function currentIdToken(forceRefresh = false): Promise<string | null> {
  configureAmplify();
  try {
    const session = await fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined);
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

/** ¿Hay sesión viva (id token válido)? */
export async function hasSession(): Promise<boolean> {
  configureAmplify();
  try {
    await getCurrentUser();
    return (await currentIdToken()) != null;
  } catch {
    return false;
  }
}

let pendingUsername: string | undefined;

/** Login por username (NO email, design-system §11). Puede pedir pasos adicionales. */
export async function login(username: string, password: string): Promise<LoginStep> {
  configureAmplify();
  pendingUsername = username;
  const { isSignedIn, nextStep } = await signIn({ username, password });
  if (isSignedIn) return { status: 'done' };
  return finishOrCancel(mapStep(nextStep as NextStepLike, username));
}

/** Responde un challenge (código TOTP/SMS, método MFA o nueva contraseña). */
export async function confirmLogin(answer: string): Promise<LoginStep> {
  configureAmplify();
  const { isSignedIn, nextStep } = await confirmSignIn({ challengeResponse: answer });
  if (isSignedIn) return { status: 'done' };
  return finishOrCancel(mapStep(nextStep as NextStepLike, pendingUsername));
}

/** Un paso no soportado no debe dejar una sesión a medias. */
async function finishOrCancel(step: LoginStep): Promise<LoginStep> {
  if (step.status === 'unsupported') {
    try {
      await signOut();
    } catch {
      /* sin sesión que cerrar */
    }
  }
  return step;
}

/** Cierra la sesión (borra la cookie compartida del apex). */
export async function logout(): Promise<void> {
  configureAmplify();
  await signOut();
}

/** Traduce errores de Amplify/Cognito a mensajes inline en español. */
export function loginErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return 'Usuario o contraseña incorrectos';
    case 'CodeMismatchException':
      return 'Código incorrecto. Intenta de nuevo.';
    case 'ExpiredCodeException':
      return 'El código expiró. Solicita uno nuevo.';
    case 'InvalidPasswordException':
      return 'La contraseña no cumple la política del pool.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
    case 'UserAlreadyAuthenticatedException':
      return 'Ya hay una sesión iniciada.';
    case 'EnableSoftwareTokenMFAException':
      return 'No se pudo activar la app autenticadora. Revisa el código.';
    default:
      return 'No se pudo iniciar sesión. Intenta de nuevo.';
  }
}
