import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createVerifier, setVerifierForTests } from '@/server/auth/verifyIdToken';

export const POOL_ID = 'us-east-2_UepfOyKpd';
export const CLIENT_ID = '1r6niimhkl2fmias6kk85n4ou4';
export const ISSUER = `https://cognito-idp.us-east-2.amazonaws.com/${POOL_ID}`;
const KID = 'test-kid-1';

let keys: { privateKey: KeyObject; jwk: Record<string, unknown> } | null = null;

function getKeys() {
  if (!keys) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: KID, alg: 'RS256', use: 'sig' };
    keys = { privateKey, jwk };
  }
  return keys;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

export interface TokenOpts {
  username?: string;
  aud?: string;
  tokenUse?: 'id' | 'access';
  expiresIn?: number;
  issuer?: string;
}

/** Firma un JWT RS256 con la llave de prueba (JWKS de prueba). */
export function signToken(opts: TokenOpts = {}): string {
  const { privateKey } = getKeys();
  const now = Math.floor(Date.now() / 1000);
  const tokenUse = opts.tokenUse ?? 'id';
  const payload: Record<string, unknown> = {
    sub: '00000000-0000-0000-0000-000000000000',
    iss: opts.issuer ?? ISSUER,
    token_use: tokenUse,
    iat: now - 10,
    auth_time: now - 10,
    exp: now + (opts.expiresIn ?? 3600),
    'cognito:username': opts.username ?? 'lider.didi',
  };
  if (tokenUse === 'id') payload.aud = opts.aud ?? CLIENT_ID;
  else payload.client_id = opts.aud ?? CLIENT_ID;
  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256').update(data).sign(privateKey);
  return `${data}.${b64url(sig)}`;
}

/** Instala un verificador real de aws-jwt-verify con el JWKS de prueba en caché. */
export function installTestVerifier(allowed: string[] = [CLIENT_ID]): void {
  const v = createVerifier(POOL_ID, allowed);
  v.cacheJwks({ keys: [getKeys().jwk as never] });
  setVerifierForTests({ verify: (t) => v.verify(t) as unknown as Promise<Record<string, unknown>> });
}
