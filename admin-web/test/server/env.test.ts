// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EnvError, validateEnv } from '@/server/env';

const full = {
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'us-east-2_UepfOyKpd',
  COGNITO_ALLOWED_CLIENT_IDS: '1r6niimhkl2fmias6kk85n4ou4, otro',
  ANA_V4_API_BASE: 'https://v4.example/',
  ANA_V3_API_BASE: 'https://v3.example',
  ROLES_API_BASE: 'https://roles.example',
  ROLES_API_KEY: 'k',
};

describe('validateEnv', () => {
  it('devuelve el entorno normalizado', () => {
    const env = validateEnv(full);
    expect(env.allowedClientIds).toEqual(['1r6niimhkl2fmias6kk85n4ou4', 'otro']);
    expect(env.v4ApiBase).toBe('https://v4.example');
    expect(env.userPoolRegion).toBe('us-east-2');
  });

  it('falla si falta una variable de servidor', () => {
    const { ROLES_API_KEY: _omit, ...rest } = full;
    expect(() => validateEnv(rest)).toThrow(EnvError);
    try {
      validateEnv({ ...rest, ANA_V4_API_BASE: '  ' });
    } catch (e) {
      expect((e as EnvError).missing).toEqual(expect.arrayContaining(['ROLES_API_KEY', 'ANA_V4_API_BASE']));
    }
  });

  it('falla si la allowlist queda vacía', () => {
    expect(() => validateEnv({ ...full, COGNITO_ALLOWED_CLIENT_IDS: ' , ' })).toThrow(/COGNITO_ALLOWED_CLIENT_IDS/);
  });
});
