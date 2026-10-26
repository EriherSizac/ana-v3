import 'server-only';
import { HttpError } from '../errors';

export interface UpstreamOptions {
  method?: string;
  token: string;
  body?: unknown;
  timeoutMs?: number;
  /** Etiqueta para el log del servidor. */
  label: string;
}

export interface UpstreamResult<T> {
  status: number;
  data: T;
}

/**
 * Llama a un backend ANA con el id token del usuario (nunca llaves).
 * Devuelve status + JSON; los 5xx y timeouts se convierten en 503
 * `upstream_unavailable` sin exponer el detalle (solo el status va al log).
 */
export async function callUpstream<T = unknown>(url: string, opts: UpstreamOptions): Promise<UpstreamResult<T>> {
  const { method = 'GET', token, body, timeoutMs = 10_000, label } = opts;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    console.error(`[upstream:${label}] sin respuesta`, e instanceof Error ? e.name : 'error');
    throw new HttpError('upstream_unavailable');
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
  if (res.status >= 500) {
    console.error(`[upstream:${label}] status ${res.status}`);
    throw new HttpError('upstream_unavailable');
  }
  return { status: res.status, data: data as T };
}

/** Extrae un mensaje legible de un error de backend (`{error:"..."}` o `{error:{message}}`). */
export function upstreamMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const rec = data as Record<string, unknown>;
  const e = rec.error ?? rec.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') {
    return (e as Record<string, string>).message;
  }
  return undefined;
}

/** Extrae un código `error.code` de un backend si existe. */
export function upstreamCode(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const e = (data as Record<string, unknown>).error;
  if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).code === 'string') {
    return (e as Record<string, string>).code;
  }
  return undefined;
}
