import { CognitoError, decodeJwtPayload, isSessionRejected } from './cognito-auth.js';

/**
 * Sesión de agente en memoria (migrate-cli-to-cognito-login, design D3/D7/D9).
 * Un único módulo compartido por las tres ventanas del proceso:
 *  - ID/access tokens solo en memoria; el refresh token se persiste con `store` (DPAPI).
 *  - Renovación cuando faltan ≤ 5 min, con una sola renovación en curso (single-flight).
 *  - Identidad del agente (`cognito:username` en minúsculas) y campaña elegida:
 *    las llamadas al backend las toman de aquí, nunca de la página.
 *  - Estado de autorización del backend (401/403 persistentes) para avisos.
 */

export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const AUTH_MESSAGES = Object.freeze({
  expired: 'Sesión expirada: cierra ANA y vuelve a iniciar sesión',
  forbidden: 'Tu usuario no está habilitado en esta campaña',
});

const normalizeUser = (u) => String(u || '').trim().toLowerCase();

/**
 * @param {{ cognito: ReturnType<import('./cognito-auth.js').createCognitoClient>,
 *           store?: ReturnType<import('./session-store.js').createSessionStore> | null,
 *           now?: () => number, logger?: Console }} deps
 */
export function createAgentSession({ cognito, store = null, now = () => Date.now(), logger = console } = {}) {
  let state = null; // { username, cognitoUsername, idToken, accessToken, refreshToken, idExpMs }
  let campaign = null;
  let inflight = null;
  let authStatus = 'ok'; // 'ok' | 'expired' | 'forbidden'

  const fromTokens = (tokens, refreshToken) => {
    const payload = decodeJwtPayload(tokens.idToken) || {};
    const cognitoUsername = String(payload['cognito:username'] || '');
    const username = normalizeUser(cognitoUsername);
    if (!username) throw new CognitoError('UnexpectedResponse', 'ID token sin cognito:username');
    const expSec = Number(payload.exp);
    const idExpMs = Number.isFinite(expSec) ? expSec * 1000 : now() + (Number(tokens.expiresIn) || 3600) * 1000;
    return { username, cognitoUsername, idToken: tokens.idToken, accessToken: tokens.accessToken, refreshToken, idExpMs };
  };

  async function persist() {
    if (!store || !state?.refreshToken) return;
    await store.save({ username: state.cognitoUsername || state.username, refreshToken: state.refreshToken });
  }

  /** Renueva con el refresh token vigente. Lanza CognitoError. */
  async function doRefresh() {
    const rt = state?.refreshToken;
    if (!rt) throw new CognitoError('NoSession', 'Sin sesión');
    const tokens = await cognito.refresh(rt);
    const replaced = !!tokens.refreshToken && tokens.refreshToken !== rt;
    state = fromTokens(tokens, tokens.refreshToken || rt);
    if (replaced) await persist();
    return state;
  }

  /** Una sola renovación a la vez para todas las ventanas. */
  function refreshOnce() {
    if (!inflight) {
      inflight = doRefresh().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  return {
    /** Tras completar el login: guarda tokens en memoria y el refresh token protegido. */
    async completeLogin(tokens) {
      state = fromTokens(tokens, tokens.refreshToken);
      authStatus = 'ok';
      await persist();
      return { username: state.username };
    },

    /**
     * Reanuda la sesión guardada. Devuelve `{ username }`, o null si no hay
     * sesión reutilizable. Si Cognito rechaza el refresh token (vencido o
     * revocado) borra `.agent-session`.
     */
    async resume() {
      if (!store) return null;
      const saved = await store.load();
      if (!saved) return null;
      state = { username: normalizeUser(saved.username), cognitoUsername: saved.username, refreshToken: saved.refreshToken, idToken: null, accessToken: null, idExpMs: 0 };
      try {
        await refreshOnce();
        authStatus = 'ok';
        return { username: state.username };
      } catch (e) {
        if (isSessionRejected(e)) {
          logger.log?.('🔐 La sesión guardada venció o fue revocada; se pide login');
          store.clear();
        } else {
          logger.warn?.('⚠️  No se pudo renovar la sesión guardada:', e?.code || 'error');
        }
        state = null;
        return null;
      }
    },

    /**
     * ID token vigente (renovando si faltan ≤ 5 min o con `force`), o null si
     * no hay sesión o la renovación falla.
     */
    async getIdToken({ force = false } = {}) {
      if (!state?.refreshToken && !state?.idToken) return null;
      const fresh = state.idToken && state.idExpMs - now() > REFRESH_MARGIN_MS;
      if (fresh && !force) return state.idToken;
      try {
        const s = await refreshOnce();
        return s.idToken;
      } catch (e) {
        if (isSessionRejected(e)) authStatus = 'expired';
        logger.warn?.('⚠️  No se pudo renovar la sesión de Cognito:', e?.code || 'error');
        return null;
      }
    },

    /** Revoca el refresh token (si hay red) y borra la sesión local. Nunca lanza. */
    async logout() {
      const rt = state?.refreshToken || (store ? (await store.load().catch(() => null))?.refreshToken : null);
      if (rt) {
        try {
          await cognito.revoke(rt);
        } catch (e) {
          logger.warn?.('⚠️  No se pudo revocar la sesión en Cognito (se borra localmente):', e?.code || 'error');
        }
      }
      store?.clear();
      state = null;
      campaign = null;
      authStatus = 'ok';
    },

    get isLoggedIn() {
      return !!state;
    },
    /** `cognito:username` en minúsculas (= `agent_id`). */
    get agentId() {
      return state?.username || null;
    },
    setCampaign(c) {
      campaign = String(c || '').trim().toLowerCase() || null;
    },
    get campaign() {
      return campaign;
    },
    /** `{ agent_id, campaign }` de la sesión activa, o null. */
    identity() {
      if (!state?.username || !campaign) return null;
      return { agent_id: state.username, campaign };
    },

    /** Resultado del backend: 401 persistente → expired, 403 → forbidden, otro → ok. */
    noteBackendStatus(status) {
      if (status === 401) authStatus = 'expired';
      else if (status === 403) authStatus = 'forbidden';
      else if (status > 0 && status < 500) authStatus = 'ok';
    },
    get authStatus() {
      return authStatus;
    },
    /** Aviso vigente para consola y widget, o null. */
    authMessage() {
      return authStatus === 'ok' ? null : AUTH_MESSAGES[authStatus];
    },
  };
}
