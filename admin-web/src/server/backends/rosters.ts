/* eslint-disable @typescript-eslint/no-explicit-any -- parseo defensivo de respuestas externas */
import 'server-only';
import { serverEnv } from '../env';
import { HttpError } from '../errors';
import { callUpstream, upstreamMessage } from './http';
import { ensureOk } from './v4';

/** Forma normalizada de un roster de cualquiera de las flotas. */
export interface FleetOverride {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Tipo de integrante de la lista derivada (add-supervisor-contact-access). Ausente = agente. */
export type MemberKind = 'agent' | 'supervisor';

export interface FleetRoster {
  campaign: string;
  generatedAt: string | null;
  agents: Array<{
    username: string;
    enabled: boolean;
    override: FleetOverride | null;
    kind: MemberKind;
    lastSeen?: number | null;
    active?: boolean;
  }>;
  inactiveOverrides: Array<{ username: string } & FleetOverride>;
}

export type Fleet = 'v3' | 'v4';

const kindOf = (a: any): MemberKind => (a?.kind === 'supervisor' ? 'supervisor' : 'agent');

/**
 * Destinatarios habilitados de una carga: agentes y, solo si se pide, también
 * supervisores (toggle "Incluir supervisores", add-supervisor-contact-access D3).
 */
export function enabledRecipients(roster: FleetRoster, includeSupervisors: boolean): { agents: string[]; supervisors: string[] } {
  const enabled = roster.agents.filter((a) => a.enabled && (includeSupervisors || a.kind !== 'supervisor'));
  return { agents: enabled.map((a) => a.username), supervisors: enabled.filter((a) => a.kind === 'supervisor').map((a) => a.username) };
}

const ov = (o: any): FleetOverride | null =>
  o && typeof o.enabled === 'boolean'
    ? { enabled: o.enabled, updatedAt: o.updatedAt ?? null, updatedBy: o.updatedBy ?? null }
    : null;

function fromV3(data: any): FleetRoster {
  const d = data?.data ?? {};
  return {
    campaign: String(d.campaign ?? ''),
    generatedAt: d.generatedAt ?? null,
    agents: (d.agents ?? []).map((a: any) => ({ username: String(a.username), enabled: a.enabled !== false, override: ov(a.override), kind: kindOf(a) })),
    inactiveOverrides: (d.inactiveOverrides ?? []).map((o: any) => ({ username: String(o.username), ...ov(o)! })),
  };
}

function fromV4(d: any): FleetRoster {
  return {
    campaign: String(d?.campaign ?? ''),
    generatedAt: d?.generatedAt ?? null,
    agents: (d?.agents ?? []).map((a: any) => ({
      username: String(a.operatorId),
      enabled: a.enabled !== false,
      override: ov(a.override),
      kind: kindOf(a),
      lastSeen: typeof a.lastSeen === 'number' ? a.lastSeen : null,
      active: a.active === true,
    })),
    inactiveOverrides: (d?.inactiveOverrides ?? []).map((o: any) => ({ username: String(o.operatorId), ...ov(o)! })),
  };
}

/** Traduce el 409 "no es agente" de cada backend al error uniforme. */
function notAgentOr<T>(res: { status: number; data: unknown }, label: string): T {
  if (res.status === 409) {
    const msg = upstreamMessage(res.data) ?? '';
    if (/no es agente/i.test(msg)) throw new HttpError('conflict', 'No es agente de la campaña', { upstream: msg });
    throw new HttpError('conflict', 'El roster cambió, intenta de nuevo');
  }
  return ensureOk(res as { status: number; data: T }, label);
}

export async function getRoster(fleet: Fleet, token: string, campaign: string): Promise<FleetRoster> {
  const env = serverEnv();
  if (fleet === 'v3') {
    const res = await callUpstream(`${env.v3ApiBase}/admin/campaigns/${encodeURIComponent(campaign)}/roster`, { token, label: 'v3:roster' });
    return fromV3(ensureOk(res, 'v3:roster'));
  }
  const res = await callUpstream(`${env.v4ApiBase}/admin/agent-roster?campaign=${encodeURIComponent(campaign)}`, { token, label: 'v4:roster' });
  return fromV4(ensureOk(res, 'v4:roster'));
}

export async function updateRoster(
  fleet: Fleet,
  token: string,
  campaign: string,
  agents: Array<{ username: string; enabled: boolean }>,
): Promise<FleetRoster> {
  const env = serverEnv();
  if (fleet === 'v3') {
    const res = await callUpstream(`${env.v3ApiBase}/admin/campaigns/${encodeURIComponent(campaign)}/roster/agents`, {
      method: 'POST',
      token,
      body: { agents },
      label: 'v3:roster:update',
    });
    return fromV3(notAgentOr(res, 'v3:roster:update'));
  }
  const res = await callUpstream(`${env.v4ApiBase}/admin/agent-roster`, {
    method: 'POST',
    token,
    body: { campaign, agents: agents.map((a) => ({ operatorId: a.username, enabled: a.enabled })) },
    label: 'v4:roster:update',
  });
  return fromV4(notAgentOr(res, 'v4:roster:update'));
}
