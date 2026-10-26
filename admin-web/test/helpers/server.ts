import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { clearAccessCache } from '@/server/access/resolveAccess';
import { resetServerEnvForTests } from '@/server/env';
import { installTestVerifier, signToken } from './jwt';

/** Carga los valores FALSOS de .env.test en process.env. */
export function loadTestEnv(): Record<string, string> {
  const text = readFileSync(join(__dirname, '..', '..', '.env.test'), 'utf8');
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i)] = line.slice(i + 1);
  }
  Object.assign(process.env, env);
  resetServerEnvForTests();
  return env;
}

export const V4 = 'https://v4.test.invalid';
export const V3 = 'https://v3.test.invalid';
export const ROLES = 'https://roles.test.invalid';

export interface MeAccess {
  username?: string;
  permissions?: string[];
  campaigns?: string[];
  roleNames?: string[];
  isAdmin?: boolean;
  isLeader?: boolean;
}

export const LEADER: MeAccess = {
  permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute', 'ana:admin:agents:manage', 'ana:chats:conversation:view'],
  campaigns: ['didi_vip'],
  roleNames: ['Líder Didi VIP'],
  isAdmin: false,
  isLeader: true,
};

export const AGENT: MeAccess = {
  permissions: ['ana:chats:conversation:view', 'ana:chats:message:reply'],
  campaigns: ['didi_vip'],
  roleNames: ['Agente Didi VIP'],
  isAdmin: false,
  isLeader: false,
};

export const ADMIN: MeAccess = {
  permissions: ['ana:admin:console:manage', 'ana:admin:agents:manage', 'ana:contacts:list:upload', 'ana:contacts:list:distribute'],
  campaigns: ['didi_vip'],
  roleNames: ['Administrador'],
  isAdmin: true,
  isLeader: false,
};

export const DEVELOPER: MeAccess = {
  permissions: ['ana:chats:conversation:view'],
  campaigns: ['*'],
  roleNames: ['Developer'],
  isAdmin: false,
  isLeader: false,
};

export type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

/**
 * Mock de fetch: `me` responde v4 `/me`; `routes` maneja el resto por
 * "MÉTODO host+ruta". Registra todas las llamadas.
 */
export function mockFetch(me: MeAccess | (() => Response | Promise<Response>), routes: Record<string, Route> = {}) {
  const calls: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url: url.href, method, headers: new Headers(init.headers), body: typeof init.body === 'string' ? init.body : undefined });
    if (url.origin === V4 && url.pathname === '/me') {
      if (typeof me === 'function') return me();
      return Response.json({ access: { username: 'x', roleIds: [], ...me } });
    }
    const key = `${method} ${url.origin}${url.pathname}`;
    const handler = routes[key];
    if (!handler) return Response.json({ error: `sin mock: ${key}` }, { status: 599 });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function setupServerTest(): void {
  loadTestEnv();
  installTestVerifier();
  clearAccessCache();
}

export function authedRequest(path: string, init: RequestInit & { token?: string } = {}): Request {
  const { token = signToken(), ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`http://localhost${path}`, { ...rest, headers });
}

export const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });

export async function bodyOf(res: Response): Promise<any> {
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
