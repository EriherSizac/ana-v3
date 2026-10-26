// File: Broker del ID token en el main process (módulo puro, sin Electron).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/**
 * El main no tiene Amplify ni el refresh token: el renderer es el dueño de la
 * renovación. El broker guarda el último ID token entregado y, si le quedan
 * menos de `minTtlMs` (2 min) o fue invalidado por un 401, pide uno nuevo al
 * renderer (`request()` → IPC `auth:token-request`) y espera `provide()` hasta
 * `timeoutMs` (10 s). Una sola solicitud en vuelo, compartida por todos los
 * llamadores. Si vence el timeout devuelve el token anterior.
 */

export const MIN_TTL_MS = 2 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 10_000;

/** `exp` del JWT en epoch ms, o null si no se puede leer. Sin verificar firma. */
export function jwtExpMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface TokenBrokerOptions {
  /** Pide un token al renderer (emite `auth:token-request`). */
  request: () => void;
  now?: () => number;
  minTtlMs?: number;
  timeoutMs?: number;
}

export class TokenBroker {
  private token: string | null = null;
  private stale = false; // invalidado por un 401 → pedir otro aunque no venza
  private inFlight: Promise<string | null> | null = null;
  private resolveInFlight: ((t: string | null) => void) | null = null;

  constructor(private opts: TokenBrokerOptions) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /** Token actual sin renovar (para chequeos "¿hay sesión?"). */
  getToken(): string | null {
    return this.token;
  }

  /** Reemplaza el token (login, renovación del renderer o logout con null). */
  setToken(token: string | null) {
    this.token = token;
    this.stale = false;
    // Un token entregado por cualquier vía satisface la solicitud en vuelo.
    this.settle(token);
  }

  /**
   * Respuesta del renderer a `auth:token-request`. `null` = no pudo renovar
   * ahora: la solicitud se resuelve con el token anterior.
   */
  provide(token: string | null) {
    if (token) {
      this.token = token;
      this.stale = false;
    }
    this.settle(token ?? this.token);
  }

  /** Marca el token actual como rechazado (401): el siguiente uso pide otro. */
  invalidate() {
    this.stale = true;
  }

  private needsRefresh(): boolean {
    if (!this.token) return false;
    if (this.stale) return true;
    const exp = jwtExpMs(this.token);
    if (exp == null) return false; // sin exp legible → no forzar renovación
    return exp - this.now() < (this.opts.minTtlMs ?? MIN_TTL_MS);
  }

  /** Token vigente: el actual si le quedan ≥ 2 min; si no, pide uno al renderer. */
  async getFreshToken(): Promise<string | null> {
    if (!this.token) return null; // sin sesión: nada que renovar
    if (!this.needsRefresh()) return this.token;
    if (this.inFlight) return this.inFlight;

    const previous = this.token;
    const pending = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => this.settle(previous), this.opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
      this.resolveInFlight = (t) => {
        clearTimeout(timer);
        resolve(t);
      };
    });
    this.inFlight = pending;
    try {
      this.opts.request(); // el renderer puede responder de forma síncrona en tests
    } catch {
      this.settle(previous);
    }
    return pending;
  }

  private settle(t: string | null) {
    const r = this.resolveInFlight;
    this.resolveInFlight = null;
    this.inFlight = null;
    r?.(t);
  }
}

/** fetch autenticado: `Authorization: Bearer <token>` y un reintento ante 401. */
export type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class NoSessionError extends Error {
  constructor() {
    super('Sin sesión');
    this.name = 'NoSessionError';
  }
}

/**
 * Construye un `fetch` que pide token fresco al broker, lo pone en el header y,
 * ante 401, invalida el token, pide otro y reintenta UNA vez. Un segundo 401 se
 * devuelve tal cual (el llamador lo trata como error). Sin token → NoSessionError.
 */
export function createAuthFetch(
  broker: Pick<TokenBroker, 'getFreshToken' | 'invalidate'>,
  fetchImpl: typeof fetch = fetch,
): AuthFetch {
  const withAuth = (init: RequestInit | undefined, token: string): RequestInit => ({
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
  });
  return async (url, init) => {
    const token = await broker.getFreshToken();
    if (!token) throw new NoSessionError();
    const res = await fetchImpl(url, withAuth(init, token));
    if (res.status !== 401) return res;
    broker.invalidate();
    const retryToken = await broker.getFreshToken();
    if (!retryToken) return res;
    return fetchImpl(url, withAuth(init, retryToken));
  };
}
