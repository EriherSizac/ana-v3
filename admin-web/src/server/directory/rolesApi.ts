import 'server-only';
import { serverEnv } from '../env';

/**
 * API de Roles de Pernexium (lectura con X-Api-Key, solo servidor).
 * Formas (design D11, gotcha de docs/sso-cognito-cookie-storage.md):
 *  - `GET /users`: roles con `id`/`name`/`campaign`.
 *  - `GET /users/{username}`: roles con `role_id`/`role_name`/`campaign_name`
 *    y permisos inline `permissions[].permission_name`.
 * Nunca se llama `/roles/{id}/permissions`.
 */

export interface UserRole {
  roleId: string;
  roleName: string;
  campaign: string;
}

export interface UserRoleDetail extends UserRole {
  permissions: string[];
}

const CACHE_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;
let listCache: { byUser: Map<string, UserRole[]>; expiresAt: number } | null = null;

export function invalidateRoles(): void {
  listCache = null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Normaliza un rol de cualquiera de las dos formas. */
export function normalizeRole(r: Record<string, unknown>): UserRole {
  return {
    roleId: str(r.role_id ?? r.id),
    roleName: str(r.role_name ?? r.name),
    campaign: str(r.campaign_name ?? r.campaign),
  };
}

async function getJson(path: string): Promise<unknown> {
  const { rolesApiBase, rolesApiKey } = serverEnv();
  const res = await fetch(`${rolesApiBase}${path}`, {
    headers: { 'x-api-key': rolesApiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`roles api status ${res.status}`);
  return res.json();
}

const userKey = (u: Record<string, unknown>): string =>
  str(u.username ?? u.user_name ?? u.cognito_username ?? u.userName).toLowerCase();

/** Roles de todos los usuarios (`GET /users`), por username en minúsculas. Caché 5 min. */
export async function listUserRoles(): Promise<Map<string, UserRole[]>> {
  if (listCache && listCache.expiresAt > Date.now()) return listCache.byUser;
  const data = await getJson('/users');
  const rows = Array.isArray(data)
    ? data
    : Array.isArray((data as { users?: unknown })?.users)
      ? (data as { users: unknown[] }).users
      : Array.isArray((data as { data?: unknown })?.data)
        ? (data as { data: unknown[] }).data
        : [];
  const byUser = new Map<string, UserRole[]>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const u = row as Record<string, unknown>;
    const key = userKey(u);
    if (!key) continue;
    const roles = Array.isArray(u.roles) ? (u.roles as Record<string, unknown>[]).map(normalizeRole) : [];
    byUser.set(key, roles);
  }
  listCache = { byUser, expiresAt: Date.now() + CACHE_TTL_MS };
  return byUser;
}

/** Detalle de un usuario (`GET /users/{username}`) con permisos inline. */
export async function getUserRoles(username: string): Promise<UserRoleDetail[]> {
  const data = (await getJson(`/users/${encodeURIComponent(username)}`)) as { roles?: Record<string, unknown>[] } | null;
  return (data?.roles ?? []).map((r) => ({
    ...normalizeRole(r),
    permissions: Array.isArray(r.permissions)
      ? (r.permissions as Record<string, unknown>[]).map((p) => str(p.permission_name)).filter(Boolean)
      : [],
  }));
}
