import 'server-only';
import { isDeveloper, type Access } from '@/lib/access';
import { serverEnv } from '../env';
import { HttpError } from '../errors';

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;

const cache = new Map<string, { access: Access; expiresAt: number }>();

/** Solo pruebas. */
export function clearAccessCache(): void {
  cache.clear();
}

const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Acceso efectivo del usuario desde v4 `GET /me` (fuente de verdad, design D5),
 * llamado con el id token del propio usuario. Caché por username hasta 60 s;
 * los errores nunca se cachean. Fallo o timeout (5 s) → 503 access_unavailable.
 */
export async function resolveAccess(username: string, token: string): Promise<Access> {
  const hit = cache.get(username);
  if (hit && hit.expiresAt > Date.now()) return hit.access;

  const { v4ApiBase } = serverEnv();
  let res: Response;
  try {
    res = await fetch(`${v4ApiBase}/me`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (e) {
    console.error('[access] v4 /me sin respuesta', e instanceof Error ? e.name : 'error');
    throw new HttpError('access_unavailable');
  }
  if (!res.ok) {
    console.error('[access] v4 /me status', res.status);
    throw new HttpError('access_unavailable');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new HttpError('access_unavailable');
  }
  const a = (body as { access?: Record<string, unknown> } | null)?.access;
  if (!a || typeof a !== 'object') throw new HttpError('access_unavailable');

  const roleNames = strArray(a.roleNames);
  const access: Access = {
    // La identidad es la del token verificado, no la que diga el backend.
    username,
    permissions: strArray(a.permissions),
    campaigns: strArray(a.campaigns),
    roleNames,
    isAdmin: a.isAdmin === true,
    isLeader: a.isLeader === true,
    isDeveloper: isDeveloper(roleNames),
  };
  cache.set(username, { access, expiresAt: Date.now() + CACHE_TTL_MS });
  return access;
}
