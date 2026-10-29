import { forbidden, requireAgentToken, rosterReason, type AgentAuthResponse } from '../lib/agentAuth';
import { requireAdminAccess } from '../lib/adminAccess';
import { adminError, adminInternal, adminOk, parseJsonBody, type AdminEvent, type AdminResult } from '../lib/adminHttp';
import { parseCampaign, parseCampaignParam } from '../lib/identifiers';
import { lookupWaStatus, markWaStatus, parseLookupBody, parseMarkBody, WaLookupIncompleteError } from '../lib/waStatus';
import type { AgentEvent } from './agentAssignments';
import { CONTACTS_DISTRIBUTE, CONTACTS_UPLOAD } from './adminContacts';

/**
 * Registro de estado de WhatsApp (add-whatsapp-status-registry, spec v3/whatsapp-status-registry):
 *
 *   POST /agent/wa-status                               marca manual del agente
 *   POST /agent/wa-status/lookup                        consulta (≤ 2000 teléfonos)
 *   POST /admin/campaigns/{campaign}/wa-status          marca manual de líder/supervisor
 *   POST /admin/campaigns/{campaign}/wa-status/lookup   consulta (vista previa de carga)
 *
 * La autorización se resuelve antes de tocar DynamoDB. Los logs no llevan teléfonos.
 */

type Result = { statusCode: number; headers: Record<string, string>; body: string };

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (statusCode: number, body: unknown): Result => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });
const ok = (data: unknown): Result => json(200, { success: true, data });
const fail = (statusCode: number, message: string): Result => json(statusCode, { success: false, message });
const internal = (context: string, e: unknown): Result => {
  if (e instanceof WaLookupIncompleteError) return fail(503, 'Registro de WhatsApp no disponible; intenta de nuevo');
  console.error(JSON.stringify({ evt: 'wa_status_error', context, name: (e as Error)?.name ?? 'Error' }));
  return fail(500, 'Error interno del servidor');
};

const bodyObject = (event: AgentEvent | AdminEvent): Record<string, unknown> | undefined => {
  const b = parseJsonBody(event as AdminEvent);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : undefined;
};

/** Agente del token con la campaña del body en su roster. */
async function agentInCampaign(event: AgentEvent, route: string): Promise<{ ok: true; username: string; campaign: string; body: Record<string, unknown> } | { ok: false; response: Result | AgentAuthResponse }> {
  const auth = await requireAgentToken(event, route);
  if (!auth.ok) return auth;
  const body = bodyObject(event);
  if (!body) return { ok: false, response: fail(400, 'Body inválido') };
  const campaign = parseCampaign(body.campaign);
  if (!campaign) return { ok: false, response: fail(400, 'Campaña inválida') };
  if ((await rosterReason(auth.username, campaign)) !== 'ok') return { ok: false, response: forbidden() };
  return { ok: true, username: auth.username, campaign, body };
}

/** POST /agent/wa-status {campaign, phones[], status, note?} */
export const agentMark = async (event: AgentEvent): Promise<Result | AgentAuthResponse> => {
  const a = await agentInCampaign(event, 'POST /agent/wa-status');
  if (!a.ok) return a.response;
  const input = parseMarkBody(a.body, a.campaign);
  if ('error' in input) return fail(400, input.error);
  try {
    const updated = input.phones.length ? await markWaStatus(input, a.username, 'agent_manual') : 0;
    console.log(JSON.stringify({ evt: 'wa_status_mark', scope: 'agent', campaign: a.campaign, by: a.username, status: input.status, phones: input.phones.length, updated, rejected: input.rejected.length }));
    return ok({ updated, rejected: input.rejected });
  } catch (e) {
    return internal('agentMark', e);
  }
};

/** POST /agent/wa-status/lookup {campaign, phones[]} */
export const agentLookup = async (event: AgentEvent): Promise<Result | AgentAuthResponse> => {
  const a = await agentInCampaign(event, 'POST /agent/wa-status/lookup');
  if (!a.ok) return a.response;
  const q = parseLookupBody(a.body);
  if ('error' in q) return fail(400, q.error);
  try {
    const items = await lookupWaStatus(q.phones);
    console.log(JSON.stringify({ evt: 'wa_status_lookup', scope: 'agent', campaign: a.campaign, by: a.username, phones: q.phones.length, found: Object.keys(items).length }));
    return ok({ items });
  } catch (e) {
    return internal('agentLookup', e);
  }
};

/** POST /admin/campaigns/{campaign}/wa-status */
export const adminMark = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const input = parseMarkBody(bodyObject(event), campaign);
  if ('error' in input) return adminError(400, input.error);
  const auth = await requireAdminAccess(event, { permissions: [CONTACTS_UPLOAD, CONTACTS_DISTRIBUTE], campaign });
  if (!auth.ok) return auth.response;
  try {
    const updated = input.phones.length ? await markWaStatus(input, auth.username, 'admin_manual') : 0;
    console.log(JSON.stringify({ evt: 'wa_status_mark', scope: 'admin', campaign, by: auth.username, status: input.status, phones: input.phones.length, updated, rejected: input.rejected.length }));
    return adminOk({ updated, rejected: input.rejected });
  } catch (e) {
    return adminInternal('adminMarkWaStatus', e);
  }
};

/** POST /admin/campaigns/{campaign}/wa-status/lookup */
export const adminLookup = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const q = parseLookupBody(bodyObject(event));
  if ('error' in q) return adminError(400, q.error);
  const auth = await requireAdminAccess(event, { permissions: [CONTACTS_UPLOAD], campaign });
  if (!auth.ok) return auth.response;
  try {
    const items = await lookupWaStatus(q.phones);
    console.log(JSON.stringify({ evt: 'wa_status_lookup', scope: 'admin', campaign, by: auth.username, phones: q.phones.length, found: Object.keys(items).length }));
    return adminOk({ items });
  } catch (e) {
    if (e instanceof WaLookupIncompleteError) return adminError(503, 'Registro de WhatsApp no disponible; intenta de nuevo');
    return adminInternal('adminLookupWaStatus', e);
  }
};
