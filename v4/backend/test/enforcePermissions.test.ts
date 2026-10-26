// Aplicación de permisos (v4-enforce-permissions): modos, mapa ruta → permiso,
// superadmin por rol, "ver como" de equipo, equipo de jobs y roster.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ddbMock, s3Mock } from './helpers';

const roles = vi.hoisted(() => ({ byUser: {} as Record<string, any[]>, calls: [] as string[] }));
const local = vi.hoisted(() => ({ value: new Map<string, string[]>() }));
vi.mock('../src/lib/roles', () => ({
  getUserRoles: async (u: string) => {
    roles.calls.push(u);
    return roles.byUser[u] ?? [];
  },
  listAllRoles: async () => [],
}));
vi.mock('../src/lib/rolePerms', () => ({
  getManyRolePermissions: async () => local.value,
  getRolePermissions: async () => [],
  setRolePermissions: async () => {},
}));
vi.mock('../src/lib/campaignsDb', () => ({
  listCampaignsDb: async () => ['didi_vip', 'bancoppel'],
  campaignExists: async () => true,
}));

import { handler as api } from '../src/handlers/api';
import { handler as jobsPoll } from '../src/handlers/jobsPoll';
import { handler as jobsAdmin } from '../src/handlers/jobsAdmin';
import { handler as interactions } from '../src/handlers/interactions';
import { handler as agents } from '../src/handlers/agents';
import { resolveUserAccess, can } from '../src/lib/access';
import { invalidateByRole } from '../src/lib/accessCache';
import { ANA_PERMISSIONS, ROUTE_PERMISSIONS, isSuperadminRole } from '../src/lib/permissions';

const role = (id: string, name: string, campaign: string, perms: string[] = []) => ({
  role_id: id,
  role_name: name,
  campaign_name: campaign,
  permissions: perms.map((p) => ({ permission_name: p })),
});

// ---- Tablas en memoria ----
let cache: Map<string, any>;
let roster: Map<string, any>; // `${campaign}|${operatorId}`
function installTables() {
  cache = new Map();
  roster = new Map();
  ddbMock.on(GetCommand, { TableName: 'accesscache-test' }).callsFake((i: any) => ({ Item: cache.get(i.Key.username) }));
  ddbMock.on(PutCommand, { TableName: 'accesscache-test' }).callsFake((i: any) => {
    const cur = cache.get(i.Item.username);
    if (i.ConditionExpression && cur?.tombstoneAt !== undefined && !(cur.tombstoneAt < i.ExpressionAttributeValues[':start']))
      throw Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });
    cache.set(i.Item.username, i.Item);
    return {};
  });
  ddbMock.on(ScanCommand, { TableName: 'accesscache-test' }).callsFake((i: any) => ({
    Items: [...cache.values()].filter((x) => (x.roleIds ?? []).includes(i.ExpressionAttributeValues[':r'])).map((x) => ({ username: x.username })),
  }));
  ddbMock.on(GetCommand, { TableName: 'agents-test' }).callsFake((i: any) => ({ Item: roster.get(`${i.Key.campaign}|${i.Key.operatorId}`) }));
  ddbMock.on(QueryCommand, { TableName: 'agents-test' }).callsFake((i: any) => ({
    Items: [...roster.values()].filter((x) => x.campaign === i.ExpressionAttributeValues[':c']),
  }));
  ddbMock.on(QueryCommand, { TableName: 'jobs-test' }).resolves({ Items: [] });
  ddbMock.on(QueryCommand, { TableName: 'conv-test' }).resolves({ Items: [{ chatId: 'c1' }] });
  ddbMock.on(QueryCommand, { TableName: 'msg-test' }).resolves({ Items: [] });
  ddbMock.on(GetCommand, { TableName: 'jobs-test' }).resolves({});
  ddbMock.on(PutCommand, { TableName: 'jobs-test' }).resolves({});
  ddbMock.on(UpdateCommand, { TableName: 'jobs-test' }).resolves({});
  ddbMock.on(GetCommand, { TableName: 'conv-test' }).resolves({});
  ddbMock.on(BatchGetCommand).resolves({ Responses: {} });
  s3Mock.on(GetObjectCommand).rejects(Object.assign(new Error('x'), { name: 'NoSuchKey' }));
}

const ev = (routeKey: string, user: string, opts: { body?: unknown; qs?: Record<string, string>; path?: Record<string, string> } = {}) =>
  ({
    routeKey,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    queryStringParameters: opts.qs,
    pathParameters: opts.path,
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': user } } } },
  }) as any;
const call = async (fn: any, e: any) => {
  const r = await fn(e);
  return { status: r.statusCode as number, body: r.body ? JSON.parse(r.body) : null };
};

let logs: any[];
beforeEach(async () => {
  ddbMock.reset();
  s3Mock.reset();
  installTables();
  await invalidateByRole('__reset_l1__'); // vacía la caché L1 del módulo
  roles.byUser = {};
  roles.calls = [];
  local.value = new Map();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((m: unknown) => {
    try {
      logs.push(JSON.parse(String(m)));
    } catch {
      /* texto */
    }
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Sin red real: cualquier fetch (CRM/roles) falla rápido.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
});
afterEach(() => {
  delete process.env.PERMISSIONS_ENFORCED;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('modos del flag', () => {
  const noView = { username: 'x', roleIds: [], roleNames: [], campaigns: [], permissions: [], isAdmin: false, isLeader: false };

  it('off permite sin log; report permite y registra; true niega', () => {
    expect(can(noView, ANA_PERMISSIONS.CHATS_VIEW, 'GET /conversations')).toBe(true);
    expect(logs).toHaveLength(0);
    process.env.PERMISSIONS_ENFORCED = 'report';
    expect(can(noView, ANA_PERMISSIONS.CHATS_VIEW, 'GET /conversations')).toBe(true);
    expect(logs).toContainEqual({ evt: 'perm_would_deny', route: 'GET /conversations', username: 'x', perm: ANA_PERMISSIONS.CHATS_VIEW });
    process.env.PERMISSIONS_ENFORCED = 'true';
    expect(can(noView, ANA_PERMISSIONS.CHATS_VIEW)).toBe(false);
    expect(can({ ...noView, isAdmin: true }, ANA_PERMISSIONS.CHATS_VIEW)).toBe(true);
  });

  it('enforce: usuario sin ana:chats:conversation:view → GET /conversations 403', async () => {
    process.env.PERMISSIONS_ENFORCED = 'true';
    roles.byUser['ana'] = [role('r1', 'Agente DIDI', 'didi_vip')];
    local.value = new Map([['r1', [`-${ANA_PERMISSIONS.CHATS_VIEW}`]]]);
    expect(await call(api, ev('GET /conversations', 'ana'))).toEqual({ status: 403, body: { error: 'sin permiso' } });
  });

  it('report: usuario sin envío recibe sus jobs y queda perm_would_deny', async () => {
    process.env.PERMISSIONS_ENFORCED = 'report';
    roles.byUser['soporte'] = [role('r9', 'Soporte', 'didi_vip')];
    const r = await call(jobsPoll, ev('GET /jobs/poll', 'soporte'));
    expect(r.status).toBe(200);
    expect(logs).toContainEqual({ evt: 'perm_would_deny', route: 'GET /jobs/poll', username: 'soporte', perm: ANA_PERMISSIONS.CAMPAIGN_SEND });
  });

  it('agente de campaña recibe sus jobs con enforce', async () => {
    process.env.PERMISSIONS_ENFORCED = 'true';
    roles.byUser['ana'] = [role('r1', 'Agente DIDI VIP', 'didi_vip')];
    expect((await call(jobsPoll, ev('GET /jobs/poll', 'ana'))).status).toBe(200);
  });

  it('líder: permisos incluyen envío de campaña y team manage', async () => {
    roles.byUser['lider'] = [role('r2', 'Líder DIDI VIP', 'didi_vip')];
    const a = await resolveUserAccess('lider');
    expect(a.permissions).toEqual(expect.arrayContaining([ANA_PERMISSIONS.CAMPAIGN_SEND, ANA_PERMISSIONS.TEAM_JOBS_MANAGE, ANA_PERMISSIONS.CONTACTS_DISTRIBUTE]));
  });
});

describe('ROUTE_PERMISSIONS: cada ruta 403 con enforce y permite + log con report', () => {
  const handlerOf: Record<string, any> = {
    'GET /conversations': api,
    'GET /conversations/{chatId}/messages': api,
    'GET /media/url': api,
    'GET /jobs/poll': jobsPoll,
    'POST /jobs/ack': jobsPoll,
    'POST /jobs/claim': jobsPoll,
    'POST /interactions/report': interactions,
    'POST /interactions/open': interactions,
    'POST /interactions/manual': interactions,
  };
  const bodyOf: Record<string, unknown> = {
    'POST /jobs/ack': { acks: [] },
    'POST /jobs/claim': { jobId: 'c#1' },
    'POST /interactions/report': { jobId: 'j1', phone: '5512345678', status: 'sent' },
    'POST /interactions/open': { chatId: '5215512345678@c.us' },
    'POST /interactions/manual': { chatId: '5215512345678@c.us', requestId: 'r1' },
  };
  const deniedAll = [
    `-${ANA_PERMISSIONS.CHATS_VIEW}`,
    `-${ANA_PERMISSIONS.CHATS_REPLY}`,
    `-${ANA_PERMISSIONS.CAMPAIGN_SEND}`,
  ];

  it('la tabla cubre las rutas esperadas', () => {
    expect(Object.keys(ROUTE_PERMISSIONS).sort()).toEqual(Object.keys(handlerOf).sort());
  });

  for (const [routeKey, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    it(`${routeKey} (${perm})`, async () => {
      roles.byUser['sinperm'] = [role('r0', 'Soporte', 'didi_vip')];
      local.value = new Map([['r0', deniedAll]]);
      const e = () =>
        ev(routeKey, 'sinperm', {
          body: bodyOf[routeKey],
          qs: routeKey === 'GET /media/url' ? { key: 'media/sinperm/1.jpg' } : undefined,
          path: { chatId: 'c1' },
        });
      process.env.PERMISSIONS_ENFORCED = 'true';
      expect((await call(handlerOf[routeKey], e())).status).toBe(403);
      process.env.PERMISSIONS_ENFORCED = 'report';
      cache.clear();
      logs = [];
      expect((await call(handlerOf[routeKey], e())).status).not.toBe(403);
      expect(logs).toContainEqual({ evt: 'perm_would_deny', route: routeKey, username: 'sinperm', perm });
    });
  }
});

describe('superadmin por rol', () => {
  it('isSuperadminRole', () => {
    for (const n of ['Superadmin', 'Súper Admin', 'super-admin', 'SUPER_ADMIN']) expect(isSuperadminRole(n)).toBe(true);
    for (const n of ['Administrador Zendere', 'Admin', 'Líder DIDI']) expect(isSuperadminRole(n)).toBe(false);
  });

  it('"Súper Admin" → acceso total con roles reales; se registra superadmin_role', async () => {
    roles.byUser['maria'] = [role('rS', 'Súper Admin', 'didi_vip')];
    const a = await resolveUserAccess('maria');
    expect(a).toMatchObject({ campaigns: ['*'], isAdmin: true, isLeader: true, roleIds: ['rS'], roleNames: ['Súper Admin'] });
    expect(a.permissions).toEqual(expect.arrayContaining(Object.values(ANA_PERMISSIONS)));
    expect(logs).toContainEqual({ evt: 'superadmin_role', username: 'maria', role: 'Súper Admin' });
    // Pasa chequeos explícitos: resumen de cualquier campaña.
    expect((await call(jobsAdmin, ev('GET /jobs/summary', 'maria', { qs: { campaign: 'bancoppel' } }))).status).toBe(200);
  });

  it('pierde el rol: tras invalidar por rol (tombstone) deja de tener acceso total', async () => {
    roles.byUser['maria'] = [role('rS', 'Superadmin', 'didi_vip')];
    expect((await resolveUserAccess('maria')).isAdmin).toBe(true);
    expect(cache.get('maria').roleIds).toEqual(['rS']);
    roles.byUser['maria'] = [role('r1', 'Agente DIDI', 'didi_vip')];
    expect((await resolveUserAccess('maria')).isAdmin).toBe(true); // aún en caché
    await invalidateByRole('rS');
    expect(cache.get('maria').tombstoneAt).toBeGreaterThan(0);
    const after = await resolveUserAccess('maria');
    expect(after.isAdmin).toBe(false);
    expect(after.campaigns).toEqual(['didi_vip']);
  });

  it('API de roles caída sin caché → sin superadmin; erick.silva no consulta la API', async () => {
    roles.byUser['maria'] = [];
    expect((await resolveUserAccess('maria')).isAdmin).toBe(false);
    roles.calls = [];
    expect((await resolveUserAccess('erick.silva')).isAdmin).toBe(true);
    expect(roles.calls).toEqual([]);
  });

  it('nombre parecido "Administrador Zendere" → no es superadmin', async () => {
    roles.byUser['pepe'] = [role('rA', 'Administrador Zendere', 'zendere')];
    expect((await resolveUserAccess('pepe')).isAdmin).toBe(false);
  });
});

describe('"ver como" de equipo (sin flag)', () => {
  beforeEach(() => {
    roles.byUser['lider'] = [role('r2', 'Líder DIDI VIP', 'didi_vip')];
    roles.byUser['admin.x'] = [role('rA', 'Admin', '*', [ANA_PERMISSIONS.ADMIN_CONSOLE])];
    roles.byUser['agente2'] = [role('r1', 'Agente DIDI', 'didi_vip')];
    roster.set('didi_vip|agente1', { campaign: 'didi_vip', operatorId: 'agente1' });
    roster.set('bancoppel|agente9', { campaign: 'bancoppel', operatorId: 'agente9' });
  });
  const conv = (user: string, target: string) => call(api, ev('GET /conversations', user, { qs: { operatorId: target } }));

  it('líder con team view ve a su agente', async () => {
    const r = await conv('lider', 'agente1');
    expect(r.status).toBe(200);
    expect(r.body.conversations).toEqual([{ chatId: 'c1' }]);
  });
  it('admin ve a un agente', async () => expect((await conv('admin.x', 'agente1')).status).toBe(200));
  it('agente de otra campaña → 403', async () => expect(await conv('lider', 'agente9')).toEqual({ status: 403, body: { error: 'sin permiso' } }));
  it('agente sin team view → 403', async () => expect((await conv('agente2', 'agente1')).status).toBe(403));
  it('media de su agente (mismo chequeo)', async () => {
    const r = await call(api, ev('GET /media/url', 'lider', { qs: { key: 'media/agente1/1.jpg' } }));
    expect(r.status).toBe(200);
  });
});

describe('equipo de jobs y roster', () => {
  beforeEach(() => {
    roles.byUser['lider'] = [role('r2', 'Líder DIDI VIP', 'didi_vip')];
    roles.byUser['super'] = [role('r3', 'Supervisor DIDI', 'didi_vip', [ANA_PERMISSIONS.TEAM_JOBS_VIEW])];
    roles.byUser['agente'] = [role('r1', 'Agente DIDI', 'didi_vip')];
    roster.set('didi_vip|agente1', { campaign: 'didi_vip', operatorId: 'agente1', lastSeen: 1 });
  });

  it('líder de otra campaña → 403', async () => {
    expect(await call(jobsAdmin, ev('GET /jobs/summary', 'lider', { qs: { campaign: 'bancoppel' } }))).toEqual({ status: 403, body: { error: 'sin permiso' } });
  });
  it('no líder con ana:team:jobs:view → 200 en su campaña', async () => {
    expect((await call(jobsAdmin, ev('GET /jobs/summary', 'super', { qs: { campaign: 'didi_vip' } }))).status).toBe(200);
  });
  it('ver sin poder mover → reassign 403', async () => {
    const r = await call(jobsAdmin, ev('POST /jobs/reassign', 'super', { body: { campaign: 'didi_vip', from: 'a1', to: 'a2' } }));
    expect(r).toEqual({ status: 403, body: { error: 'sin permiso' } });
  });
  it('GET /agents: agente sin permisos de equipo → 403; líder → roster', async () => {
    expect(await call(agents, ev('GET /agents', 'agente'))).toEqual({ status: 403, body: { error: 'sin permiso' } });
    const r = await call(agents, ev('GET /agents', 'lider'));
    expect(r.status).toBe(200);
    expect(r.body.agents.map((a: any) => a.operatorId)).toEqual(['agente1']);
  });
});

describe('serverless.yml: parámetro permissionsEnforced', () => {
  it('PERMISSIONS_ENFORCED sale del parámetro (default false)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const text = readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8');
    expect(text).toContain("PERMISSIONS_ENFORCED: ${param:permissionsEnforced, 'false'}");
    expect(text).toMatch(/'report'.*perm_would_deny/);
  });
});
