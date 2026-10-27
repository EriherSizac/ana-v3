import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { enabledRecipients, getRoster } from '@/server/backends/rosters';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/{campaign}/enabled-agents?fleet=v3|v4&includeSupervisors=1
 * Destinatarios habilitados (regla efectiva de cada flota) para el formulario de
 * carga: agentes y, con `includeSupervisors`, también supervisores
 * (`supervisors` = cuáles de `agents` lo son, para etiquetarlos).
 */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign, campaignRaw }) => {
    const params = new URL(req.url).searchParams;
    const fleet = params.get('fleet');
    if (fleet !== 'v3' && fleet !== 'v4') throw new HttpError('invalid_request', 'Flota inválida');
    const includeSupervisors = ['1', 'true'].includes(params.get('includeSupervisors') ?? '');
    const roster = await getRoster(fleet, identity.token, fleet === 'v4' ? campaignRaw : campaign);
    return jsonResponse({
      campaign,
      fleet,
      generatedAt: roster.generatedAt,
      includeSupervisors,
      ...enabledRecipients(roster, includeSupervisors),
    });
  },
  { permission: [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE], campaignFrom: 'path', label: 'api/enabled-agents' },
);
