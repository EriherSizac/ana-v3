import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { agentMark, parseMarkInput } from '@/server/backends/waStatus';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** POST /api/agent/wa-status/{campaign} {phones, status, note?} — marca manual del agente (v3 `POST /agent/wa-status`). */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => {
    const input = await parseMarkInput(req);
    const res = await agentMark(identity.token, campaign, input);
    console.log(JSON.stringify({ evt: 'wa_status_mark', campaign, by: identity.username, status: input.status, phones: input.phones.length, updated: res.updated ?? null }));
    return jsonResponse(res);
  },
  { permission: PERMISSIONS.CAMPAIGN_SEND, campaignFrom: 'path', label: 'api/agent/wa-status' },
);
