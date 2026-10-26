import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  CognitoJwtInvalidClientIdError,
  JwtExpiredError,
  JwtInvalidAudienceError,
} from 'aws-jwt-verify/error';
import { normalizeKeySegment } from './campaign';
import { getEnabledAgentsCached } from './roster';

/**
 * Autenticación de agente para las rutas del CLI v3 (spec v3/agent-auth,
 * design D4–D6 de migrate-cli-to-cognito-login):
 *
 *  1. ID token de Cognito (`Authorization: Bearer`, emisor del pool,
 *     `token_use=id`, `aud` ∈ COGNITO_AGENT_CLIENT_IDS, `exp` vigente).
 *  2. Propiedad: `cognito:username` (trim + minúsculas) = agente de la solicitud.
 *  3. Roster: agente habilitado en la campaña según `v3/agent-roster`
 *     (lector con caché de 60 s de `roster.ts`).
 *  4. Modo: `AGENT_AUTH_ENFORCED=true` rechaza (401/403/503); si no, solo registra.
 *
 * Siempre se ejecuta ANTES de cualquier acceso a S3 de datos del agente.
 * El token y el header Authorization nunca se registran.
 */

export type AgentAuthReason =
  | 'ok'
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'wrong_client'
  | 'mismatch'
  | 'not_in_roster'
  | 'roster_error';

export interface AgentAuthEvent {
  headers?: Record<string, string | undefined> | null;
}

export interface AgentAuthResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface AgentRequest {
  /** Nombre de la ruta para el log (p. ej. `GET /get/chats`). */
  route: string;
  /** Agente de la solicitud (path o body). `undefined` = la ruta no tiene agente (GET /templates). */
  agent?: unknown;
  /** Campaña de la solicitud (path, body o query). */
  campaign: unknown;
}

/** Identidad verificada del token. */
export interface AgentIdentity {
  username: string;
}

type TokenCheck = { ok: true; identity: AgentIdentity } | { ok: false; reason: AgentAuthReason };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const respond = (statusCode: number, error: string): AgentAuthResponse => ({
  statusCode,
  headers: JSON_HEADERS,
  body: JSON.stringify({ error }),
});

export const unauthorized = (): AgentAuthResponse => respond(401, 'Unauthorized');
export const forbidden = (): AgentAuthResponse => respond(403, 'Forbidden');
export const notConfigured = (): AgentAuthResponse => respond(503, 'Agent auth not configured');

export const isEnforced = (): boolean => (process.env.AGENT_AUTH_ENFORCED || '').trim().toLowerCase() === 'true';

const poolId = (): string => (process.env.COGNITO_USER_POOL_ID || '').trim();
const clientIds = (): string[] =>
  (process.env.COGNITO_AGENT_CLIENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const isConfigured = (): boolean => !!poolId() && clientIds().length > 0;

/** Header sin distinguir mayúsculas en el nombre. */
const header = (event: AgentAuthEvent, name: string): string | undefined => {
  const h = event.headers || {};
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === lower && typeof v === 'string') return v;
  }
  return undefined;
};

/** Token del esquema Bearer (esquema sin distinguir mayúsculas) o null. */
export const bearerToken = (event: AgentAuthEvent): string | null => {
  const m = /^Bearer\s+(\S+)\s*$/i.exec((header(event, 'authorization') || '').trim());
  return m ? m[1]! : null;
};

const CLI_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;
/** Versión del CLI (`X-Ana-Cli-Version`) saneada para logs y métricas. */
export const cliVersionOf = (event: AgentAuthEvent): string => {
  const v = (header(event, 'x-ana-cli-version') || '').trim();
  return CLI_VERSION_RE.test(v) ? v : 'unknown';
};

// Un verificador por configuración (el JWKS se cachea por contenedor).
let verifierKey = '';
let verifier: ReturnType<typeof buildVerifier> | null = null;

const buildVerifier = (userPoolId: string, clients: string[]) =>
  CognitoJwtVerifier.create({ userPoolId, tokenUse: 'id', clientId: clients });

/** Verificador vigente según el entorno (null si falta configuración). Exportado para pruebas (`cacheJwks`). */
export const getAgentVerifier = () => {
  if (!isConfigured()) return null;
  const key = `${poolId()}|${clientIds().join(',')}`;
  if (!verifier || key !== verifierKey) {
    verifier = buildVerifier(poolId(), clientIds());
    verifierKey = key;
  }
  return verifier;
};

/** Solo pruebas. */
export const resetAgentVerifier = (): void => {
  verifier = null;
  verifierKey = '';
};

const reasonFromError = (e: unknown): AgentAuthReason => {
  if (e instanceof JwtExpiredError) return 'expired';
  if (e instanceof CognitoJwtInvalidClientIdError || e instanceof JwtInvalidAudienceError) return 'wrong_client';
  return 'invalid';
};

/** Paso 1: verificación del ID token. No toca S3. */
export async function verifyAgentToken(event: AgentAuthEvent): Promise<TokenCheck> {
  const token = bearerToken(event);
  if (!token) return { ok: false, reason: 'missing' };
  const v = getAgentVerifier();
  if (!v) return { ok: false, reason: 'invalid' };
  try {
    const payload = (await v.verify(token)) as Record<string, unknown>;
    const username = normalizeKeySegment(payload['cognito:username']);
    if (!username) return { ok: false, reason: 'invalid' };
    return { ok: true, identity: { username } };
  } catch (e) {
    return { ok: false, reason: reasonFromError(e) };
  }
}

/** Paso 3: regla efectiva del roster con caché de 60 s. Campaña sin lista = sin agentes. */
export async function rosterReason(username: string, campaign: string): Promise<AgentAuthReason> {
  if (!campaign) return 'not_in_roster';
  try {
    const enabled = await getEnabledAgentsCached(campaign);
    return enabled.includes(username) ? 'ok' : 'not_in_roster';
  } catch {
    return 'roster_error';
  }
}

/** Evalúa token + propiedad + roster y devuelve el motivo (sin aplicar el modo). */
export async function evaluateAgent(
  event: AgentAuthEvent,
  req: AgentRequest,
): Promise<{ reason: AgentAuthReason; user: string | null }> {
  const t = await verifyAgentToken(event);
  if (!t.ok) return { reason: t.reason, user: null };
  const user = t.identity.username;
  if (req.agent !== undefined && normalizeKeySegment(req.agent) !== user) return { reason: 'mismatch', user };
  return { reason: await rosterReason(user, normalizeKeySegment(req.campaign)), user };
}

/** Línea `evt:"agent_auth"` (stdout sin prefijo de Lambda, para metric filters JSON). */
export function logAgentAuth(entry: {
  mode: 'report' | 'strict';
  route: string;
  reason: AgentAuthReason;
  agent: string | null;
  campaign: string | null;
  user: string | null;
  cliVersion: string;
  config?: 'missing';
}): void {
  const line = JSON.stringify({ evt: 'agent_auth', ...entry });
  process.stdout.write(`${line}\n`);
}

const STATUS_BY_REASON: Record<AgentAuthReason, 401 | 403 | null> = {
  ok: null,
  missing: 401,
  invalid: 401,
  expired: 401,
  wrong_client: 401,
  mismatch: 403,
  not_in_roster: 403,
  roster_error: 403,
};

/**
 * Autenticación de las rutas de agente con modo de transición.
 * Devuelve `null` para continuar con el handler, o la respuesta de error
 * (solo en modo estricto) que el handler debe retornar sin tocar S3.
 */
export async function requireAgent(event: AgentAuthEvent, req: AgentRequest): Promise<AgentAuthResponse | null> {
  const strict = isEnforced();
  const mode = strict ? 'strict' : 'report';
  const agent = req.agent === undefined ? null : normalizeKeySegment(req.agent) || null;
  const campaign = normalizeKeySegment(req.campaign) || null;
  const cliVersion = cliVersionOf(event);
  const configured = isConfigured();

  if (strict && !configured) {
    logAgentAuth({ mode, route: req.route, reason: 'invalid', agent, campaign, user: null, cliVersion, config: 'missing' });
    return notConfigured();
  }

  const { reason, user } = await evaluateAgent(event, req);
  logAgentAuth({
    mode,
    route: req.route,
    reason,
    agent,
    campaign,
    user,
    cliVersion,
    ...(!configured && reason !== 'missing' ? { config: 'missing' as const } : {}),
  });
  const status = STATUS_BY_REASON[reason];
  if (!strict || status === null) return null;
  return status === 401 ? unauthorized() : forbidden();
}

/**
 * Rutas `/agent/*`: siempre exigen un ID token válido (sin modo reporte).
 * No aplica propiedad ni roster (cada handler decide).
 */
export async function requireAgentToken(
  event: AgentAuthEvent,
  route: string,
): Promise<{ ok: true; username: string } | { ok: false; response: AgentAuthResponse }> {
  const cliVersion = cliVersionOf(event);
  if (!isConfigured()) {
    logAgentAuth({ mode: 'strict', route, reason: 'invalid', agent: null, campaign: null, user: null, cliVersion, config: 'missing' });
    return { ok: false, response: notConfigured() };
  }
  const t = await verifyAgentToken(event);
  logAgentAuth({
    mode: 'strict',
    route,
    reason: t.ok ? 'ok' : t.reason,
    agent: null,
    campaign: null,
    user: t.ok ? t.identity.username : null,
    cliVersion,
  });
  if (!t.ok) return { ok: false, response: unauthorized() };
  return { ok: true, username: t.identity.username };
}
