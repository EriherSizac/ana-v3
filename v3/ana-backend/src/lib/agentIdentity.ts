/**
 * Identidad CRM del agente (crm-interactions-agent-identity): `user_id` y
 * nombre del agente desde la API de Roles (`GET {ROLES_API_BASE}/users/{username}`,
 * header `X-Api-Key`). Supuesto: ese `user_id` es el usuario del CRM.
 *
 * Caché por username de 10 min (solo éxitos). Ante cualquier fallo devuelve
 * `{ crmUserId: null, displayName: null }` y el CLI usa el user_id legado con
 * el sufijo "Agente: …" en comments. Nunca lanza; la key nunca se registra.
 */

export interface AgentIdentityInfo {
  crmUserId: string | null;
  displayName: string | null;
}

const DEFAULT_ROLES_API_BASE = 'https://8emg4wx2t8.execute-api.us-east-2.amazonaws.com';
const CACHE_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 5_000;
const EMPTY: AgentIdentityInfo = { crmUserId: null, displayName: null };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cache = new Map<string, { info: AgentIdentityInfo; expiresAt: number }>();

/** Solo pruebas. */
export const clearAgentIdentityCache = (): void => cache.clear();

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function getAgentIdentity(username: string): Promise<AgentIdentityInfo> {
  const user = (username || '').trim().toLowerCase();
  if (!user) return EMPTY;
  const hit = cache.get(user);
  if (hit && hit.expiresAt > Date.now()) return hit.info;

  const key = (process.env.ROLES_API_KEY || '').trim();
  if (!key) {
    console.error(JSON.stringify({ evt: 'agent_identity', status: 'not_configured' }));
    return EMPTY;
  }
  const base = (process.env.ROLES_API_BASE || DEFAULT_ROLES_API_BASE).trim().replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/users/${encodeURIComponent(user)}`, {
      headers: { 'X-Api-Key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ evt: 'agent_identity', status: 'error', httpStatus: res.status, username: user }));
      return EMPTY;
    }
    const body = (await res.json()) as Record<string, unknown>;
    const crmUserId = str(body?.user_id);
    if (!crmUserId || !UUID_RE.test(crmUserId)) {
      console.error(JSON.stringify({ evt: 'agent_identity', status: 'no_user_id', username: user }));
      return EMPTY;
    }
    const info: AgentIdentityInfo = { crmUserId, displayName: str(body?.name) };
    cache.set(user, { info, expiresAt: Date.now() + CACHE_TTL_MS });
    return info;
  } catch (e) {
    console.error(JSON.stringify({ evt: 'agent_identity', status: 'unavailable', reason: (e as Error)?.name ?? 'error', username: user }));
    return EMPTY;
  }
}
