import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { agentResults, resultsQuery } from '@/server/backends/sendHistory';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** GET /api/agent/results/{campaign} — historial de envíos propio (v3 `GET /agent/results/{c}`). */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) =>
    jsonResponse(await agentResults(identity.token, campaign, resultsQuery(new URL(req.url), { allowAgent: false }))),
  { permission: PERMISSIONS.CAMPAIGN_SEND, campaignFrom: 'path', label: 'api/agent/results' },
);
