// @vitest-environment node
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as postAgents } from '@/app/api/campaigns/[campaign]/agents/route';
import { GET as getUsers } from '@/app/api/users/route';
import { GET as getUserDetail } from '@/app/api/users/[username]/route';
import { setCognitoClientForTests } from '@/server/directory/cognito';
import { invalidateRoles } from '@/server/directory/rolesApi';
import { signToken } from '../helpers/jwt';
import { ADMIN, authedRequest, bodyOf, ctx, LEADER, mockFetch, ROLES, setupServerTest, V3, V4, type Route } from '../helpers/server';

// Casts: aws-sdk-client-mock y el cliente traen versiones distintas de @smithy/types.
const cognito = mockClient(CognitoIdentityProviderClient as any) as any;
const ListUsers = ListUsersCommand as any;

const poolUser = (username: string, opts: { name?: string; email?: string; enabled?: boolean; status?: string } = {}) => ({
  Username: username,
  Enabled: opts.enabled ?? true,
  UserStatus: opts.status ?? 'CONFIRMED',
  Attributes: [
    ...(opts.name ? [{ Name: 'name', Value: opts.name }] : []),
    ...(opts.email ? [{ Name: 'email', Value: opts.email }] : []),
  ],
});

const ROLES_LIST = [
  { username: 'ana.lopez', roles: [{ id: 'r1', name: 'Agente DIDI VIP', campaign: 'didi_vip' }] },
  { username: 'luis', roles: [{ id: 'r2', name: 'Líder DIDI VIP', campaign: 'didi_vip' }] },
];

const v3Roster = (agents: unknown[], extra: Record<string, unknown> = {}) =>
  Response.json({ success: true, data: { campaign: 'didi_vip', generatedAt: new Date().toISOString(), agents, inactiveOverrides: [], ...extra } });
const v4Roster = (agents: unknown[], extra: Record<string, unknown> = {}) =>
  Response.json({ campaign: 'didi_vip', generatedAt: new Date().toISOString(), agents, inactiveOverrides: [], ...extra });

function routes(over: Record<string, Route> = {}): Record<string, Route> {
  return {
    [`GET ${ROLES}/users`]: () => Response.json(ROLES_LIST),
    [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => v3Roster([{ username: 'ana.lopez', enabled: true, override: null }]),
    [`GET ${V4}/admin/agent-roster`]: () => v4Roster([{ operatorId: 'Ana.Lopez', enabled: false, override: { enabled: false, updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'lider.didi' }, lastSeen: 1761400000000, active: true }]),
    ...over,
  };
}

beforeEach(() => {
  setupServerTest();
  cognito.reset();
  setCognitoClientForTests(new CognitoIdentityProviderClient({ region: 'us-east-2' }));
  invalidateRoles();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  cognito.on(ListUsers).callsFake((input: any) =>
    input.PaginationToken === 'p2'
      ? { Users: [poolUser('pedro', { enabled: false, status: 'CONFIRMED' }), poolUser('zoe', { status: 'RESET_REQUIRED' })] }
      : { Users: [poolUser('ana.lopez', { name: 'Ana López', email: 'ana@ejemplo.mx' }), poolUser('luis', { email: 'luis@ejemplo.mx' })], PaginationToken: 'p2' },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/users', () => {
  it('lista paginada del pool con roles normalizados (ListUsers paginado)', async () => {
    mockFetch(LEADER, routes());
    const res = await getUsers(authedRequest('/api/users'), ctx());
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.users.map((u: { username: string }) => u.username)).toEqual(['ana.lopez', 'luis', 'pedro', 'zoe']);
    expect(body.users[0]).toMatchObject({ name: 'Ana López', email: 'ana@ejemplo.mx', enabled: true, status: 'CONFIRMED', roles: [{ roleName: 'Agente DIDI VIP', campaign: 'didi_vip' }] });
    expect(body.rolesAvailable).toBe(true);
    expect(body.pageSize).toBe(50);
    expect(cognito.commandCalls(ListUsers)[0]!.args[0].input).toMatchObject({ UserPoolId: 'us-east-2_UepfOyKpd', Limit: 60 });
  });

  it('búsqueda por username, nombre o correo', async () => {
    mockFetch(LEADER, routes());
    const body = await bodyOf(await getUsers(authedRequest('/api/users?search=LOPEZ'), ctx()));
    expect(body.users.map((u: { username: string }) => u.username)).toEqual(['ana.lopez']);
    const byMail = await bodyOf(await getUsers(authedRequest('/api/users?search=luis@'), ctx()));
    expect(byMail.users.map((u: { username: string }) => u.username)).toEqual(['luis']);
  });

  it('API de Roles caída → usuarios con roles null y rolesAvailable=false', async () => {
    mockFetch(LEADER, routes({ [`GET ${ROLES}/users`]: () => new Response('down', { status: 502 }) }));
    const res = await getUsers(authedRequest('/api/users'), ctx());
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.rolesAvailable).toBe(false);
    expect(body.users).toHaveLength(4);
    expect(body.users[0].roles).toBeNull();
  });

  it('la llamada a la API de Roles lleva X-Api-Key solo del servidor; los backends reciben el token del usuario', async () => {
    const token = signToken();
    const { calls } = mockFetch(LEADER, routes());
    await getUsers(authedRequest('/api/users?campaign=didi_vip', { token }), ctx());
    const roles = calls.find((c) => c.url === `${ROLES}/users`)!;
    expect(roles.headers.get('x-api-key')).toBe(process.env.ROLES_API_KEY);
    const v3 = calls.find((c) => c.url.startsWith(V3))!;
    expect(v3.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(v3.headers.get('x-admin-key')).toBeNull();
    expect(v3.headers.get('x-api-key')).toBeNull();
  });

  it('estado por flota: agente, deshabilitado (con autor), no es agente (motivos)', async () => {
    mockFetch(LEADER, routes());
    const body = await bodyOf(await getUsers(authedRequest('/api/users?campaign=didi_vip'), ctx()));
    const by = Object.fromEntries(body.users.map((u: { username: string }) => [u.username, u]));
    expect(by['ana.lopez'].fleets.v3).toEqual({ state: 'agent', override: null });
    expect(by['ana.lopez'].fleets.v4).toMatchObject({ state: 'disabled', override: { updatedBy: 'lider.didi' }, lastSeen: 1761400000000 });
    expect(by.luis.fleets.v3).toEqual({ state: 'not_agent', reason: 'Sin rol con permiso de envío en la campaña' });
    expect(by.pedro.fleets.v3).toEqual({ state: 'not_agent', reason: 'Deshabilitado en Cognito' });
    expect(by.zoe.fleets.v4.reason).toBe('Deshabilitado en Cognito');
    expect(body.fleets.v3.available).toBe(true);
  });

  it('filtros por estado de flota', async () => {
    mockFetch(LEADER, routes());
    const body = await bodyOf(await getUsers(authedRequest('/api/users?campaign=didi_vip&filter=v4:disabled'), ctx()));
    expect(body.users.map((u: { username: string }) => u.username)).toEqual(['ana.lopez']);
  });

  it('una flota no disponible no rompe la otra', async () => {
    mockFetch(LEADER, routes({ [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => new Response('x', { status: 500 }) }));
    const body = await bodyOf(await getUsers(authedRequest('/api/users?campaign=didi_vip'), ctx()));
    expect(body.fleets.v3.available).toBe(false);
    expect(body.fleets.v4.available).toBe(true);
    expect(body.users[0].fleets.v3.state).toBe('unavailable');
    expect(body.users[0].fleets.v4.state).toBe('disabled');
  });

  it('página de 50', async () => {
    cognito.reset();
    cognito.on(ListUsers).resolves({ Users: Array.from({ length: 120 }, (_, i) => poolUser(`u${String(i).padStart(3, '0')}`)) });
    setCognitoClientForTests(new CognitoIdentityProviderClient({ region: 'us-east-2' }));
    mockFetch(LEADER, routes());
    const body = await bodyOf(await getUsers(authedRequest('/api/users?page=3'), ctx()));
    expect(body.users).toHaveLength(20);
    expect(body.users[0].username).toBe('u100');
    expect(body.total).toBe(120);
  });

  it('usuario solo con carga de contactos → 403', async () => {
    mockFetch({ ...LEADER, permissions: ['ana:contacts:list:upload'] }, routes());
    const res = await getUsers(authedRequest('/api/users'), ctx());
    expect(res.status).toBe(403);
    expect(cognito.commandCalls(ListUsers)).toHaveLength(0);
  });

  it('campaña ajena → 403', async () => {
    mockFetch(LEADER, routes());
    const res = await getUsers(authedRequest('/api/users?campaign=zendere'), ctx());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/users/[username]', () => {
  it('lee GET /users/{username} con permisos inline (sin /roles/{id}/permissions)', async () => {
    const { calls } = mockFetch(LEADER, {
      [`GET ${ROLES}/users/ana.lopez`]: () =>
        Response.json({ username: 'ana.lopez', roles: [{ role_id: 'r1', role_name: 'Agente DIDI VIP', campaign_name: 'DIDI_VIP', permissions: [{ permission_id: 'p', permission_name: 'ana:campaign:message:send' }] }] }),
    });
    const body = await bodyOf(await getUserDetail(authedRequest('/api/users/ana.lopez'), ctx({ username: 'ana.lopez' })));
    expect(body.roles).toEqual([{ roleId: 'r1', roleName: 'Agente DIDI VIP', campaign: 'DIDI_VIP', permissions: ['ana:campaign:message:send'] }]);
    expect(calls.some((c) => c.url.includes('/roles/'))).toBe(false);
  });
});

describe('POST /api/campaigns/[campaign]/agents', () => {
  it('v3: propaga el token y devuelve el roster', async () => {
    const token = signToken();
    const { calls } = mockFetch(LEADER, {
      [`POST ${V3}/admin/campaigns/didi_vip/roster/agents`]: () =>
        v3Roster([{ username: 'ana.lopez', enabled: false, override: { enabled: false, updatedAt: 't', updatedBy: 'lider.didi' } }]),
    });
    const res = await postAgents(
      authedRequest('/api/campaigns/didi_vip/agents', { token, method: 'POST', body: JSON.stringify({ fleet: 'v3', agents: [{ username: 'ana.lopez', enabled: false }] }) }),
      ctx({ campaign: 'didi_vip' }),
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).roster.agents[0]).toMatchObject({ username: 'ana.lopez', enabled: false });
    const call = calls.find((c) => c.url.startsWith(V3))!;
    expect(call.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(call.headers.get('x-admin-key')).toBeNull();
    expect(JSON.parse(call.body!)).toEqual({ agents: [{ username: 'ana.lopez', enabled: false }] });
  });

  it('v4: usa operatorId y campaign en el body', async () => {
    const { calls } = mockFetch(ADMIN, { [`POST ${V4}/admin/agent-roster`]: () => v4Roster([]) });
    await postAgents(
      authedRequest('/api/campaigns/zendere/agents', { method: 'POST', body: JSON.stringify({ fleet: 'v4', agents: [{ username: 'Ana.Lopez', enabled: true }] }) }),
      ctx({ campaign: 'zendere' }),
    );
    expect(JSON.parse(calls.find((c) => c.url.startsWith(V4) && c.method === 'POST')!.body!)).toEqual({
      campaign: 'zendere',
      agents: [{ operatorId: 'Ana.Lopez', enabled: true }],
    });
  });

  it('409 "No es agente" de cualquier flota se propaga', async () => {
    mockFetch(LEADER, {
      [`POST ${V4}/admin/agent-roster`]: () => Response.json({ error: 'no es agente de la campaña: luis' }, { status: 409 }),
    });
    const res = await postAgents(
      authedRequest('/api/campaigns/didi_vip/agents', { method: 'POST', body: JSON.stringify({ fleet: 'v4', agents: [{ username: 'luis', enabled: true }] }) }),
      ctx({ campaign: 'didi_vip' }),
    );
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error).toMatchObject({ code: 'conflict', message: 'No es agente de la campaña' });
  });

  it('sin ana:admin:agents:manage → 403 sin llamar a backends', async () => {
    const { calls } = mockFetch({ ...LEADER, permissions: ['ana:contacts:list:upload'] });
    const res = await postAgents(
      authedRequest('/api/campaigns/didi_vip/agents', { method: 'POST', body: JSON.stringify({ fleet: 'v3', agents: [{ username: 'a', enabled: false }] }) }),
      ctx({ campaign: 'didi_vip' }),
    );
    expect(res.status).toBe(403);
    expect(calls.filter((c) => !c.url.endsWith('/me'))).toHaveLength(0);
  });

  it('campaña ajena → 403', async () => {
    mockFetch(LEADER);
    const res = await postAgents(
      authedRequest('/api/campaigns/zendere/agents', { method: 'POST', body: JSON.stringify({ fleet: 'v3', agents: [{ username: 'a', enabled: false }] }) }),
      ctx({ campaign: 'zendere' }),
    );
    expect(res.status).toBe(403);
  });

  it.each([
    [{ fleet: 'v5', agents: [{ username: 'a', enabled: false }] }],
    [{ fleet: 'v3', agents: [] }],
    [{ fleet: 'v3', agents: [{ username: 'a/b', enabled: false }] }],
    [{ fleet: 'v3', agents: [{ username: 'a', enabled: 'no' }] }],
  ])('body inválido → 400 (%j)', async (body) => {
    mockFetch(LEADER);
    const res = await postAgents(authedRequest('/api/campaigns/didi_vip/agents', { method: 'POST', body: JSON.stringify(body) }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(400);
  });
});
