import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { callUpstream } from '@/server/backends/http';
import { ensureOk } from '@/server/backends/v4';
import { serverEnv } from '@/server/env';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** GET /api/campaigns/{campaign}/review-items?uploadId=<id>|none → v3 (sin registrar datos de contactos). */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => {
    const uploadId = new URL(req.url).searchParams.get('uploadId') ?? '';
    if (uploadId !== 'none' && !UPLOAD_ID_RE.test(uploadId)) throw new HttpError('invalid_request', 'uploadId inválido');
    const res = await callUpstream<{ data?: unknown }>(
      `${serverEnv().v3ApiBase}/admin/campaigns/${encodeURIComponent(campaign)}/review-items?uploadId=${encodeURIComponent(uploadId)}`,
      { token: identity.token, label: 'v3:review-items' },
    );
    return jsonResponse(ensureOk(res, 'v3:review-items').data);
  },
  { permission: [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE], campaignFrom: 'path', label: 'api/review-items' },
);
