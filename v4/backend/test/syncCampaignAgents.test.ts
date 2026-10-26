import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

vi.mock('../src/lib/db', () => ({ db: () => ({ query: async () => ({ rows: [] }) }) }));
vi.mock('../src/lib/rolePerms', () => ({ getManyRolePermissions: async () => new Map() }));

import { runSync } from '../src/handlers/syncCampaignAgents';
import type { DeriveDeps } from '../src/lib/campaignAgents';

const okDeps = (over: Partial<DeriveDeps> = {}): DeriveDeps => ({
  listPoolUsers: async () => [{ username: 'ana', enabled: true, status: 'CONFIRMED' }],
  listDirectoryUsers: async () => [{ username: 'ana', roles: [{ role_id: 'r1', role_name: 'Agente P', campaign_name: 'prueba' }] }],
  getUserRoles: async () => [{ role_id: 'r1', role_name: 'Agente P', campaign_name: 'prueba' }],
  getRolePermissions: async () => new Map(),
  listCatalog: async () => ['prueba', 'ventas'],
  ...over,
});

describe('syncCampaignAgents', () => {
  it('escribe una lista por campaña del catálogo (incluida la vacía)', async () => {
    const write = vi.fn(async () => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await runSync({ derive: okDeps(), write });
    expect(write).toHaveBeenCalledTimes(2);
    const lists = write.mock.calls.map((c: any[]) => c[0]);
    expect(lists.find((l: any) => l.campaign === 'ventas').agents).toEqual([]);
    expect(r).toEqual({ campaigns: 2, agents: 1 });
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ evt: 'agent_sync', status: 'ok' });
    log.mockRestore();
  });

  it.each([
    ['GET /users', { listDirectoryUsers: async () => { throw new Error('5xx'); } }],
    ['ListUsers', { listPoolUsers: async () => { throw new Error('throttled'); } }],
    ['GET /users/{username}', { getUserRoles: async () => { throw new Error('5xx'); } }],
    ['catálogo', { listCatalog: async () => { throw new Error('pg'); } }],
    ['almacén de permisos', { getRolePermissions: async () => { throw new Error('ddb'); } }],
  ])('fallo de %s → cero PutObject, log failed y error', async (_n, over) => {
    const write = vi.fn(async () => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runSync({ derive: okDeps(over as Partial<DeriveDeps>), write })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(JSON.parse(err.mock.calls[0]![0] as string)).toMatchObject({ evt: 'agent_sync', status: 'failed' });
    err.mockRestore();
  });
});

// `serverless package` exige login en Serverless v4: se verifica la plantilla.
const cfnTags = ['!Sub', '!GetAtt', '!Ref'].map((tag) => ({
  tag,
  resolve: (v: string) => ({ [tag.slice(1)]: v }),
}));
const sls = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'), { customTags: cfnTags as any });

describe('serverless.yml: alcance de escritura de la sincronización', () => {
  const role = sls.resources.Resources.SyncCampaignAgentsRole;
  const stmts: any[] = role.Properties.Policies.flatMap((p: any) => p.PolicyDocument.Statement);

  it('la función usa su propio rol y corre cada 5 minutos', () => {
    const fn = sls.functions.syncCampaignAgents;
    expect(fn.role).toBe('SyncCampaignAgentsRole');
    expect(fn.events[0].schedule.rate).toBe('rate(5 minutes)');
  });

  it('solo s3:PutObject sobre campaign-agents/* del bucket de v3', () => {
    const s3 = stmts.filter((s) => s.Action.some((a: string) => a.startsWith('s3:')));
    expect(s3).toHaveLength(1);
    expect(s3[0].Action).toEqual(['s3:PutObject']);
    expect(s3[0].Resource).toEqual(['arn:aws:s3:::${self:custom.v3Bucket}/campaign-agents/*']);
    expect(sls.custom.v3BucketDefault).toBe('ana-backend-storage-${self:provider.stage}');
  });

  it('cognito-idp:ListUsers solo sobre el ARN del pool', () => {
    const c = stmts.find((s) => s.Action.includes('cognito-idp:ListUsers'));
    expect(c.Action).toEqual(['cognito-idp:ListUsers']);
    expect(JSON.stringify(c.Resource)).toContain('userpool/${self:custom.userPoolId}');
    expect(sls.custom.userPoolId).toBe('us-east-2_UepfOyKpd');
  });

  it('el rol compartido no puede escribir campaign-agents/ (solo leer)', () => {
    const shared: any[] = sls.provider.iam.role.statements;
    const onV3 = shared.filter((s) => JSON.stringify(s.Resource).includes('campaign-agents'));
    expect(onV3).toHaveLength(1);
    expect(onV3[0].Action).toEqual(['s3:GetObject']);
  });

  it('alarma tras 3 fallos seguidos', () => {
    const a = sls.resources.Resources.SyncCampaignAgentsFailureAlarm.Properties;
    expect(a).toMatchObject({ MetricName: 'Errors', Period: 300, EvaluationPeriods: 3, DatapointsToAlarm: 3, Threshold: 1 });
  });

  it('rutas /admin/agent-roster con el authorizer JWT', () => {
    const ev = sls.functions.agents.events.map((e: any) => e.httpApi).filter((h: any) => h.path === '/admin/agent-roster');
    expect(ev.map((h: any) => h.method).sort()).toEqual(['get', 'post']);
    for (const h of ev) expect(h.authorizer.name).toBe('cognitoJwt');
  });
});
