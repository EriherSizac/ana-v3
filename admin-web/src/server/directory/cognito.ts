import 'server-only';
import { CognitoIdentityProviderClient, ListUsersCommand, type UserType } from '@aws-sdk/client-cognito-identity-provider';
import { serverEnv } from '../env';

/** Usuario del pool (solo lectura: ANA Admin no crea, edita ni borra usuarios). */
export interface PoolUser {
  username: string;
  name: string | null;
  email: string | null;
  enabled: boolean;
  status: string;
}

const CACHE_TTL_MS = 5 * 60_000;
let cache: { users: PoolUser[]; expiresAt: number } | null = null;
let client: CognitoIdentityProviderClient | null = null;

function getClient(): CognitoIdentityProviderClient {
  // Credenciales: cadena por defecto (rol de cómputo del hosting con
  // `cognito-idp:ListUsers` solo sobre el ARN del pool).
  if (!client) client = new CognitoIdentityProviderClient({ region: serverEnv().userPoolRegion });
  return client;
}

/** Solo pruebas. */
export function setCognitoClientForTests(c: CognitoIdentityProviderClient | null): void {
  client = c;
  cache = null;
}

export function invalidatePoolUsers(): void {
  cache = null;
}

const attr = (u: UserType, name: string): string | null => u.Attributes?.find((a) => a.Name === name)?.Value ?? null;

function toPoolUser(u: UserType): PoolUser | null {
  if (!u.Username) return null;
  const given = attr(u, 'given_name');
  const family = attr(u, 'family_name');
  const name = attr(u, 'name') ?? ([given, family].filter(Boolean).join(' ') || null);
  return {
    username: u.Username,
    name,
    email: attr(u, 'email'),
    enabled: u.Enabled !== false,
    status: u.UserStatus ?? 'UNKNOWN',
  };
}

/** `ListUsers` completo (páginas de 60) con caché de 5 min. */
export async function listPoolUsers(): Promise<PoolUser[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.users;
  const users: PoolUser[] = [];
  let token: string | undefined;
  do {
    const out = await getClient().send(
      new ListUsersCommand({ UserPoolId: serverEnv().userPoolId, Limit: 60, PaginationToken: token }),
    );
    for (const u of out.Users ?? []) {
      const p = toPoolUser(u);
      if (p) users.push(p);
    }
    token = out.PaginationToken;
  } while (token);
  users.sort((a, b) => a.username.localeCompare(b.username));
  cache = { users, expiresAt: Date.now() + CACHE_TTL_MS };
  return users;
}
