// File: Vista y actualización administrativa del roster v4 (GET/POST /admin/agent-roster).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { UserAccess } from './access';
import { ANA_PERMISSIONS } from './permissions';
import { listCampaignAgents } from './agents';
import { normalizeId, readCampaignAgents, type CampaignAgentsList } from './campaignAgentsList';

export const MAX_ROSTER_ENTRIES = 100;

/**
 * Autorización de la gestión del roster (fail-closed, NO depende de
 * PERMISSIONS_ENFORCED): admin en cualquier campaña; AGENTS_MANAGE solo en
 * campañas propias (o `*`).
 */
export function canManageAgents(access: UserAccess, campaign: string): boolean {
  if (access.isAdmin) return true;
  if (!access.permissions.includes(ANA_PERMISSIONS.AGENTS_MANAGE)) return false;
  const own = access.campaigns.map(normalizeId);
  return own.includes('*') || own.includes(normalizeId(campaign));
}

export interface OverrideView {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface RosterView {
  campaign: string;
  generatedAt: string | null;
  agents: {
    operatorId: string;
    enabled: boolean;
    override: OverrideView | null;
    lastSeen: number | null;
    active: boolean;
  }[];
  inactiveOverrides: ({ operatorId: string } & OverrideView)[];
}

/** Roster = lista derivada con estado efectivo + excepciones sin efecto. */
export async function buildRosterView(
  campaign: string,
  list?: CampaignAgentsList | null,
): Promise<RosterView> {
  const derived = list === undefined ? await readCampaignAgents(campaign) : list;
  const entries = await listCampaignAgents(campaign);
  const byNorm = new Map(entries.map((e) => [normalizeId(e.operatorId), e]));
  const derivedNorm = new Set((derived?.agents ?? []).map((a) => normalizeId(a.username)));

  const overrideOf = (e?: (typeof entries)[number]): OverrideView | null =>
    e && typeof e.enabled === 'boolean'
      ? { enabled: e.enabled, updatedAt: e.enabledUpdatedAt ?? null, updatedBy: e.enabledUpdatedBy ?? null }
      : null;

  const agents = (derived?.agents ?? []).map((a) => {
    const e = byNorm.get(normalizeId(a.username));
    const override = overrideOf(e);
    return {
      operatorId: a.cognitoUsername,
      enabled: override?.enabled !== false,
      override,
      lastSeen: e && e.lastSeen ? e.lastSeen : null,
      active: e?.active ?? false,
    };
  });

  const inactiveOverrides = entries
    .filter((e) => typeof e.enabled === 'boolean' && !derivedNorm.has(normalizeId(e.operatorId)))
    .map((e) => ({ operatorId: e.operatorId, ...overrideOf(e)! }))
    .sort((a, b) => a.operatorId.localeCompare(b.operatorId));

  return { campaign, generatedAt: derived?.generatedAt ?? null, agents, inactiveOverrides };
}

export type ParsedRosterBody =
  | { ok: true; agents: { operatorId: string; enabled: boolean }[] }
  | { ok: false; error: string };

/** Valida `agents` del body (1–100, operatorId no vacío sin repetir, enabled booleano). */
export function parseRosterAgents(raw: unknown): ParsedRosterBody {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'falta agents' };
  if (raw.length > MAX_ROSTER_ENTRIES) return { ok: false, error: `máximo ${MAX_ROSTER_ENTRIES} agentes por solicitud` };
  const seen = new Set<string>();
  const agents: { operatorId: string; enabled: boolean }[] = [];
  for (const a of raw) {
    const operatorId = typeof a?.operatorId === 'string' ? a.operatorId.trim() : '';
    if (!operatorId || operatorId.length > 128) return { ok: false, error: 'operatorId inválido' };
    if (typeof a.enabled !== 'boolean') return { ok: false, error: 'enabled debe ser booleano' };
    const n = normalizeId(operatorId);
    if (seen.has(n)) return { ok: false, error: `operatorId repetido: ${operatorId}` };
    seen.add(n);
    agents.push({ operatorId, enabled: a.enabled });
  }
  return { ok: true, agents };
}
