import { generateKeyPairSync, createSign, type KeyObject } from 'crypto';
import { getAgentVerifier, resetAgentVerifier } from '../../src/lib/agentAuth';
import { clearRosterReaderCache } from '../../src/lib/roster';

/**
 * Tokens de prueba firmados con una llave RSA propia y un JWKS precargado en
 * el verificador (`cacheJwks`), sin red.
 */
export const POOL_ID = 'us-east-2_TestPool1';
export const CLI_CLIENT = 'cli-client-test';
export const OTHER_CLIENT = 'v4-client-test';
export const ISSUER = `https://cognito-idp.us-east-2.amazonaws.com/${POOL_ID}`;
const KID = 'test-kid-1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const jwk = (key: KeyObject) => ({ ...(key.export({ format: 'jwk' }) as Record<string, string>), kid: KID, alg: 'RS256', use: 'sig' });
export const JWKS = { keys: [jwk(publicKey)] };

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

export interface SignOptions {
  /** Firmar con una llave distinta a la del JWKS (firma alterada). */
  wrongKey?: boolean;
}

/** ID token del pool para el client del CLI; `claims` sobrescribe. */
export function signIdToken(claims: Record<string, unknown> = {}, opts: SignOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: '11111111-2222-3333-4444-555555555555',
    iss: ISSUER,
    aud: CLI_CLIENT,
    token_use: 'id',
    auth_time: now,
    iat: now,
    exp: now + 3600,
    'cognito:username': 'erick',
    ...claims,
  };
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  const sig = signer.sign(opts.wrongKey ? other.privateKey : privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

/** Configura el entorno de agentAuth y precarga el JWKS. */
export function setupAgentAuth(opts: { enforced?: boolean; clients?: string; pool?: string } = {}): void {
  process.env.AGENT_AUTH_ENFORCED = opts.enforced ? 'true' : 'false';
  process.env.COGNITO_USER_POOL_ID = opts.pool ?? POOL_ID;
  process.env.COGNITO_AGENT_CLIENT_IDS = opts.clients ?? CLI_CLIENT;
  resetAgentVerifier();
  clearRosterReaderCache();
  getAgentVerifier()?.cacheJwks(JWKS as any);
}

export const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

/** Captura las líneas `agent_auth` escritas en stdout. */
export function captureAuthLogs(spy: { mock: { calls: unknown[][] } }): any[] {
  return spy.mock.calls
    .map((c) => String(c[0]))
    .filter((l) => l.includes('"evt":"agent_auth"'))
    .map((l) => JSON.parse(l));
}
