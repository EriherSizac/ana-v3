import { cliVersionOf, forbidden, requireAgentToken, rosterReason, type AgentAuthResponse } from '../lib/agentAuth';
import { requireAdminAccess } from '../lib/adminAccess';
import { adminError, adminInternal, adminOk, type AdminEvent, type AdminResult } from '../lib/adminHttp';
import { parseCampaign, parseCampaignParam, parseUsername } from '../lib/identifiers';
import { MAX_BATCH, parseResultItems, parseResultsQuery, queryResults, resultAgents, writeResults } from '../lib/sendResults';
import { recordResults } from '../lib/waStatus';
import type { AgentEvent } from './agentAssignments';
import { CONTACTS_DISTRIBUTE, CONTACTS_UPLOAD } from './adminContacts';

/**
 * Historial de envíos (add-agent-send-history, spec v3/agent-send-history):
 *
 *   POST /agent/results                      el CLI reporta resultados (lote ≤ 100)
 *   GET  /agent/results/{campaign}           historial propio del agente
 *   GET  /admin/campaigns/{campaign}/results líderes/supervisores (filtro `agent`)
 *
 * El agente es siempre el del token. Los logs nunca llevan teléfonos ni mensajes.
 */

type Result = { statusCode: number; headers: Record<string, string>; body: string };

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (statusCode: number, body: unknown): Result => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });
const ok = (data: unknown): Result => json(200, { success: true, data });
const fail = (statusCode: number, message: string): Result => json(statusCode, { success: false, message });
const internal = (context: string, e: unknown): Result => {
  console.error(JSON.stringify({ evt: 'send_results_error', context, name: (e as Error)?.name ?? 'Error' }));
  return fail(500, 'Error interno del servidor');
};

const parseBody = (event: AgentEvent): unknown => {
  if (event.body == null || event.body === '') return undefined;
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
  } catch {
    return undefined;
  }
};

/** POST /agent/results */
export const postResults = async (event: AgentEvent): Promise<Result | AgentAuthResponse> => {
  const auth = await requireAgentToken(event, 'POST /agent/results');
  if (!auth.ok) return auth.response;
  const body = parseBody(event) as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Body inválido');
  const campaign = parseCampaign(body.campaign);
  if (!campaign) return fail(400, 'Campaña inválida');
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_BATCH) {
    return fail(400, `items debe tener entre 1 y ${MAX_BATCH} elementos`);
  }
  if ((await rosterReason(auth.username, campaign)) !== 'ok') return forbidden();
  const agent = auth.username;
  const now = new Date();
  const parsed = parseResultItems(body.items, campaign, agent, now.getTime());
  try {
    const { written, duplicates } = parsed.items.length > 0 ? await writeResults(campaign, agent, parsed.items, cliVersionOf(event), now) : { written: [], duplicates: [] };
    // Registro de WhatsApp (add-whatsapp-status-registry D4): de mejor esfuerzo, nunca falla el lote.
    await recordResults(parsed.items, campaign, agent);
    console.log(
      JSON.stringify({
        evt: 'send_results_post',
        campaign,
        agent,
        accepted: parsed.items.length,
        rejected: parsed.rejected.length,
        batches: written.length,
        duplicateBatches: duplicates.length,
        cliVersion: cliVersionOf(event),
      }),
    );
    return ok({ accepted: parsed.items.length, rejected: parsed.rejected });
  } catch (e) {
    return internal('postResults', e);
  }
};

/** GET /agent/results/{campaign} */
export const getOwnResults = async (event: AgentEvent): Promise<Result | AgentAuthResponse> => {
  const auth = await requireAgentToken(event, 'GET /agent/results');
  if (!auth.ok) return auth.response;
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return fail(400, 'Campaña inválida');
  const query = parseResultsQuery(event.queryStringParameters);
  if ('error' in query) return fail(400, query.error);
  if ((await rosterReason(auth.username, campaign)) !== 'ok') return forbidden();
  try {
    const page = await queryResults(campaign, [auth.username], query);
    console.log(JSON.stringify({ evt: 'send_results_get', scope: 'agent', campaign, agent: auth.username, total: page.total }));
    return ok({ campaign, agent: auth.username, agents: [auth.username], ...page });
  } catch (e) {
    return internal('getOwnResults', e);
  }
};

/** GET /admin/campaigns/{campaign}/results?agent= */
export const getCampaignResults = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const qs = event.queryStringParameters ?? {};
  const agentFilter = qs.agent ? parseUsername(qs.agent) : null;
  if (qs.agent && !agentFilter) return adminError(400, 'agent inválido');
  const query = parseResultsQuery(qs);
  if ('error' in query) return adminError(400, query.error);
  const auth = await requireAdminAccess(event, { permissions: [CONTACTS_UPLOAD, CONTACTS_DISTRIBUTE], campaign });
  if (!auth.ok) return auth.response.statusCode === 403 ? adminError(403, 'Sin permiso') : auth.response;
  try {
    const agents = await resultAgents(campaign);
    const selected = agentFilter ? [agentFilter] : agents;
    const page = await queryResults(campaign, selected, query);
    console.log(JSON.stringify({ evt: 'send_results_get', scope: 'campaign', campaign, by: auth.username, agent: agentFilter, total: page.total }));
    return adminOk({ campaign, agent: agentFilter, agents, ...page });
  } catch (e) {
    return adminInternal('getCampaignResults', e);
  }
};
