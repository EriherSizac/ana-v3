import { campaignInScope, requireAdminAccess, type AdminAccess } from '../lib/adminAccess';
import { adminError, adminJson, type AdminEvent, type AdminResult } from '../lib/adminHttp';
import { parseCampaignParam, parseUsernameParam } from '../lib/identifiers';
import { InvalidFilterError, LegacyDataError, readConversation, readIndex, readLegacyAgents, searchIndex, validateFilters } from '../lib/legacyChats';
import { normalizePathSegment } from '../lib/campaign';

/**
 * Historial legado (solo GET; authorizer `cognitoAdminJwt`):
 *  GET /admin/campaigns/{campaign}/legacy-chats
 *  GET /admin/campaigns/{campaign}/legacy-chats/{agent}/{phone}
 *  GET /admin/campaigns/{campaign}/legacy-agents
 * Acceso: admins en cualquier campaña; líderes solo en las suyas (design D2).
 */

/** Regla de acceso al historial legado. */
export const legacyAllowed = (a: AdminAccess, campaign: string): boolean => a.isAdmin || (a.isLeader && campaignInScope(a, campaign));

/** Resuelve el acceso con v4 `/me` (503 si falla) y aplica la regla (403) sin tocar S3. */
export async function requireLegacyChatAccess(event: AdminEvent, campaign: string) {
  return requireAdminAccess(event, { check: (a) => legacyAllowed(a, campaign) });
}

/** Línea de auditoría (design D5): sin cuerpos, URLs firmadas ni tokens. */
function audit(user: string, campaign: string, route: string, status: number, agent: string | null = null, phone: string | null = null) {
  console.log(JSON.stringify({ evt: 'legacy_chat_access', user, campaign, agent, phone, route, status }));
}

const internal = (e: unknown, context: string): AdminResult => {
  const err = e as { name?: string };
  console.error(JSON.stringify({ evt: 'legacy_chat_error', context, name: err?.name ?? 'Error', legacy: e instanceof LegacyDataError }));
  return adminError(500, 'Error interno del servidor');
};

export const searchLegacyChats = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  let filters;
  try {
    filters = validateFilters(event.queryStringParameters ?? {});
  } catch (e) {
    if (e instanceof InvalidFilterError) return adminError(400, e.message);
    throw e;
  }
  const auth = await requireLegacyChatAccess(event, campaign);
  if (!auth.ok) return auth.response;
  try {
    const result = searchIndex(await readIndex(campaign), filters);
    audit(auth.username, campaign, 'search', 200, filters.agent ?? null, filters.phone ?? null);
    return adminJson(200, result);
  } catch (e) {
    audit(auth.username, campaign, 'search', 500, filters.agent ?? null, filters.phone ?? null);
    return internal(e, 'searchLegacyChats');
  }
};

export const getLegacyChat = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const agent = parseUsernameParam(event.pathParameters?.agent);
  const phone = normalizePathSegment(event.pathParameters?.phone);
  if (!agent) return adminError(400, 'Agente inválido');
  if (!phone || !/^[0-9a-z@._+-]{1,64}$/.test(phone)) return adminError(400, 'Teléfono inválido');
  const auth = await requireLegacyChatAccess(event, campaign);
  if (!auth.ok) return auth.response;
  try {
    const messages = await readConversation(campaign, agent, phone);
    if (!messages) {
      audit(auth.username, campaign, 'conversation', 404, agent, phone);
      return adminJson(404, { error: 'not_found' });
    }
    audit(auth.username, campaign, 'conversation', 200, agent, phone);
    return adminJson(200, { campaign, agent, phone, messages });
  } catch (e) {
    audit(auth.username, campaign, 'conversation', 500, agent, phone);
    return internal(e, 'getLegacyChat');
  }
};

export const getLegacyAgents = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const auth = await requireLegacyChatAccess(event, campaign);
  if (!auth.ok) return auth.response;
  try {
    const { agents, extractedAt } = await readLegacyAgents(campaign);
    return adminJson(200, { campaign, agents, extractedAt });
  } catch (e) {
    return internal(e, 'getLegacyAgents');
  }
};
