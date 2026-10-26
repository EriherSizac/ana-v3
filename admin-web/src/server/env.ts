import 'server-only';

/**
 * Variables de entorno del BFF. Las de servidor nunca llevan prefijo
 * NEXT_PUBLIC_ (no deben llegar al bundle del navegador).
 */
export const SERVER_ENV_VARS = [
  'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
  'COGNITO_ALLOWED_CLIENT_IDS',
  'ANA_V4_API_BASE',
  'ANA_V3_API_BASE',
  'ROLES_API_BASE',
  'ROLES_API_KEY',
] as const;

export type ServerEnvVar = (typeof SERVER_ENV_VARS)[number];

export interface ServerEnv {
  userPoolId: string;
  allowedClientIds: string[];
  v4ApiBase: string;
  v3ApiBase: string;
  rolesApiBase: string;
  rolesApiKey: string;
  /** Región del pool (prefijo del id, p. ej. `us-east-2`). */
  userPoolRegion: string;
}

export class EnvError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Faltan variables de entorno del servidor: ${missing.join(', ')}`);
    this.name = 'EnvError';
  }
}

const trimSlash = (v: string) => v.replace(/\/+$/, '');

/** Valida y devuelve el entorno del servidor. Lanza EnvError si falta algo. */
export function validateEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const missing: string[] = SERVER_ENV_VARS.filter((k) => !(source[k] ?? '').trim());
  const allowedClientIds = (source.COGNITO_ALLOWED_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if ((source.COGNITO_ALLOWED_CLIENT_IDS ?? '').trim() && allowedClientIds.length === 0) {
    missing.push('COGNITO_ALLOWED_CLIENT_IDS');
  }
  if (missing.length > 0) throw new EnvError([...new Set(missing)]);
  const userPoolId = source.NEXT_PUBLIC_COGNITO_USER_POOL_ID!.trim();
  return {
    userPoolId,
    userPoolRegion: userPoolId.split('_')[0] ?? 'us-east-2',
    allowedClientIds,
    v4ApiBase: trimSlash(source.ANA_V4_API_BASE!.trim()),
    v3ApiBase: trimSlash(source.ANA_V3_API_BASE!.trim()),
    rolesApiBase: trimSlash(source.ROLES_API_BASE!.trim()),
    rolesApiKey: source.ROLES_API_KEY!.trim(),
  };
}

let cached: ServerEnv | null = null;

/** Entorno validado (memoizado). */
export function serverEnv(): ServerEnv {
  if (!cached) cached = validateEnv();
  return cached;
}

/** Solo para pruebas. */
export function resetServerEnvForTests(): void {
  cached = null;
}
