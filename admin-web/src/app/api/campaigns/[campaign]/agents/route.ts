import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { updateRoster, type Fleet } from '@/server/backends/rosters';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

const MAX_AGENTS = 100; // límite de v4 (v3 admite 200)
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/;

function parseBody(body: unknown): { fleet: Fleet; agents: Array<{ username: string; enabled: boolean }> } {
  if (!body || typeof body !== 'object') throw new HttpError('invalid_request', 'Solicitud inválida');
  const { fleet, agents } = body as { fleet?: unknown; agents?: unknown };
  if (fleet !== 'v3' && fleet !== 'v4') throw new HttpError('invalid_request', 'Flota inválida');
  if (!Array.isArray(agents) || agents.length === 0 || agents.length > MAX_AGENTS) {
    throw new HttpError('invalid_request', `Selecciona entre 1 y ${MAX_AGENTS} agentes`);
  }
  const seen = new Set<string>();
  const out = agents.map((a) => {
    const username = typeof a?.username === 'string' ? a.username.trim() : '';
    if (!USERNAME_RE.test(username)) throw new HttpError('invalid_request', 'Usuario inválido');
    if (typeof a?.enabled !== 'boolean') throw new HttpError('invalid_request', 'Estado inválido');
    if (seen.has(username.toLowerCase())) throw new HttpError('invalid_request', `Usuario repetido: ${username}`);
    seen.add(username.toLowerCase());
    return { username, enabled: a.enabled as boolean };
  });
  return { fleet, agents: out };
}

/**
 * POST /api/campaigns/{campaign}/agents  {fleet, agents:[{username, enabled}]}
 * Excepciones del roster de una flota con el token del usuario.
 */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign, campaignRaw }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const { fleet, agents } = parseBody(body);
    // v3 usa la campaña normalizada; v4, el nombre del catálogo tal cual.
    const roster = await updateRoster(fleet, identity.token, fleet === 'v4' ? campaignRaw : campaign, agents);
    return jsonResponse({ fleet, roster });
  },
  { permission: PERMISSIONS.AGENTS_MANAGE, campaignFrom: 'path', label: 'api/campaigns/agents' },
);
