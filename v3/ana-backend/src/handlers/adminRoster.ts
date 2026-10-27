import { hasPermission, requireAdminAccess, type AdminAccess } from '../lib/adminAccess';
import { adminError, adminInternal, adminOk, parseJsonBody, type AdminEvent, type AdminResult } from '../lib/adminHttp';
import { parseCampaignParam, parseUsername } from '../lib/identifiers';
import {
  NotAgentError,
  RosterConflictError,
  RosterError,
  readEffectiveRoster,
  updateRoster,
  type RosterChange,
} from '../lib/roster';

/**
 * GET  /admin/campaigns/{campaign}/roster
 * POST /admin/campaigns/{campaign}/roster/agents
 * (authorizer `cognitoAdminJwt`; spec v3/agent-roster)
 */

export const AGENTS_MANAGE = 'ana:admin:agents:manage';
const CONTACTS_UPLOAD = 'ana:contacts:list:upload';
const CONTACTS_DISTRIBUTE = 'ana:contacts:list:distribute';

/**
 * Lectura del roster (add-supervisor-contact-access D4): gestión de agentes, o
 * carga Y reparto de contactos (supervisores). La escritura exige gestión.
 */
export const canReadRoster = (a: AdminAccess): boolean =>
  hasPermission(a, AGENTS_MANAGE) || (hasPermission(a, CONTACTS_UPLOAD) && hasPermission(a, CONTACTS_DISTRIBUTE));
const MAX_AGENTS = 200;

const handleRosterError = (e: unknown, context: string): AdminResult => {
  if (e instanceof RosterError) {
    console.error(JSON.stringify({ evt: 'roster_error', context, message: e.message }));
    return adminError(500, 'Roster ilegible');
  }
  if (e instanceof RosterConflictError) return adminError(409, 'El roster cambió, intenta de nuevo');
  if (e instanceof NotAgentError) return adminError(409, 'No es agente de la campaña', { agents: e.agents });
  return adminInternal(context, e);
};

export const getRoster = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const auth = await requireAdminAccess(event, { check: canReadRoster, campaign });
  if (!auth.ok) return auth.response;
  try {
    return adminOk(await readEffectiveRoster(campaign));
  } catch (e) {
    return handleRosterError(e, 'getRoster');
  }
};

/** Valida `{"agents":[{"username","enabled"}]}`. Devuelve los cambios o el mensaje de error. */
export function parseRosterBody(body: unknown): { changes: RosterChange[] } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body inválido' };
  const agents = (body as { agents?: unknown }).agents;
  if (!Array.isArray(agents) || agents.length === 0) return { error: 'agents debe tener al menos un elemento' };
  if (agents.length > MAX_AGENTS) return { error: `agents admite como máximo ${MAX_AGENTS} elementos` };
  const seen = new Set<string>();
  const changes: RosterChange[] = [];
  for (const a of agents) {
    if (!a || typeof a !== 'object') return { error: 'Agente inválido' };
    const username = parseUsername((a as { username?: unknown }).username);
    if (!username) return { error: 'Usuario inválido' };
    const enabled = (a as { enabled?: unknown }).enabled;
    if (typeof enabled !== 'boolean') return { error: 'enabled debe ser booleano' };
    if (seen.has(username)) return { error: `Usuario repetido: ${username}` };
    seen.add(username);
    changes.push({ username, enabled });
  }
  return { changes };
}

export const updateRosterAgents = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const auth = await requireAdminAccess(event, { permissions: [AGENTS_MANAGE], campaign });
  if (!auth.ok) return auth.response;

  const body = parseJsonBody(event);
  if (body === undefined) return adminError(400, 'Body inválido');
  const parsed = parseRosterBody(body);
  if ('error' in parsed) return adminError(400, parsed.error);

  try {
    const roster = await updateRoster(campaign, parsed.changes, auth.username);
    console.log(
      JSON.stringify({
        evt: 'roster_update',
        campaign,
        by: auth.username,
        changes: parsed.changes.length,
        disabled: parsed.changes.filter((c) => !c.enabled).length,
      }),
    );
    return adminOk(roster);
  } catch (e) {
    return handleRosterError(e, 'updateRosterAgents');
  }
};
