import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { campaignResults, resultsQuery } from '@/server/backends/sendHistory';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** GET /api/campaigns/{campaign}/results?agent= — historial de envíos de la campaña (v3, líderes y supervisores). */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) =>
    jsonResponse(await campaignResults(identity.token, campaign, resultsQuery(new URL(req.url), { allowAgent: true }))),
  { permission: [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE], campaignFrom: 'path', label: 'api/campaign-results' },
);
