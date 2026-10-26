import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Verificación estática de serverless.yml (no se puede correr `serverless
 * package` sin credenciales de Serverless): toda ruta /admin/* usa el
 * authorizer `cognitoAdminJwt` con el emisor del pool y el client de ANA Admin.
 */
const cfg = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'));

const httpEvents = () =>
  Object.entries<any>(cfg.functions).flatMap(([name, fn]) =>
    (fn.events ?? []).filter((e: any) => e.httpApi).map((e: any) => ({ name, ...e.httpApi })),
  );

describe('serverless.yml: rutas /admin/*', () => {
  it('declara el authorizer cognitoAdminJwt con emisor del pool y audiencia de ANA Admin', () => {
    const a = cfg.provider.httpApi.authorizers.cognitoAdminJwt;
    expect(a.type).toBe('jwt');
    expect(a.identitySource).toBe('$request.header.Authorization');
    expect(a.issuerUrl).toBe('https://cognito-idp.us-east-2.amazonaws.com/us-east-2_UepfOyKpd');
    expect(a.audience).toEqual(["${env:COGNITO_ADMIN_CLIENT_IDS, '1r6niimhkl2fmias6kk85n4ou4'}"]);
    expect(JSON.stringify(a.audience)).not.toMatch(/AGENT|ana-v3-cli/i);
  });

  it('toda ruta /admin/ lleva cognitoAdminJwt', () => {
    const admin = httpEvents().filter((e) => String(e.path).startsWith('/admin/'));
    expect(admin.length).toBeGreaterThanOrEqual(2);
    for (const e of admin) expect(e.authorizer?.name, `${e.name} ${e.path}`).toBe('cognitoAdminJwt');
  });

  it('variables de entorno para la autorización', () => {
    expect(cfg.provider.environment.ANA_V4_API_BASE).toContain('ANA_V4_API_BASE');
  });
});
