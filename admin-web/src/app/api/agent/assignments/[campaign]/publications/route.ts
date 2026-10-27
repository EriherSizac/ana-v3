import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { listPublications } from '@/server/backends/agentWorkspace';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** GET /api/agent/assignments/{campaign}/publications — historial propio (v3). */
export const GET = withAccess<{ campaign: string }>(
  async (_req, { identity, campaign }) => jsonResponse(await listPublications(identity.token, campaign)),
  { permission: PERMISSIONS.CAMPAIGN_SEND, campaignFrom: 'path', label: 'api/agent/publications' },
);
