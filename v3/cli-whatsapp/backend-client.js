/**
 * Wrapper único para TODAS las llamadas del CLI al backend v3
 * (migrate-cli-to-cognito-login, design D9; spec v3/cli-agent-session):
 *  - agrega `Authorization: Bearer <ID token>` y `X-Ana-Cli-Version`;
 *  - ante 401 fuerza una renovación y reintenta una vez;
 *  - registra 401/403 persistentes en la sesión (avisos de consola y widget);
 *  - registra solo método, ruta y estado (nunca headers, tokens ni cuerpos).
 */

const pathOnly = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url).split('?')[0];
  }
};

/**
 * @param {{ baseUrl: string, session: ReturnType<import('./agent-session.js').createAgentSession>,
 *           cliVersion?: string, fetchImpl?: typeof fetch, logger?: Console }} deps
 */
export function createBackendClient({ baseUrl, session, cliVersion = 'unknown', fetchImpl, logger = console } = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const base = String(baseUrl || '').replace(/\/+$/, '');

  const withAuth = (init, token) => {
    const headers = { ...(init?.headers || {}) };
    for (const k of Object.keys(headers)) if (k.toLowerCase() === 'authorization') delete headers[k];
    headers['X-Ana-Cli-Version'] = cliVersion;
    if (token) headers.Authorization = `Bearer ${token}`;
    return { ...(init || {}), headers };
  };

  /**
   * `fetch` autenticado. `path` relativo al backend v3 (p. ej. `/backups/chat`).
   * Lanza los mismos errores de red que `fetch`.
   */
  async function backendFetch(path, init = {}) {
    const url = /^https?:\/\//i.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const method = String(init.method || 'GET').toUpperCase();
    const route = pathOnly(url);
    let token = await session.getIdToken();
    let res;
    try {
      res = await doFetch(url, withAuth(init, token));
    } catch (e) {
      logger.error?.(`[backend] ${method} ${route} → error de red (${e?.cause?.code || e?.name || 'error'})`);
      throw e;
    }
    if (res.status === 401) {
      token = await session.getIdToken({ force: true });
      if (token) {
        try {
          res = await doFetch(url, withAuth(init, token));
        } catch (e) {
          logger.error?.(`[backend] ${method} ${route} → error de red en el reintento (${e?.cause?.code || e?.name || 'error'})`);
          throw e;
        }
      }
    }
    session.noteBackendStatus(res.status);
    if (res.status === 401 || res.status === 403) {
      logger.warn?.(`[backend] ${method} ${route} → ${res.status}: ${session.authMessage() || ''}`);
    } else {
      logger.log?.(`[backend] ${method} ${route} → ${res.status}`);
    }
    return res;
  }

  /** `GET /agent/campaigns` → `{ username, campaigns }`; lanza con `status` si no es 200. */
  async function fetchAgentCampaigns() {
    const res = await backendFetch('/agent/campaigns', { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const err = new Error(`agent_campaigns_${res.status}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    const campaigns = Array.isArray(body?.campaigns) ? body.campaigns.filter((c) => typeof c === 'string') : [];
    return { username: String(body?.username || ''), campaigns };
  }

  /**
   * Con un aviso activo (401/403), vuelve a consultar `GET /agent/campaigns`
   * para saber si el agente recuperó el acceso a su campaña. Devuelve el aviso
   * vigente o null.
   */
  async function recheckAuthorization() {
    if (session.authStatus === 'ok') return null;
    try {
      const { campaigns } = await fetchAgentCampaigns();
      const c = session.campaign;
      session.noteBackendStatus(c && campaigns.includes(c) ? 200 : 403);
    } catch (e) {
      if (e?.status) session.noteBackendStatus(e.status);
    }
    return session.authMessage();
  }

  /**
   * Actualización de acceso forzada (add-realtime-v3-cli D7): relee siempre
   * `GET /agent/campaigns` y actualiza el aviso según la campaña de la sesión.
   * Devuelve el aviso vigente o null.
   */
  async function refreshAccess() {
    try {
      const { campaigns } = await fetchAgentCampaigns();
      const c = session.campaign;
      session.noteBackendStatus(c && campaigns.map((x) => String(x).toLowerCase()).includes(c) ? 200 : 403);
    } catch (e) {
      if (e?.status) session.noteBackendStatus(e.status);
    }
    return session.authMessage();
  }

  return { fetch: backendFetch, fetchAgentCampaigns, recheckAuthorization, refreshAccess };
}
