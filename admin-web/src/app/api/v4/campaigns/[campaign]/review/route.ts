import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { callUpstream } from '@/server/backends/http';
import { ensureOk } from '@/server/backends/v4';
import { serverEnv } from '@/server/env';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** srcKey de una carga v4 (`csv-uploads/<usuario>/<epochMs>_<archivo>`). */
const SRC_KEY_RE = /^csv-uploads\/[\w.-]+\/[\w.-]+$/;

/**
 * GET /api/v4/campaigns/{campaign}/review[?srcKey=] → v4 `GET /jobs/review`
 * (v4-review-interrupted-sends) con el id token del usuario. Sin registrar
 * datos de contactos.
 */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign, campaignRaw }) => {
    const srcKey = new URL(req.url).searchParams.get('srcKey');
    if (srcKey !== null && (srcKey.length > 1024 || !SRC_KEY_RE.test(srcKey))) throw new HttpError('invalid_request', 'srcKey inválido');
    const qs = new URLSearchParams({ campaign: campaignRaw });
    if (srcKey) qs.set('srcKey', srcKey);
    const res = await callUpstream<{ items?: unknown }>(`${serverEnv().v4ApiBase}/jobs/review?${qs.toString()}`, {
      token: identity.token,
      label: 'v4:jobs-review',
    });
    const data = ensureOk(res, 'v4:jobs-review');
    return jsonResponse({ campaign, items: Array.isArray(data?.items) ? data.items : [] });
  },
  { permission: [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE], campaignFrom: 'path', label: 'api/v4/review' },
);
