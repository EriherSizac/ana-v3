import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/db', () => ({ db: () => ({ query: async () => ({ rows: [] }) }) }));
vi.mock('../src/lib/rolePerms', () => ({ getManyRolePermissions: async () => new Map() }));

import { deriveCampaignAgents, normalizeRole, type DeriveDeps, type PoolUser } from '../src/lib/campaignAgents';
import { ANA_PERMISSIONS } from '../src/lib/permissions';

const SEND = ANA_PERMISSIONS.CAMPAIGN_SEND;
const NOW = new Date('2026-10-26T12:00:00Z');

interface Fixture {
  pool: PoolUser[];
  // forma de GET /users: id/name/campaign
  directory: { username: string; roles: { id: string; name: string; campaign: string }[] }[];
  // forma de GET /users/{username}: role_id/role_name/campaign_name + inline
  detail: Record<string, { role_id: string; role_name: string; campaign_name: string; permissions?: { permission_name: string }[] }[]>;
  local?: Record<string, string[]>;
  catalog?: string[];
}

function deps(f: Fixture, over: Partial<DeriveDeps> = {}) {
  const getUserRoles = vi.fn(async (u: string) => {
    const r = f.detail[u.toLowerCase()];
    if (!r) throw new Error('404');
    return r;
  });
  const getRolePermissions = vi.fn(async (ids: string[]) => new Map(ids.filter((i) => f.local?.[i]).map((i) => [i, f.local![i]!])));
  const d: DeriveDeps = {
    listPoolUsers: async () => f.pool,
    listDirectoryUsers: async () => f.directory.map((u) => ({ username: u.username, roles: u.roles.map(normalizeRole) })),
    getUserRoles,
    getRolePermissions,
    listCatalog: async () => f.catalog ?? ['didi_vip', 'prueba', 'ventas'],
    now: () => NOW,
    ...over,
  };
  return { d, getUserRoles, getRolePermissions };
}

const confirmed = (username: string): PoolUser => ({ username, enabled: true, status: 'CONFIRMED' });

const agentsOf = (lists: Awaited<ReturnType<typeof deriveCampaignAgents>>['lists'], c: string) =>
  lists.find((l) => l.campaign === c)!.agents.map((a) => a.username);

describe('deriveCampaignAgents (design D11)', () => {
  it('agente con rol "Agente DIDI VIP" (campaign DIDI_VIP) sin configuración → agente de didi_vip', async () => {
    const { d } = deps({
      pool: [confirmed('Ana.Lopez')],
      directory: [{ username: 'ana.lopez', roles: [{ id: 'r1', name: 'Agente DIDI VIP', campaign: 'DIDI_VIP' }] }],
      detail: { 'ana.lopez': [{ role_id: 'r1', role_name: 'Agente DIDI VIP', campaign_name: 'DIDI_VIP' }] },
    });
    const { lists } = await deriveCampaignAgents(d);
    const l = lists.find((x) => x.campaign === 'didi_vip')!;
    expect(l).toMatchObject({ schemaVersion: 1, generatedAt: NOW.toISOString() });
    expect(l.agents).toEqual([{ username: 'ana.lopez', cognitoUsername: 'Ana.Lopez', roleIds: ['r1'] }]);
  });

  it('nombre en minúsculas o sin acento también es rol de agente', async () => {
    const { d } = deps({
      pool: [confirmed('a'), confirmed('b')],
      directory: [
        { username: 'a', roles: [{ id: 'r1', name: 'agente prueba', campaign: 'prueba' }] },
        { username: 'b', roles: [{ id: 'r2', name: 'AGENTE Prueba', campaign: 'prueba' }] },
      ],
      detail: {
        a: [{ role_id: 'r1', role_name: 'agente prueba', campaign_name: 'prueba' }],
        b: [{ role_id: 'r2', role_name: 'AGENTE Prueba', campaign_name: 'prueba' }],
      },
    });
    expect(agentsOf((await deriveCampaignAgents(d)).lists, 'prueba')).toEqual(['a', 'b']);
  });

  it('líder no es agente', async () => {
    const { d } = deps({
      pool: [confirmed('luis')],
      directory: [{ username: 'luis', roles: [{ id: 'r1', name: 'Líder DIDI VIP', campaign: 'didi_vip' }] }],
      detail: { luis: [{ role_id: 'r1', role_name: 'Líder DIDI VIP', campaign_name: 'didi_vip' }] },
    });
    expect(agentsOf((await deriveCampaignAgents(d)).lists, 'didi_vip')).toEqual([]);
  });

  it('rol global * no hace agente y no se consulta su detalle', async () => {
    const { d, getUserRoles } = deps({
      pool: [confirmed('erick.silva')],
      directory: [{ username: 'erick.silva', roles: [{ id: 'r1', name: 'Agente Global', campaign: '*' }] }],
      detail: { 'erick.silva': [{ role_id: 'r1', role_name: 'Agente Global', campaign_name: '*' }] },
    });
    const { lists } = await deriveCampaignAgents(d);
    expect(lists.every((l) => l.agents.length === 0)).toBe(true);
    expect(getUserRoles).not.toHaveBeenCalled();
  });

  it.each([
    [{ enabled: false, status: 'CONFIRMED' }, false],
    [{ enabled: true, status: 'RESET_REQUIRED' }, false],
    [{ enabled: true, status: 'UNCONFIRMED' }, false],
    [{ enabled: true, status: 'FORCE_CHANGE_PASSWORD' }, true],
  ])('estado del pool %o → agente=%s', async (state, expected) => {
    const { d } = deps({
      pool: [{ username: 'nuevo', ...state }],
      directory: [{ username: 'nuevo', roles: [{ id: 'r1', name: 'Agente Prueba', campaign: 'prueba' }] }],
      detail: { nuevo: [{ role_id: 'r1', role_name: 'Agente Prueba', campaign_name: 'prueba' }] },
    });
    expect(agentsOf((await deriveCampaignAgents(d)).lists, 'prueba')).toEqual(expected ? ['nuevo'] : []);
  });

  it('deny local -ana:campaign:message:send del rol → no es agente por ese rol', async () => {
    const { d } = deps({
      pool: [confirmed('ana')],
      directory: [{ username: 'ana', roles: [{ id: 'r1', name: 'Agente DIDI VIP', campaign: 'didi_vip' }] }],
      detail: { ana: [{ role_id: 'r1', role_name: 'Agente DIDI VIP', campaign_name: 'didi_vip' }] },
      local: { r1: [`-${SEND}`] },
    });
    expect(agentsOf((await deriveCampaignAgents(d)).lists, 'didi_vip')).toEqual([]);
  });

  it('deny inline (permission_name) → no es agente', async () => {
    const { d } = deps({
      pool: [confirmed('ana')],
      directory: [{ username: 'ana', roles: [{ id: 'r1', name: 'Agente DIDI VIP', campaign: 'didi_vip' }] }],
      detail: {
        ana: [{ role_id: 'r1', role_name: 'Agente DIDI VIP', campaign_name: 'didi_vip', permissions: [{ permission_name: `-${SEND}` }] }],
      },
    });
    expect(agentsOf((await deriveCampaignAgents(d)).lists, 'didi_vip')).toEqual([]);
  });

  it('rol sin "agente" con el permiso explícito (Calidad) no deriva agentes', async () => {
    const { d } = deps({
      pool: [confirmed('q')],
      directory: [{ username: 'q', roles: [{ id: 'r9', name: 'Calidad DIDI VIP', campaign: 'didi_vip' }] }],
      detail: { q: [{ role_id: 'r9', role_name: 'Calidad DIDI VIP', campaign_name: 'didi_vip', permissions: [{ permission_name: SEND }] }] },
      local: { r9: [SEND] },
    });
    expect(agentsOf((await deriveCampaignAgents(d)).lists, 'didi_vip')).toEqual([]);
  });

  it('Admin Prueba (ana:admin:console:manage) no hace agente', async () => {
    const { d } = deps({
      pool: [confirmed('adm')],
      directory: [{ username: 'adm', roles: [{ id: 'r5', name: 'Admin Prueba', campaign: 'prueba' }] }],
      detail: { adm: [{ role_id: 'r5', role_name: 'Admin Prueba', campaign_name: 'prueba', permissions: [{ permission_name: ANA_PERMISSIONS.ADMIN_CONSOLE }] }] },
    });
    expect(agentsOf((await deriveCampaignAgents(d)).lists, 'prueba')).toEqual([]);
  });

  it('normaliza la forma de GET /users (id/name/campaign) y usa GET /users/{username} como fuente', async () => {
    expect(normalizeRole({ id: 'x', name: 'Agente A', campaign: 'A' })).toEqual({ role_id: 'x', role_name: 'Agente A', campaign_name: 'A' });
    // El listado dice "Agente", pero el detalle (fuente) dice que ya no tiene ese rol.
    const { d, getUserRoles } = deps({
      pool: [confirmed('ana')],
      directory: [{ username: 'ana', roles: [{ id: 'r1', name: 'Agente Prueba', campaign: 'prueba' }] }],
      detail: { ana: [{ role_id: 'r2', role_name: 'Líder Prueba', campaign_name: 'prueba' }] },
    });
    expect(agentsOf((await deriveCampaignAgents(d)).lists, 'prueba')).toEqual([]);
    expect(getUserRoles).toHaveBeenCalledWith('ana');
  });

  it('nunca llama /roles/{id}/permissions (dependencias reales sobre fetch)', async () => {
    const { defaultDeriveDeps } = await import('../src/lib/campaignAgents');
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(u);
      if (u.endsWith('/users')) return Response.json({ users: [{ username: 'ana', roles: [{ id: 'r1', name: 'Agente P', campaign: 'p' }] }] });
      return Response.json({ roles: [{ role_id: 'r1', role_name: 'Agente P', campaign_name: 'p', permissions: [] }] });
    });
    const real = defaultDeriveDeps();
    const dir = await real.listDirectoryUsers();
    expect(dir[0]!.roles[0]).toMatchObject({ role_id: 'r1', role_name: 'Agente P', campaign_name: 'p' });
    await real.getUserRoles('ana');
    expect(urls.some((u) => /\/roles\/.+\/permissions/.test(u))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('concurrencia máxima de 5 en GET /users/{username}', async () => {
    const n = 12;
    let inFlight = 0;
    let peak = 0;
    const f: Fixture = {
      pool: Array.from({ length: n }, (_, i) => confirmed(`u${i}`)),
      directory: Array.from({ length: n }, (_, i) => ({ username: `u${i}`, roles: [{ id: 'r1', name: 'Agente P', campaign: 'prueba' }] })),
      detail: {},
    };
    const { d } = deps(f, {
      getUserRoles: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return [{ role_id: 'r1', role_name: 'Agente P', campaign_name: 'prueba' }];
      },
    });
    const { lists } = await deriveCampaignAgents(d);
    expect(peak).toBeLessThanOrEqual(5);
    expect(agentsOf(lists, 'prueba')).toHaveLength(n);
  });

  it('campaña del catálogo sin agentes → lista vacía; roles fuera del catálogo se cuentan', async () => {
    const { d } = deps({
      pool: [confirmed('ana')],
      directory: [{ username: 'ana', roles: [{ id: 'r1', name: 'Agente Viejo', campaign: 'vieja' }] }],
      detail: { ana: [{ role_id: 'r1', role_name: 'Agente Viejo', campaign_name: 'vieja' }] },
    });
    const { lists, stats } = await deriveCampaignAgents(d);
    expect(lists.map((l) => l.campaign)).toEqual(['didi_vip', 'prueba', 'ventas']);
    expect(lists.find((l) => l.campaign === 'ventas')!.agents).toEqual([]);
    expect(stats.rolesOutsideCatalog).toBe(1);
    expect(stats.campaignsOutsideCatalog).toEqual(['vieja']);
  });

  it('un fallo de lectura se propaga (GET /users/{username})', async () => {
    const { d } = deps({
      pool: [confirmed('ana')],
      directory: [{ username: 'ana', roles: [{ id: 'r1', name: 'Agente P', campaign: 'prueba' }] }],
      detail: {},
    });
    await expect(deriveCampaignAgents(d)).rejects.toThrow();
  });
});
