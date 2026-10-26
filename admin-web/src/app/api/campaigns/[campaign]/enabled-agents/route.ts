import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { getRoster } from '@/server/backends/rosters';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/{campaign}/enabled-agents?fleet=v3|v4
 * Agentes habilitados (regla efectiva de cada flota) para el formulario de carga.
 */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign, campaignRaw }) => {
    const fleet = new URL(req.url).searchParams.get('fleet');
    if (fleet !== 'v3' && fleet !== 'v4') throw new HttpError('invalid_request', 'Flota inválida');
    const roster = await getRoster(fleet, identity.token, fleet === 'v4' ? campaignRaw : campaign);
    return jsonResponse({
      campaign,
      fleet,
      generatedAt: roster.generatedAt,
      agents: roster.agents.filter((a) => a.enabled).map((a) => a.username),
    });
  },
  { permission: [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE], campaignFrom: 'path', label: 'api/enabled-agents' },
);
