import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { listPending } from '@/server/backends/agentWorkspace';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** GET /api/agent/assignments/{campaign} — pendientes propios (v3 `GET /agent/assignments/{c}`). */
export const GET = withAccess<{ campaign: string }>(
  async (_req, { identity, campaign }) => jsonResponse(await listPending(identity.token, campaign)),
  { permission: PERMISSIONS.CAMPAIGN_SEND, campaignFrom: 'path', label: 'api/agent/assignments' },
);
