'use client';

import { signOut, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { configureAmplify } from './amplify';

// El inicio de sesión (contraseña, MFA, contraseña vencida) vive en el login
// central de Pernexium; aquí solo se lee la sesión compartida de la cookie.

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

/** Cierra la sesión (borra la cookie compartida del apex). */
export async function logout(): Promise<void> {
  configureAmplify();
  await signOut();
}
