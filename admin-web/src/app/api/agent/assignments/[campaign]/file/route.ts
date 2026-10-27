import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { readPending } from '@/server/backends/agentWorkspace';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** GET /api/agent/assignments/{campaign}/file?key= — contenido de un pendiente propio (v3 decide la propiedad). */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => {
    const key = new URL(req.url).searchParams.get('key') ?? '';
    if (!key || key.length > 512) throw new HttpError('invalid_request', 'Archivo inválido');
    return jsonResponse(await readPending(identity.token, campaign, key));
  },
  { permission: PERMISSIONS.CAMPAIGN_SEND, campaignFrom: 'path', label: 'api/agent/file' },
);
