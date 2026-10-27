import { vi } from 'vitest';
import { clearAdminAccessCache } from '../../src/lib/adminAccess';
import type { AdminEvent } from '../../src/lib/adminHttp';

export const V4 = 'https://v4.test.invalid';

export interface MeAccess {
  permissions?: string[];
  campaigns?: string[];
  roleNames?: string[];
  isAdmin?: boolean;
  isLeader?: boolean;
}

export const ADMIN: MeAccess = { permissions: ['ana:admin:console:manage'], campaigns: [], roleNames: ['Admin'], isAdmin: true };
export const LEADER_DIDI: MeAccess = {
  permissions: ['ana:admin:agents:manage', 'ana:contacts:list:upload', 'ana:contacts:list:distribute'],
  campaigns: ['didi_vip'],
  roleNames: ['Líder DIDI VIP'],
  isLeader: true,
};
export const LEADER_PRUEBA: MeAccess = { ...LEADER_DIDI, campaigns: ['prueba'], roleNames: ['Líder Prueba'] };
export const AGENT: MeAccess = {
  permissions: ['ana:chats:conversation:view', 'ana:chats:message:reply'],
  campaigns: ['prueba'],
  roleNames: ['Agente Prueba'],
};

/** Mock de v4 GET /me. `me` puede ser un acceso, una función o 'down' (timeout). */
export function mockV4Me(me: MeAccess | 'down' | (() => Response)) {
  process.env.ANA_V4_API_BASE = V4;
  clearAdminAccessCache();
  const fn = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
    if (url !== `${V4}/me`) throw new Error(`fetch inesperado: ${url}`);
    if (me === 'down') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    if (typeof me === 'function') return me();
    return new Response(JSON.stringify({ access: { username: 'x', roleIds: [], permissions: [], campaigns: [], roleNames: [], isAdmin: false, isLeader: false, ...me } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Evento HTTP API v2 con claims del authorizer JWT. */
export function adminEvent(opts: {
  username?: string;
  token?: string | null;
  path?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
}): AdminEvent {
  const { username = 'erick.silva', token = 'id-token-1' } = opts;
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    pathParameters: opts.path ?? {},
    queryStringParameters: opts.query ?? {},
    body: opts.rawBody ?? (opts.body === undefined ? null : JSON.stringify(opts.body)),
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': username } } } },
  };
}

export const parse = (res: { body: string }) => JSON.parse(res.body);

export const derivedList = (campaign: string, usernames: string[], generatedAt = new Date().toISOString()) =>
  JSON.stringify({
    schemaVersion: 1,
    campaign,
    generatedAt,
    agents: usernames.map((u) => ({ username: u, cognitoUsername: u, roleIds: ['r1'] })),
  });

/** Lista derivada con tipo por integrante (add-supervisor-contact-access). */
export const derivedMembers = (campaign: string, members: Array<[string, 'agent' | 'supervisor']>, generatedAt = new Date().toISOString()) =>
  JSON.stringify({
    schemaVersion: 1,
    campaign,
    generatedAt,
    agents: members.map(([u, kind]) => ({ username: u, cognitoUsername: u, roleIds: ['r1'], kind })),
  });

/** Supervisor de prueba: carga y reparto, sin gestión de agentes. */
export const SUPERVISOR_PRUEBA: MeAccess = {
  permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute', 'ana:campaign:message:send'],
  campaigns: ['prueba'],
  roleNames: ['Supervisor Prueba'],
};
