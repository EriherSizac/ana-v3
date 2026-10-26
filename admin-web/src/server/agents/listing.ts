import 'server-only';
import {
  AGENT_POOL_STATUSES,
  FLEETS,
  NOT_AGENT_COGNITO,
  NOT_AGENT_NO_ROLE,
  PAGE_SIZE,
  matchesFilters,
  matchesSearch,
  normalizeId,
  type Fleet,
  type FleetInfo,
  type FleetState,
  type InactiveOverride,
  type UserRow,
  type UsersResponse,
} from '@/lib/agents';
import type { FleetRoster } from '../backends/rosters';
import type { PoolUser } from '../directory/cognito';
import type { UserRole } from '../directory/rolesApi';

export type RosterResult = { ok: true; roster: FleetRoster } | { ok: false; message: string };

function fleetState(user: PoolUser, r: RosterResult): FleetState {
  if (!r.ok) return { state: 'unavailable' };
  const entry = r.roster.agents.find((a) => normalizeId(a.username) === normalizeId(user.username));
  if (entry) {
    return {
      state: entry.enabled ? 'agent' : 'disabled',
      override: entry.override,
      ...(entry.lastSeen !== undefined ? { lastSeen: entry.lastSeen } : {}),
    };
  }
  const cognitoOk = user.enabled && AGENT_POOL_STATUSES.includes(user.status);
  return { state: 'not_agent', reason: cognitoOk ? NOT_AGENT_NO_ROLE : NOT_AGENT_COGNITO };
}

export interface ListingInput {
  users: PoolUser[];
  roles: Map<string, UserRole[]> | null;
  campaign: string | null;
  rosters: Record<Fleet, RosterResult> | null;
  search: string;
  filters: string[];
  page: number;
}

/** Une directorio + roles + estado por flota y aplica búsqueda, filtros y página de 50. */
export function buildListing(input: ListingInput): UsersResponse {
  const rows: UserRow[] = input.users.map((u) => {
    const roles = input.roles
      ? (input.roles.get(u.username.toLowerCase()) ?? []).map((r) => ({ roleName: r.roleName, campaign: r.campaign }))
      : null;
    const row: UserRow = { ...u, roles };
    if (input.rosters) {
      row.fleets = { v3: fleetState(u, input.rosters.v3), v4: fleetState(u, input.rosters.v4) };
    }
    return row;
  });
  const filtered = rows.filter((r) => matchesSearch(r, input.search) && matchesFilters(r, input.filters));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, input.page), pages);

  let fleets: Record<Fleet, FleetInfo> | null = null;
  let inactiveOverrides: Record<Fleet, InactiveOverride[]> | null = null;
  if (input.rosters) {
    const r = input.rosters;
    fleets = Object.fromEntries(
      FLEETS.map((f) => {
        const x = r[f];
        return [f, x.ok ? { available: true, generatedAt: x.roster.generatedAt } : { available: false, generatedAt: null, message: x.message }];
      }),
    ) as Record<Fleet, FleetInfo>;
    inactiveOverrides = Object.fromEntries(FLEETS.map((f) => [f, r[f].ok ? (r[f] as { roster: FleetRoster }).roster.inactiveOverrides : []])) as Record<
      Fleet,
      InactiveOverride[]
    >;
  }

  return {
    users: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: filtered.length,
    page,
    pageSize: PAGE_SIZE,
    rolesAvailable: input.roles !== null,
    campaign: input.campaign,
    fleets,
    inactiveOverrides,
  };
}
