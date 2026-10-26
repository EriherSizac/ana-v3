// File: POST /agents/heartbeat — el agente se marca activo en su campaña.
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { registerAgent, listCampaignAgents, setAgentOverrides } from '../lib/agents';
import { campaignExists, listCampaignsDb } from '../lib/campaignsDb';
import { buildRosterView, canManageAgents, parseRosterAgents } from '../lib/agentRoster';
import { normalizeId, readCampaignAgents, RosterListError } from '../lib/campaignAgentsList';
import { resolveUserAccess } from '../lib/access';
import { ok, bad, claimUser } from '../lib/http';

/**
 * POST /agents/heartbeat — el agente se marca activo en su campaña.
 * GET  /agents?campaign=  — roster de agentes que el solicitante puede ver
 *                           (admin: cualquier campaña; líder: solo las suyas).
 * GET  /agents/campaigns  — campañas elegibles (admin: todas; líder: las suyas).
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const user = claimUser(event);
  if (!user) return bad('no autenticado', 401);

  try {
    const access = await resolveUserAccess(user);
    switch (event.routeKey) {
      case 'POST /agents/heartbeat':
        return await heartbeat(access, JSON.parse(event.body ?? '{}'));
      case 'GET /agents':
        return await agentsList(access, event.queryStringParameters?.campaign);
      case 'GET /agents/campaigns':
        return await campaignsList(access);
      case 'GET /admin/agent-roster':
        return await adminRosterGet(access, event.queryStringParameters?.campaign);
      case 'POST /admin/agent-roster': {
        let body: any;
        try {
          body = JSON.parse(event.body ?? '{}');
        } catch {
          return bad('body inválido');
        }
        return await adminRosterPost(access, body);
      }
      default:
        return bad(`ruta no manejada: ${event.routeKey}`, 404);
    }
  } catch (e) {
    console.error('[agents] error', event.routeKey, e);
    return bad('error interno', 500);
  }
};

async function heartbeat(
  access: import('../lib/access').UserAccess,
  body: { campaign?: string },
): Promise<APIGatewayProxyResultV2> {
  const { campaign } = body;
  if (!campaign) return bad('falta campaign');
  const allowed =
    access.isAdmin || access.campaigns.includes('*') || access.campaigns.includes(campaign);
  if (!allowed) return bad('campaña no permitida', 403);
  await registerAgent(campaign, access.username);
  return ok({ ok: true });
}

async function agentsList(
  access: import('../lib/access').UserAccess,
  campaign?: string,
): Promise<APIGatewayProxyResultV2> {
  // Admin: la campaña que pida. Líder: solo sus campañas (ignora intento de otras).
  let campaigns: string[];
  if (access.isAdmin || access.campaigns.includes('*')) {
    if (!campaign) return bad('falta campaign');
    campaigns = [campaign];
  } else {
    const own = access.campaigns.filter((c) => c !== '*');
    campaigns = campaign ? own.filter((c) => c === campaign) : own;
    if (campaigns.length === 0) return bad('campaña no permitida', 403);
  }

  const agents = (await Promise.all(campaigns.map(listCampaignAgents))).flat();
  return ok({ agents });
}

async function campaignsList(
  access: import('../lib/access').UserAccess,
): Promise<APIGatewayProxyResultV2> {
  // Campañas desde PostgreSQL. Admin/global ven todas; el resto solo las suyas.
  const all = await listCampaignsDb();
  if (access.isAdmin || access.campaigns.includes('*')) return ok({ campaigns: all });
  const own = new Set(access.campaigns);
  return ok({ campaigns: all.filter((c) => own.has(c)) });
}

/** GET /admin/agent-roster?campaign= — lista derivada + excepciones v4. */
async function adminRosterGet(
  access: import('../lib/access').UserAccess,
  rawCampaign?: string,
): Promise<APIGatewayProxyResultV2> {
  const campaign = (rawCampaign ?? '').trim();
  if (!campaign) return bad('falta campaign');
  if (!canManageAgents(access, campaign)) return bad('sin permiso', 403);
  try {
    return ok(await buildRosterView(campaign));
  } catch (e) {
    if (e instanceof RosterListError) return bad('roster no disponible', 503);
    throw e;
  }
}

/** POST /admin/agent-roster — fija excepciones (enabled) sin tocar lastSeen. */
async function adminRosterPost(
  access: import('../lib/access').UserAccess,
  body: { campaign?: unknown; agents?: unknown },
): Promise<APIGatewayProxyResultV2> {
  const campaign = typeof body?.campaign === 'string' ? body.campaign.trim() : '';
  if (!campaign) return bad('falta campaign');
  if (!canManageAgents(access, campaign)) return bad('sin permiso', 403);
  const parsed = parseRosterAgents(body.agents);
  if (!parsed.ok) return bad(parsed.error);
  if (!(await campaignExists(campaign))) return bad(`la campaña "${campaign}" no existe`, 400);

  let list;
  try {
    list = await readCampaignAgents(campaign);
  } catch (e) {
    if (e instanceof RosterListError) return bad('roster no disponible', 503);
    throw e;
  }
  const derived = new Map((list?.agents ?? []).map((a) => [normalizeId(a.username), a.cognitoUsername]));
  const notAgents = parsed.agents.filter((a) => a.enabled && !derived.has(normalizeId(a.operatorId)));
  if (notAgents.length > 0) {
    return bad(`no es agente de la campaña: ${notAgents.map((a) => a.operatorId).join(', ')}`, 409);
  }
  // operatorId canónico: el del pool si está en la lista; si no, el de una
  // entrada existente con el mismo username normalizado; si no, el recibido.
  const existing = new Map((await listCampaignAgents(campaign)).map((e) => [normalizeId(e.operatorId), e.operatorId]));
  const entries = parsed.agents.map((a) => {
    const n = normalizeId(a.operatorId);
    return { operatorId: derived.get(n) ?? existing.get(n) ?? a.operatorId, enabled: a.enabled };
  });
  await setAgentOverrides(campaign, entries, access.username);
  return ok(await buildRosterView(campaign, list));
}
