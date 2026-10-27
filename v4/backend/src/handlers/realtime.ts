// File: API WebSocket realtime (add-realtime-gateway): authorizer, $connect, $disconnect, ping y $default.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { resolveUserAccess } from '../lib/access';
import { canonicalOperatorId } from '../lib/identity';
import {
  connectionTopics,
  isClientType,
  metric,
  realtimeEnabled,
  type ClientType,
  type ConnectionAccess,
} from '../lib/realtime';
import { getConnection, putConnection, removeConnection } from '../lib/realtimeStore';
import { managementClient, postTo } from '../lib/realtimePush';

export const SUBPROTOCOL = 'ana.v1';
const MAX_VERSION_LEN = 40;

type Verifier = { verify: (token: string) => Promise<Record<string, unknown>> };
let verifier: Verifier | null = null;

function getVerifier(): Verifier {
  if (!verifier) {
    const clientIds = (process.env.REALTIME_CLIENT_IDS ?? '1r6niimhkl2fmias6kk85n4ou4')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID ?? 'us-east-2_UepfOyKpd',
      tokenUse: 'id',
      clientId: clientIds,
    }) as unknown as Verifier;
  }
  return verifier;
}

/** Solo pruebas: reemplaza el verificador de JWT. */
export function setVerifierForTests(v: Verifier | null): void {
  verifier = v;
}

/** Header sin distinguir mayúsculas. */
export function header(headers: Record<string, string | undefined> | null | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const k = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
  return k ? headers[k] : undefined;
}

/** `ana.v1, <token>` → token; null si el subprotocolo no es exactamente ese par. */
export function tokenFromSubprotocol(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2 || parts[0] !== SUBPROTOCOL || !parts[1]) return null;
  return parts[1];
}

const allowedOrigins = () =>
  (process.env.REALTIME_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export type RejectReason = 'disabled' | 'bad_client' | 'origin' | 'invalid_token' | 'expired' | 'access_error';

function policy(effect: 'Allow' | 'Deny', resource: string, principalId: string, context?: Record<string, string | number>) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
    },
    ...(context ? { context } : {}),
  };
}

function reject(reason: RejectReason, client: string | null, version: string | null, resource: string) {
  // Nunca el token ni el header del subprotocolo.
  console.log(JSON.stringify({ evt: 'realtime_connect_rejected', reason, client, version }));
  metric('ConnectRejected', 1, { reason });
  return policy('Deny', resource, 'anonymous');
}

/**
 * REQUEST authorizer de `$connect` (design D2/D3/D10). API Gateway rechaza con
 * 401 sin invocar si falta `Sec-WebSocket-Protocol`; aquí, Deny → 403.
 */
export const authorizer = async (event: any) => {
  const resource = event?.methodArn ?? '*';
  const q = event?.queryStringParameters ?? {};
  const rawClient = typeof q.client === 'string' ? q.client : null;
  const version = typeof q.v === 'string' ? q.v.slice(0, MAX_VERSION_LEN) : null;
  if (!realtimeEnabled()) return reject('disabled', rawClient, version, resource);
  if (!isClientType(rawClient)) return reject('bad_client', rawClient, version, resource);
  const client: ClientType = rawClient;

  const origin = header(event?.headers, 'Origin');
  if (origin !== undefined || client === 'admin') {
    if (!origin || !allowedOrigins().includes(origin)) return reject('origin', client, version, resource);
  }

  const token = tokenFromSubprotocol(header(event?.headers, 'Sec-WebSocket-Protocol'));
  if (!token) return reject('invalid_token', client, version, resource);
  let payload: Record<string, unknown>;
  try {
    payload = await getVerifier().verify(token);
  } catch (e) {
    const name = (e as Error)?.name ?? '';
    return reject(name === 'JwtExpiredError' ? 'expired' : 'invalid_token', client, version, resource);
  }
  const username = canonicalOperatorId(payload['cognito:username'] ?? payload.sub);
  if (!username) return reject('invalid_token', client, version, resource);
  const exp = Number(payload.exp) * 1000;
  return policy('Allow', resource, username, { username, client, version: version ?? '', exp: Number.isFinite(exp) ? exp : 0 });
};

const ctxOf = (event: any) => event?.requestContext?.authorizer ?? {};

/**
 * `$connect` (design D4): temas derivados de la identidad. `admin` sin acceso
 * resuelto se rechaza; `desktop`/`cli` se aceptan con `r#unknown`.
 */
export const connect = async (event: any) => {
  const connectionId: string = event?.requestContext?.connectionId;
  const ctx = ctxOf(event);
  const username = canonicalOperatorId(ctx.username);
  const client = ctx.client;
  const version = String(ctx.version ?? '');
  if (!connectionId || !username || !isClientType(client)) {
    metric('ConnectRejected', 1, { reason: 'invalid_token' });
    return { statusCode: 403 };
  }
  let access: ConnectionAccess | null = null;
  try {
    const a = await resolveUserAccess(username);
    access = { campaigns: a.campaigns ?? [], roleIds: a.roleIds ?? [] };
  } catch (e) {
    console.error(JSON.stringify({ evt: 'realtime_access_error', username, client, error: (e as Error)?.name ?? 'error' }));
    if (client === 'admin') {
      metric('ConnectRejected', 1, { reason: 'access_error' });
      return { statusCode: 403 };
    }
  }
  const topics = connectionTopics(username, client, access);
  await putConnection({
    connectionId,
    username,
    client,
    version,
    connectedAt: Date.now(),
    tokenExp: Number(ctx.exp) || 0,
    topics,
  });
  console.log(JSON.stringify({ evt: 'realtime_connect', connectionId, username, client, version, topics: topics.length, access: access ? 'ok' : 'unknown' }));
  metric('ConnectAccepted', 1, { client });
  return { statusCode: 200, headers: { 'Sec-WebSocket-Protocol': SUBPROTOCOL } };
};

/** `$disconnect`: borra la conexión y sus suscripciones. */
export const disconnect = async (event: any) => {
  const connectionId: string = event?.requestContext?.connectionId;
  if (connectionId) await removeConnection(connectionId);
  return { statusCode: 200 };
};

const endpointOf = (event: any) => {
  const rc = event?.requestContext ?? {};
  return rc.domainName && rc.stage ? `https://${rc.domainName}/${rc.stage}` : undefined;
};

/** Ruta `ping` (design D8): `pong` con la hora del servidor y el `exp` del token. */
export const ping = async (event: any) => {
  const connectionId: string = event?.requestContext?.connectionId;
  let exp = Number(ctxOf(event).exp) || 0;
  if (!exp) exp = (await getConnection(connectionId))?.tokenExp ?? 0;
  await postTo(connectionId, { type: 'pong', at: Date.now(), exp }, managementClient(endpointOf(event)));
  return { statusCode: 200 };
};

/** `$default`: cualquier otra acción → `unknown_action` (las suscripciones no cambian). */
export const fallback = async (event: any) => {
  const connectionId: string = event?.requestContext?.connectionId;
  await postTo(connectionId, { type: 'error', code: 'unknown_action' }, managementClient(endpointOf(event)));
  return { statusCode: 200 };
};
