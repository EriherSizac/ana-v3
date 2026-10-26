/**
 * Configuración remota del CLI (add-cli-remote-settings, design D5).
 *
 * Un solo poller en el proceso principal: consulta `GET /agent/settings` tras
 * el login y cada 5 minutos (timeout 5 s), guarda en memoria el último valor
 * exitoso (nunca en disco) y usa los valores por defecto si nunca hubo éxito.
 * Las ventanas leen el valor vigente con `get(key)` / `onChange` de este módulo;
 * ninguna consulta la ruta por su cuenta.
 *
 * La autenticación (ID token del CLI) la aporta el módulo de sesión de
 * migrate-cli-to-cognito-login vía `setTokenProvider`. Sin token no se consulta:
 * el valor sigue siendo el por defecto (seguro).
 */

import { getCliVersion } from './self-update.js';

/** Catálogo local de valores por defecto (mismo que v3/ana-backend/src/lib/cliSettings.ts). */
export const DEFAULT_SETTINGS = Object.freeze({
  noWhatsappConsultRegistration: false,
});

export const POLL_INTERVAL_MS = 5 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 5000;

const typeOk = (key, value) => typeof DEFAULT_SETTINGS[key] === typeof value;

/**
 * Crea un lector de configuración. Todas las dependencias son inyectables
 * para pruebas (`fetchImpl`, `getToken`, temporizadores).
 */
export function createRemoteSettings({
  baseUrl,
  getToken = async () => null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  cliVersion = 'unknown',
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (h) => clearInterval(h),
  logger = console,
} = {}) {
  let current = { ...DEFAULT_SETTINGS };
  let lastSuccessAt = null;
  let timer = null;
  const listeners = new Set();
  let tokenProvider = getToken;

  const apply = (incoming) => {
    const next = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (incoming && Object.prototype.hasOwnProperty.call(incoming, key) && typeOk(key, incoming[key])) {
        next[key] = incoming[key];
      }
    }
    const changed = Object.keys(next).filter((k) => next[k] !== current[k]);
    current = next;
    for (const key of changed) {
      for (const fn of listeners) {
        try {
          fn(key, next[key], { ...next });
        } catch (e) {
          logger.error?.('[remote-settings] listener falló:', e?.message || e);
        }
      }
    }
  };

  /** Una consulta. Devuelve true si tuvo éxito; ante cualquier fallo conserva el último valor. */
  async function refresh() {
    let token = null;
    try {
      token = await tokenProvider();
    } catch {
      token = null;
    }
    if (!token || !baseUrl) return false;
    try {
      const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/agent/settings`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Ana-Cli-Version': cliVersion, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        logger.warn?.(`[remote-settings] GET /agent/settings respondió ${res.status}; se conserva el valor vigente`);
        return false;
      }
      const body = await res.json();
      if (!body || typeof body !== 'object' || !body.settings || typeof body.settings !== 'object') return false;
      apply(body.settings);
      lastSuccessAt = Date.now();
      return true;
    } catch (e) {
      logger.warn?.('[remote-settings] sin respuesta del backend; se conserva el valor vigente:', e?.name || e);
      return false;
    }
  }

  return {
    /** Valor vigente de una configuración (default si nunca hubo lectura exitosa). */
    get(key) {
      return Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined;
    },
    /** Copia de todos los valores vigentes. */
    all() {
      return { ...current };
    },
    /** Suscribe a cambios: `fn(key, value, all)`. Devuelve la función para desuscribir. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Conecta el proveedor del ID token (módulo de sesión del CLI). */
    setTokenProvider(fn) {
      tokenProvider = typeof fn === 'function' ? fn : async () => null;
    },
    refresh,
    /** Primera consulta inmediata y luego cada `intervalMs`. Idempotente. */
    start() {
      if (timer) return;
      void refresh();
      timer = setIntervalImpl(() => void refresh(), intervalMs);
      timer?.unref?.();
    },
    stop() {
      if (timer) clearIntervalImpl(timer);
      timer = null;
    },
    get lastSuccessAt() {
      return lastSuccessAt;
    },
  };
}

/** Instancia única del proceso principal. */
export const remoteSettings = createRemoteSettings({
  baseUrl: process.env.ANA_API_URL || 'https://ow24p7ablb.execute-api.us-east-1.amazonaws.com',
  cliVersion: process.env.ANA_CLI_VERSION || getCliVersion(),
});

/** Arranca el poller (llamar una vez tras el login). */
export function startRemoteSettings() {
  remoteSettings.start();
  return remoteSettings;
}

/** Valor vigente de una configuración para las ventanas del CLI. */
export const getRemoteSetting = (key) => remoteSettings.get(key);
