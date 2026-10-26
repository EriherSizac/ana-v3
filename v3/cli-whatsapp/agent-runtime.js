import { CONFIG, __dirname_export as DATA_DIR } from './config.js';
import { cognitoConfigFromEnv, createCognitoClient } from './cognito-auth.js';
import { createDpapiProtector, createSessionStore, unavailableProtector } from './session-store.js';
import { createAgentSession } from './agent-session.js';
import { createBackendClient } from './backend-client.js';
import { getCliVersion } from './self-update.js';

/**
 * Instancias únicas del proceso (las tres ventanas corren en el mismo proceso
 * Node): cliente de Cognito, sesión de agente y cliente del backend v3.
 */

export const BACKEND_BASE_URL = process.env.ANA_API_URL || CONFIG.apiBaseUrl;
export const CLI_VERSION = getCliVersion();
export const cognitoConfig = cognitoConfigFromEnv();

export const cognito = createCognitoClient(cognitoConfig);
export const sessionStore = createSessionStore({
  dir: DATA_DIR,
  protector: process.platform === 'win32' ? createDpapiProtector() : unavailableProtector,
});
export const agentSession = createAgentSession({ cognito, store: sessionStore });
export const backend = createBackendClient({ baseUrl: BACKEND_BASE_URL, session: agentSession, cliVersion: CLI_VERSION });

/** `fetch` autenticado al backend v3 (wrapper único). */
export const backendFetch = (path, init) => backend.fetch(path, init);

/** `{ agent_id, campaign }` de la sesión activa (nunca de la página), o null. */
export const sessionIdentity = () => agentSession.identity();

/** Proveedor del ID token para módulos que lo necesitan (configuración remota). */
export const getIdToken = () => agentSession.getIdToken();
