// Configuración remota del desktop v4 (v4-add-desktop-remote-settings).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddbMock } from './helpers';

const roles = vi.hoisted(() => ({ byUser: {} as Record<string, any[]> }));
vi.mock('../src/lib/roles', () => ({ getUserRoles: async (u: string) => roles.byUser[u] ?? [], listAllRoles: async () => [] }));
vi.mock('../src/lib/rolePerms', () => ({ getManyRolePermissions: async () => new Map() }));
vi.mock('../src/lib/accessCache', () => ({ getCached: async () => null, putCached: async () => {} }));
vi.mock('../src/lib/campaignsDb', () => ({ listCampaignsDb: async () => [], campaignExists: async () => true }));

import { handler } from '../src/handlers/settings';
import { handler as api } from '../src/handlers/api';
import { resolveUserAccess } from '../src/lib/access';
import { effectiveSettings, validateUpdate } from '../src/lib/desktopSettings';

const role = (id: string, name: string, perms: string[] = []) => ({
  role_id: id,
  role_name: name,
  campaign_name: 'didi_vip',
  permissions: perms.map((p) => ({ permission_name: p })),
});

let item: any;
function installTable() {
  item = undefined;
  ddbMock.on(GetCommand, { TableName: 'roleperms-test' }).callsFake(() => ({ Item: item }));
  ddbMock.on(PutCommand, { TableName: 'roleperms-test' }).callsFake((i: any) => {
    const ok =
      i.ConditionExpression === 'attribute_not_exists(PK)'
        ? item === undefined
        : item !== undefined && item.version === i.ExpressionAttributeValues[':v'];
    if (!ok) throw Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });
    item = i.Item;
    return {};
  });
}

const call = async (routeKey: string, user: string, body?: unknown) => {
  const r: any = await handler({
    routeKey,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': user } } } },
  } as any);
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

beforeEach(() => {
  ddbMock.reset();
  installTable();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  roles.byUser = {
    dev: [role('rD', 'Developer')],
    admin: [role('rA', 'Administrador', ['ana:admin:console:manage'])],
    agente: [role('r1', 'Agente DIDI')],
  };
});

describe('lib/desktopSettings', () => {
  it('sin configuración → defaults (openChatInteraction false)', () => {
    expect(effectiveSettings(null)).toEqual({ sendMinGapSeconds: 120, sendMaxPerWindow: 7, sendWindowMinutes: 20, openChatInteraction: false });
  });
  it('guardado fuera de límites o de tipo → default', () => {
    expect(effectiveSettings({ values: { sendMinGapSeconds: 5, sendMaxPerWindow: '9', openChatInteraction: true } })).toEqual({
      sendMinGapSeconds: 120,
      sendMaxPerWindow: 7,
      sendWindowMinutes: 20,
      openChatInteraction: true,
    });
  });
  it('validación: llave desconocida, límites exactos', () => {
    expect(validateUpdate({ foo: 1 })).toEqual({ ok: false, error: 'configuración desconocida: foo' });
    expect(validateUpdate({ sendMinGapSeconds: 60 }).ok).toBe(true);
    expect(validateUpdate({ sendMinGapSeconds: 600 }).ok).toBe(true);
    expect(validateUpdate({ sendMinGapSeconds: 59 })).toEqual({ ok: false, error: 'valor inválido: sendMinGapSeconds' });
    expect(validateUpdate({ sendMinGapSeconds: 120.5 }).ok).toBe(false);
    expect(validateUpdate({ openChatInteraction: 'true' }).ok).toBe(false);
  });
});

describe('isDeveloper', () => {
  it('"Developer" y "developer backend" sí; "Desarrollador" no; sin permisos ana:* extra', async () => {
    roles.byUser = {
      a: [role('r1', 'Developer')],
      b: [role('r2', 'developer backend')],
      c: [role('r3', 'Desarrollador')],
    };
    const a = await resolveUserAccess('a');
    expect(a.isDeveloper).toBe(true);
    expect((await resolveUserAccess('b')).isDeveloper).toBe(true);
    expect((await resolveUserAccess('c')).isDeveloper).toBe(false);
    expect(a.permissions.sort()).toEqual(['ana:chats:conversation:view', 'ana:chats:message:reply']);
    expect(a.isAdmin).toBe(false);
  });

  it('GET /me incluye isDeveloper', async () => {
    const r: any = await api({ routeKey: 'GET /me', requestContext: { authorizer: { jwt: { claims: { 'cognito:username': 'dev' } } } } } as any);
    expect(JSON.parse(r.body).access.isDeveloper).toBe(true);
  });
});

describe('rutas', () => {
  it('primera consulta: cuatro llaves con defaults y updatedBy null', async () => {
    const r = await call('GET /admin/desktop-settings', 'dev');
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(0);
    expect(r.body.settings.map((s: any) => s.key)).toEqual(['sendMinGapSeconds', 'sendMaxPerWindow', 'sendWindowMinutes', 'openChatInteraction']);
    expect(r.body.settings[0]).toEqual({
      key: 'sendMinGapSeconds',
      label: 'Separación mínima entre mensajes (segundos)',
      description: expect.any(String),
      type: 'integer',
      min: 60,
      max: 600,
      default: 120,
      value: 120,
      updatedBy: null,
      updatedAt: null,
    });
  });

  it('admin sin Developer → 403 en GET y PUT, sin cambios', async () => {
    expect(await call('GET /admin/desktop-settings', 'admin')).toEqual({ status: 403, body: { error: 'sin permiso' } });
    expect((await call('PUT /admin/desktop-settings', 'admin', { version: 0, values: { sendMaxPerWindow: 5 } })).status).toBe(403);
    expect(item).toBeUndefined();
  });

  it('cambiar el ritmo: version 3 → 4 con autor y fecha', async () => {
    item = { PK: 'CONFIG', SK: 'DESKTOP_SETTINGS', schemaVersion: 1, version: 3, values: { sendMaxPerWindow: 5 }, audit: {} };
    const r = await call('PUT /admin/desktop-settings', 'dev', { version: 3, values: { sendMinGapSeconds: 180 } });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(4);
    const gap = r.body.settings.find((s: any) => s.key === 'sendMinGapSeconds');
    expect(gap).toMatchObject({ value: 180, updatedBy: 'dev' });
    expect(gap.updatedAt).toMatch(/^\d{4}-/);
    expect(r.body.settings.find((s: any) => s.key === 'sendMaxPerWindow').value).toBe(5);
  });

  it('fuera de límites → 400; llave desconocida → 400; sin escribir', async () => {
    expect(await call('PUT /admin/desktop-settings', 'dev', { version: 0, values: { sendMinGapSeconds: 10 } })).toEqual({
      status: 400,
      body: { error: 'valor inválido: sendMinGapSeconds' },
    });
    expect(await call('PUT /admin/desktop-settings', 'dev', { version: 0, values: { foo: 1 } })).toEqual({
      status: 400,
      body: { error: 'configuración desconocida: foo' },
    });
    expect(item).toBeUndefined();
  });

  it('edición concurrente: el segundo con la misma versión recibe 409', async () => {
    expect((await call('PUT /admin/desktop-settings', 'dev', { version: 0, values: { sendMaxPerWindow: 5 } })).status).toBe(200);
    expect(await call('PUT /admin/desktop-settings', 'dev', { version: 0, values: { sendMaxPerWindow: 6 } })).toEqual({
      status: 409,
      body: { error: 'la configuración cambió' },
    });
    expect(item.values.sendMaxPerWindow).toBe(5);
  });

  it('GET /settings para cualquier autenticado', async () => {
    const r = await call('GET /settings', 'agente');
    expect(r).toEqual({
      status: 200,
      body: { version: 0, values: { sendMinGapSeconds: 120, sendMaxPerWindow: 7, sendWindowMinutes: 20, openChatInteraction: false } },
    });
  });
});

describe('serverless.yml', () => {
  it('rutas con authorizer JWT', () => {
    const tags = ['!Sub', '!GetAtt', '!Ref'].map((tag) => ({ tag, resolve: (v: string) => ({ [tag.slice(1)]: v }) }));
    const sls = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'), { customTags: tags as any });
    const routes = sls.functions.settings.events.map((e: any) => e.httpApi);
    const jwt = { name: 'cognitoJwt' };
    expect(routes).toEqual([
      { path: '/settings', method: 'get', authorizer: jwt },
      { path: '/admin/desktop-settings', method: 'get', authorizer: jwt },
      { path: '/admin/desktop-settings', method: 'put', authorizer: jwt },
    ]);
  });
});
