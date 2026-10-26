import { normalizeKeySegment } from './campaign';
import { adminError, header, type AdminEvent, type AdminResult } from './adminHttp';

/**
 * Autorización de las rutas /admin/* (spec v3/backend-api-security, design D4):
 * el authorizer JWT `cognitoAdminJwt` ya validó el id token; aquí se resuelve
 * el acceso ANA del usuario con v4 `GET /me` (mismo token, timeout 5 s, caché
 * por usuario 60 s sin cachear errores) y se decide con `permissions`,
 * `campaigns` e `isAdmin`, sin flags de enforcement.
 */

export interface AdminAccess {
  username: string;
  permissions: string[];
  campaigns: string[];
  roleNames: string[];
  isAdmin: boolean;
  isLeader: boolean;
}

export interface AdminAccessOptions {
  /** Permisos exigidos (todos). Admin los tiene todos. */
  permissions?: string[];
  /** Campaña normalizada sobre la que se opera (admin y `*` pasan). */
  campaign?: string;
  /** Regla adicional sobre el acceso (p. ej. rol Developer). */
  check?: (access: AdminAccess) => boolean;
}

export type AdminAccessResult = { ok: true; access: AdminAccess; username: string } | { ok: false; response: AdminResult };

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;
const cache = new Map<string, { access: AdminAccess; expiresAt: number }>();

/** Solo pruebas. */
export const clearAdminAccessCache = (): void => cache.clear();

const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export class AccessUnavailableError extends Error {
  constructor() {
    super('access_unavailable');
    this.name = 'AccessUnavailableError';
  }
}

/** Normaliza un nombre de rol como `isLeaderRole` de v4 (NFD, sin diacríticos, minúsculas). */
export const normalizeRoleName = (name: string | undefined | null): string =>
  (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const isDeveloper = (access: Pick<AdminAccess, 'roleNames'>): boolean =>
  access.roleNames.some((r) => /developer/.test(normalizeRoleName(r)));

/** Acceso efectivo desde v4 `GET /me`. Lanza AccessUnavailableError ante cualquier fallo. */
export async function fetchAccess(username: string, token: string): Promise<AdminAccess> {
  const hit = cache.get(username);
  if (hit && hit.expiresAt > Date.now()) return hit.access;
  const base = (process.env.ANA_V4_API_BASE || '').replace(/\/+$/, '');
  if (!base) throw new AccessUnavailableError();
  let res: Response;
  try {
    res = await fetch(`${base}/me`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error(JSON.stringify({ evt: 'admin_access', status: 'unavailable', reason: (e as Error)?.name ?? 'error' }));
    throw new AccessUnavailableError();
  }
  if (!res.ok) {
    console.error(JSON.stringify({ evt: 'admin_access', status: 'unavailable', httpStatus: res.status }));
    throw new AccessUnavailableError();
  }
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new AccessUnavailableError();
  }
  const a = body?.access;
  if (!a || typeof a !== 'object') throw new AccessUnavailableError();
  const access: AdminAccess = {
    username,
    permissions: strArray(a.permissions),
    campaigns: strArray(a.campaigns),
    roleNames: strArray(a.roleNames),
    isAdmin: a.isAdmin === true,
    isLeader: a.isLeader === true,
  };
  cache.set(username, { access, expiresAt: Date.now() + CACHE_TTL_MS });
  return access;
}

export const hasPermission = (access: AdminAccess, perm: string): boolean =>
  access.isAdmin || access.permissions.includes(perm);

export const campaignInScope = (access: AdminAccess, campaign: string): boolean => {
  if (access.isAdmin) return true;
  const own = access.campaigns.map((c) => normalizeKeySegment(c));
  return own.includes('*') || own.includes(campaign);
};

/** Username del token (claim `cognito:username`) y el bearer, o null. */
export const tokenIdentity = (event: AdminEvent): { username: string; token: string } | null => {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const username = claims['cognito:username'];
  const m = /^Bearer\s+(\S+)$/i.exec((header(event, 'authorization') || '').trim());
  if (typeof username !== 'string' || !username || !m) return null;
  return { username, token: m[1]! };
};

/**
 * Resuelve y aplica la autorización. Devuelve el acceso o la respuesta de
 * error (401/403/503) que el handler debe retornar SIN tocar S3.
 */
export async function requireAdminAccess(event: AdminEvent, opts: AdminAccessOptions = {}): Promise<AdminAccessResult> {
  const id = tokenIdentity(event);
  if (!id) return { ok: false, response: adminError(401, 'No autorizado') };
  let access: AdminAccess;
  try {
    access = await fetchAccess(id.username, id.token);
  } catch {
    return { ok: false, response: adminError(503, 'Autorización no disponible') };
  }
  for (const p of opts.permissions ?? []) {
    if (!hasPermission(access, p)) return { ok: false, response: adminError(403, 'Sin permiso') };
  }
  if (opts.check && !opts.check(access)) return { ok: false, response: adminError(403, 'Sin permiso') };
  if (opts.campaign !== undefined && !campaignInScope(access, opts.campaign)) {
    return { ok: false, response: adminError(403, 'Sin permiso para esta campaña') };
  }
  return { ok: true, access, username: normalizeKeySegment(id.username) };
}
