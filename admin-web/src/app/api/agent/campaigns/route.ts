import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { agentCampaigns } from '@/server/backends/agentWorkspace';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** GET /api/agent/campaigns — campañas donde el usuario está habilitado en v3 (`GET /agent/campaigns`). */
export const GET = withAccess(async (_req, { identity }) => jsonResponse({ campaigns: await agentCampaigns(identity.token) }), {
  permission: PERMISSIONS.CAMPAIGN_SEND,
  label: 'api/agent/campaigns',
});
