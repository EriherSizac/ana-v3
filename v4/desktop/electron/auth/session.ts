// File: Decisiones puras del ciclo de sesión en el main (token y heartbeat).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/** operatorId canónico (v4-canonical-identity-keys D1): sin espacios laterales y en minúsculas. */
export const canonicalOperatorId = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toLowerCase() : '';

/** operatorId canónico del id token (cognito:username o sub), sin verificar firma. */
export function usernameFromJwt(token: string): string {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(part, 'base64').toString('utf-8'));
    return canonicalOperatorId(payload['cognito:username'] ?? payload.sub) || 'ana';
  } catch {
    return 'ana';
  }
}

export type SetTokenReason = 'expired';

export type SetTokenAction =
  /** Mismo operador con sesión activa: solo reemplazar el token. */
  | { kind: 'refresh'; operator: string }
  /** Entrada de un operador: configurar WhatsApp y arrancar el poller;
   *  `wipeLocal` si la sesión local de WhatsApp es de OTRO operador. */
  | { kind: 'login'; operator: string; wipeLocal: boolean }
  /** No se pudo renovar: detener poller/heartbeat SIN borrar WhatsApp local. */
  | { kind: 'expired' }
  /** Logout explícito: detener todo y borrar la sesión local de WhatsApp. */
  | { kind: 'logout' };

/**
 * Qué hacer con un `auth:set-token`.
 * - activeOperator: operador con sesión activa en el main (null tras logout/expiración)
 * - lastOperator: último operador que usó WhatsApp en esta máquina (disco)
 */
export function decideSetToken(input: {
  token: string | null;
  reason?: SetTokenReason;
  activeOperator: string | null;
  lastOperator: string | null;
}): SetTokenAction {
  const { token, reason, activeOperator, lastOperator } = input;
  if (!token) return reason === 'expired' ? { kind: 'expired' } : { kind: 'logout' };
  const operator = usernameFromJwt(token);
  if (activeOperator && canonicalOperatorId(activeOperator) === operator) return { kind: 'refresh', operator };
  // `.ana-last-operator` de versiones previas puede traer otra grafía.
  const last = canonicalOperatorId(lastOperator);
  return { kind: 'login', operator, wipeLocal: !!last && last !== operator };
}

/** El heartbeat solo sale con campaña registrada y WhatsApp `connected`. */
export function shouldHeartbeat(state: { status: string }, campaign: string | null): boolean {
  return !!campaign && state.status === 'connected';
}
