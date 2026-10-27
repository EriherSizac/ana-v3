import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { parsePublishInput, publish } from '@/server/backends/agentWorkspace';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/agent/assignments/{campaign}/publish {template, phoneColumns, sources}
 * Genera el `publishId` y publica en v3 con el token del usuario. Los logs solo
 * llevan campaña, usuario, `publishId`, código y conteos.
 */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const input = parsePublishInput(body);
    const rows = input.sources.reduce((n, s) => n + s.rows.length, 0);
    const log = { evt: 'agent_publish', campaign, by: identity.username, sources: input.sources.length, rows };
    let publishId: string | undefined;
    try {
      const res = await publish(identity.token, campaign, input);
      publishId = res.publishId;
      console.log(JSON.stringify({ ...log, publishId, status: 'completed', contacts: res.manifest.contacts ?? null }));
      return jsonResponse({ publishId, manifest: res.manifest });
    } catch (e) {
      console.error(JSON.stringify({ ...log, publishId: publishId ?? null, status: 'failed', code: e instanceof HttpError ? e.code : 'internal' }));
      throw e;
    }
  },
  { permission: PERMISSIONS.CAMPAIGN_SEND, campaignFrom: 'path', label: 'api/agent/publish' },
);
