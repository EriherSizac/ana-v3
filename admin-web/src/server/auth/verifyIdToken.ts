import 'server-only';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { serverEnv } from '../env';
import { HttpError } from '../errors';

export interface VerifiedIdentity {
  username: string;
  token: string;
  clientId: string;
}

export type IdTokenVerifier = {
  verify: (token: string) => Promise<Record<string, unknown>>;
};

let verifier: IdTokenVerifier | null = null;

/** Crea el verificador de id tokens del pool (JWKS cacheado por aws-jwt-verify). */
export function createVerifier(userPoolId: string, allowedClientIds: string[]) {
  return CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'id',
    clientId: allowedClientIds,
  });
}

function getVerifier(): IdTokenVerifier {
  if (!verifier) {
    const env = serverEnv();
    const v = createVerifier(env.userPoolId, env.allowedClientIds);
    verifier = { verify: (t) => v.verify(t) as unknown as Promise<Record<string, unknown>> };
  }
  return verifier;
}

/** Solo pruebas: inyecta un verificador (p. ej. con JWKS de prueba). */
export function setVerifierForTests(v: IdTokenVerifier | null): void {
  verifier = v;
}

export function bearerToken(req: Request): string | null {
  const h = (req.headers.get('authorization') ?? '').trim();
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m?.[1] ?? null;
}

/**
 * Verifica firma (JWKS del pool), emisor, `token_use=id`, expiración y `aud`
 * en la allowlist. Lanza HttpError(unauthenticated) ante cualquier fallo.
 */
export async function verifyRequest(req: Request): Promise<VerifiedIdentity> {
  const token = bearerToken(req);
  if (!token) throw new HttpError('unauthenticated');
  let payload: Record<string, unknown>;
  try {
    payload = await getVerifier().verify(token);
  } catch {
    throw new HttpError('unauthenticated');
  }
  const username = payload['cognito:username'];
  if (typeof username !== 'string' || !username) throw new HttpError('unauthenticated');
  return { username, token, clientId: String(payload.aud ?? '') };
}
