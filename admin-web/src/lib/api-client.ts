'use client';

import { currentIdToken } from './auth-client';
import { loginUrl } from './safe-next';

/** Error uniforme del BFF (`{error:{code,message}}`). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiDeps {
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  redirect: (url: string) => void;
  currentPath: () => string;
  fetchImpl: typeof fetch;
}

const defaultDeps: ApiDeps = {
  getToken: currentIdToken,
  redirect: (url) => window.location.assign(url),
  currentPath: () => `${window.location.pathname}${window.location.search}`,
  fetchImpl: (...args) => fetch(...args),
};

let deps: ApiDeps = defaultDeps;

/** Solo pruebas. */
export function setApiDepsForTests(d: Partial<ApiDeps> | null): void {
  deps = d ? { ...defaultDeps, ...d } : defaultDeps;
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  /** Cuerpo JSON (se serializa) o BodyInit tal cual. */
  json?: unknown;
  body?: BodyInit;
}

async function send(path: string, token: string, opts: ApiOptions): Promise<Response> {
  const headers = new Headers(opts.headers);
  headers.set('authorization', `Bearer ${token}`);
  let body = opts.body;
  if (opts.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(opts.json);
  }
  return deps.fetchImpl(path, { ...opts, headers, body, cache: 'no-store' });
}

class RedirectingError extends ApiError {
  constructor() {
    super(401, 'unauthenticated', 'Sesión inválida');
  }
}

/**
 * Llama al BFF con el id token en `Authorization`. Ante 401 fuerza una
 * renovación de la sesión y reintenta una sola vez; si vuelve a fallar
 * redirige a `/login?next=<ruta actual>`.
 */
export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  let token = await deps.getToken();
  if (!token) token = await deps.getToken(true);
  if (!token) {
    deps.redirect(loginUrl(deps.currentPath()));
    throw new RedirectingError();
  }
  let res = await send(path, token, opts);
  if (res.status === 401) {
    const refreshed = await deps.getToken(true);
    if (!refreshed) {
      deps.redirect(loginUrl(deps.currentPath()));
      throw new RedirectingError();
    }
    res = await send(path, refreshed, opts);
    if (res.status === 401) {
      deps.redirect(loginUrl(deps.currentPath()));
      throw new RedirectingError();
    }
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'internal',
      err?.message ?? 'Error inesperado. Intenta de nuevo.',
      err?.details,
    );
  }
  return data as T;
}

export const isRedirecting = (e: unknown): boolean => e instanceof RedirectingError;
