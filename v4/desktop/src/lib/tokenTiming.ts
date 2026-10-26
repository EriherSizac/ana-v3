// File: Cálculo puro del momento de renovación del ID token (renderer).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/** Renovar este tiempo antes de que expire el ID token. */
export const RENEW_BEFORE_MS = 5 * 60 * 1000;
/** Reintento tras un fallo transitorio (red) al renovar. */
export const RENEW_RETRY_MS = 30 * 1000;

/** `exp` del JWT en epoch ms, o null si no se puede leer (sin verificar firma). */
export function jwtExpMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * ms a esperar antes de renovar: `exp − 5 min − ahora`, nunca negativo.
 * null si el token no trae `exp` (no se programa renovación).
 */
export function renewDelayMs(token: string, now: number = Date.now()): number | null {
  const exp = jwtExpMs(token);
  if (exp == null) return null;
  return Math.max(0, exp - RENEW_BEFORE_MS - now);
}
