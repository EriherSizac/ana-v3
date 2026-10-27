// File: Derivación de agentes por campaña desde el pool de Cognito y la API de Roles (design D11).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ANA_PERMISSIONS, isAgentRole, isSupervisorRole } from './permissions';
import { getManyRolePermissions } from './rolePerms';
import { db } from './db';
import { normalizeId, type CampaignAgentsList, type MemberKind } from './campaignAgentsList';

// Agente de X = usuario del pool con Enabled y estado CONFIRMED o
// FORCE_CHANGE_PASSWORD ∧ algún rol de AGENTE ("Agente <Campaña>") con
// campaign_name normalizado = X que no tiene deny `-ana:campaign:message:send`
// (almacén local por role_id o inline). Roles `*` nunca derivan agentes.
// Supervisor de X (add-supervisor-contact-access D2) = mismo usuario elegible
// con rol de SUPERVISOR de X sin ese deny; se lista con kind:"supervisor"
// (si además es agente de X, queda una vez con kind:"agent").

export const ELIGIBLE_STATUSES = new Set(['CONFIRMED', 'FORCE_CHANGE_PASSWORD']);
const SEND_DENY = `-${ANA_PERMISSIONS.CAMPAIGN_SEND}`;
const DETAIL_CONCURRENCY = 5;
const BATCH_GET_MAX = 100;

export interface PoolUser {
  username: string; // tal como lo emite el pool
  enabled: boolean;
  status: string;
}

export interface NormalizedRole {
  role_id: string;
  role_name: string;
  campaign_name: string;
  permissions?: { permission_name: string }[];
}

export interface DirectoryUser {
  username: string;
  roles: NormalizedRole[];
}

export interface DeriveDeps {
  listPoolUsers: () => Promise<PoolUser[]>;
  /** GET /users (forma id/name/campaign). Debe lanzar si falla. */
  listDirectoryUsers: () => Promise<DirectoryUser[]>;
  /** GET /users/{username} (forma role_id/role_name/campaign_name + permisos inline). Debe lanzar si falla. */
  getUserRoles: (username: string) => Promise<NormalizedRole[]>;
  /** Almacén local rol→permisos. Debe lanzar si falla. */
  getRolePermissions: (roleIds: string[]) => Promise<Map<string, string[]>>;
  /** Catálogo de campañas (PostgreSQL). Debe lanzar si falla. */
  listCatalog: () => Promise<string[]>;
  now?: () => Date;
}

export interface DeriveResult {
  lists: CampaignAgentsList[];
  stats: {
    poolUsers: number;
    eligiblePoolUsers: number;
    candidates: number;
    agents: number;
    /** Roles de agente con envío cuya campaña no está en el catálogo (se ignoran). */
    rolesOutsideCatalog: number;
    campaignsOutsideCatalog: string[];
  };
}

/** Normaliza un rol de cualquiera de las dos formas de la API de Roles. */
export function normalizeRole(r: any): NormalizedRole {
  return {
    role_id: String(r?.role_id ?? r?.id ?? ''),
    role_name: String(r?.role_name ?? r?.name ?? ''),
    campaign_name: String(r?.campaign_name ?? r?.campaign ?? ''),
    ...(Array.isArray(r?.permissions) ? { permissions: r.permissions } : {}),
  };
}

/** ¿El rol otorga envío? Solo roles de agente, salvo deny local o inline. */
export function roleGrantsSend(role: NormalizedRole, localPerms: string[] = []): boolean {
  if (!isAgentRole(role.role_name)) return false;
  if (localPerms.includes(SEND_DENY)) return false;
  if ((role.permissions ?? []).some((p) => p?.permission_name === SEND_DENY)) return false;
  return true;
}

/** Tipo de integrante que deriva el rol (null = no deriva). Agente gana sobre supervisor. */
export function roleMemberKind(role: NormalizedRole, localPerms: string[] = []): MemberKind | null {
  if (roleGrantsSend(role, localPerms)) return 'agent';
  if (!isSupervisorRole(role.role_name)) return null;
  if (localPerms.includes(SEND_DENY)) return null;
  if ((role.permissions ?? []).some((p) => p?.permission_name === SEND_DENY)) return null;
  return 'supervisor';
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Calcula la lista de agentes de cada campaña del catálogo. Cualquier fallo de
 * lectura se propaga (la sincronización no escribe nada en ese caso).
 */
export async function deriveCampaignAgents(deps: DeriveDeps): Promise<DeriveResult> {
  const now = (deps.now ?? (() => new Date()))();
  const [pool, directory, catalogRaw] = await Promise.all([
    deps.listPoolUsers(),
    deps.listDirectoryUsers(),
    deps.listCatalog(),
  ]);
  const catalog = [...new Set(catalogRaw.map(normalizeId).filter(Boolean))].sort();
  if (catalog.length === 0) throw new Error('catálogo de campañas vacío');
  const catalogSet = new Set(catalog);

  // Pool elegible indexado por username normalizado.
  const eligible = new Map<string, PoolUser>();
  for (const u of pool) {
    if (u.enabled && ELIGIBLE_STATUSES.has(u.status)) eligible.set(normalizeId(u.username), u);
  }

  // Candidatos: usuarios elegibles con algún rol de campaña distinta de '*'.
  const candidates = [
    ...new Set(
      directory
        .filter((u) =>
          u.roles.some((r) => {
            const c = normalizeId(r.campaign_name);
            return c !== '' && c !== '*';
          }),
        )
        .map((u) => normalizeId(u.username))
        .filter((u) => eligible.has(u)),
    ),
  ].sort();

  // Fuente por usuario: GET /users/{username} (permisos inline), concurrencia 5.
  const details = await mapLimit(candidates, DETAIL_CONCURRENCY, async (u) => ({
    username: u,
    roles: (await deps.getUserRoles(eligible.get(u)!.username)).map(normalizeRole),
  }));

  // Almacén local solo para roles de agente o supervisor de campaña.
  const agentRoleIds = [
    ...new Set(
      details.flatMap((d) =>
        d.roles
          .filter(
            (r) =>
              (isAgentRole(r.role_name) || isSupervisorRole(r.role_name)) && normalizeId(r.campaign_name) !== '*' && r.role_id,
          )
          .map((r) => r.role_id),
      ),
    ),
  ];
  const local = new Map<string, string[]>();
  for (let i = 0; i < agentRoleIds.length; i += BATCH_GET_MAX) {
    const part = await deps.getRolePermissions(agentRoleIds.slice(i, i + BATCH_GET_MAX));
    for (const [k, v] of part) local.set(k, v);
  }

  const byCampaign = new Map<string, Map<string, { cognitoUsername: string; roleIds: Set<string>; kind: MemberKind }>>();
  let rolesOutsideCatalog = 0;
  const outside = new Set<string>();
  for (const d of details) {
    for (const r of d.roles) {
      const c = normalizeId(r.campaign_name);
      if (!c || c === '*') continue;
      const kind = roleMemberKind(r, local.get(r.role_id) ?? []);
      if (!kind) continue;
      if (!catalogSet.has(c)) {
        rolesOutsideCatalog++;
        outside.add(c);
        continue;
      }
      const m = byCampaign.get(c) ?? new Map();
      byCampaign.set(c, m);
      const entry = m.get(d.username) ?? {
        cognitoUsername: eligible.get(d.username)!.username,
        roleIds: new Set<string>(),
        kind,
      };
      entry.roleIds.add(r.role_id);
      if (kind === 'agent') entry.kind = 'agent';
      m.set(d.username, entry);
    }
  }

  const generatedAt = now.toISOString();
  let agents = 0;
  const lists: CampaignAgentsList[] = catalog.map((campaign) => {
    const m = byCampaign.get(campaign) ?? new Map();
    const entries = [...m.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([username, e]) => ({ username, cognitoUsername: e.cognitoUsername, roleIds: [...e.roleIds].sort(), kind: e.kind }));
    agents += entries.length;
    return { schemaVersion: 1 as const, campaign, generatedAt, agents: entries };
  });

  return {
    lists,
    stats: {
      poolUsers: pool.length,
      eligiblePoolUsers: eligible.size,
      candidates: candidates.length,
      agents,
      rolesOutsideCatalog,
      campaignsOutsideCatalog: [...outside].sort(),
    },
  };
}

// ---------------------------------------------------------------------------
// Dependencias reales (estrictas: lanzan ante cualquier fallo).

const ROLES_API_BASE = () => process.env.ROLES_API_BASE ?? '';
const ROLES_API_KEY = () => process.env.ROLES_API_KEY ?? '';
const USER_POOL_ID = () => process.env.COGNITO_USER_POOL_ID || 'us-east-2_UepfOyKpd';

async function rolesGet(path: string): Promise<any> {
  const res = await fetch(`${ROLES_API_BASE()}${path}`, {
    headers: { 'X-Api-Key': ROLES_API_KEY() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`API de Roles ${path.split('/').slice(0, 2).join('/')} respondió ${res.status}`);
  return res.json();
}

export const defaultDeriveDeps = (): DeriveDeps => {
  const cognito = new CognitoIdentityProviderClient({ region: USER_POOL_ID().split('_')[0] });
  return {
    listPoolUsers: async () => {
      const out: PoolUser[] = [];
      let token: string | undefined;
      do {
        const res = await cognito.send(
          new ListUsersCommand({ UserPoolId: USER_POOL_ID(), Limit: 60, PaginationToken: token }),
        );
        for (const u of res.Users ?? []) {
          if (u.Username) out.push({ username: u.Username, enabled: u.Enabled === true, status: u.UserStatus ?? 'UNKNOWN' });
        }
        token = res.PaginationToken;
      } while (token);
      return out;
    },
    listDirectoryUsers: async () => {
      const data = await rolesGet('/users');
      const users: any[] = Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : [];
      return users
        .map((u) => ({
          username: String(u?.username ?? u?.user_name ?? u?.cognito_username ?? ''),
          roles: (Array.isArray(u?.roles) ? u.roles : []).map(normalizeRole),
        }))
        .filter((u) => u.username);
    },
    getUserRoles: async (username) => {
      const data = await rolesGet(`/users/${encodeURIComponent(username)}`);
      return (Array.isArray(data?.roles) ? data.roles : []).map(normalizeRole);
    },
    getRolePermissions: (ids) => getManyRolePermissions(ids),
    listCatalog: async () => {
      const { rows } = await db().query('SELECT name FROM campaigns');
      return rows.map((r: any) => String(r.name));
    },
  };
};
