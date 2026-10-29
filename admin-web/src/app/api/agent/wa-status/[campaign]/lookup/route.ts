import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { agentLookup, parseLookupInput } from '@/server/backends/waStatus';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** POST /api/agent/wa-status/{campaign}/lookup {phones} — estado de WhatsApp para Mi asignación (v3). */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => jsonResponse(await agentLookup(identity.token, campaign, await parseLookupInput(req))),
  { permission: PERMISSIONS.CAMPAIGN_SEND, campaignFrom: 'path', label: 'api/agent/wa-status/lookup' },
);
