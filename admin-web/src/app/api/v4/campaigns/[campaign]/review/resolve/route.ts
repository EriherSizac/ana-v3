import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { callUpstream, upstreamMessage } from '@/server/backends/http';
import { ensureOk } from '@/server/backends/v4';
import { serverEnv } from '@/server/env';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 100;

/**
 * POST /api/v4/campaigns/{campaign}/review/resolve
 * `{action:"discard"|"requeue", items:[{operatorId,jobId}], to?}` → v4
 * `POST /jobs/review/resolve`. El log solo lleva campaña, acción, usuario y conteo.
 */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign, campaignRaw }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const b = (body ?? {}) as { action?: unknown; items?: unknown; to?: unknown };
    if (b.action !== 'discard' && b.action !== 'requeue') throw new HttpError('invalid_request', 'Acción inválida');
    if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError('invalid_request', 'Selecciona contactos');
    if (b.items.length > MAX_ITEMS) throw new HttpError('invalid_request', `Máximo ${MAX_ITEMS} contactos por acción`);
    const items = b.items.map((i) => {
      const it = (i ?? {}) as { operatorId?: unknown; jobId?: unknown };
      if (typeof it.operatorId !== 'string' || !it.operatorId || typeof it.jobId !== 'string' || !it.jobId) {
        throw new HttpError('invalid_request', 'Contacto inválido');
      }
      return { operatorId: it.operatorId, jobId: it.jobId };
    });
    if (b.to !== undefined && (typeof b.to !== 'string' || !b.to.trim())) throw new HttpError('invalid_request', 'Agente destino inválido');
    const to = typeof b.to === 'string' ? b.to.trim() : undefined;

    const res = await callUpstream<{ results?: unknown }>(`${serverEnv().v4ApiBase}/jobs/review/resolve`, {
      method: 'POST',
      token: identity.token,
      body: { campaign: campaignRaw, action: b.action, items, ...(b.action === 'requeue' && to ? { to } : {}) },
      label: 'v4:jobs-review-resolve',
    });
    console.log(JSON.stringify({ evt: 'v4_review_resolve', campaign, action: b.action, by: identity.username, count: items.length, status: res.status }));
    if (res.status === 400) throw new HttpError('invalid_request', upstreamMessage(res.data));
    const data = ensureOk(res, 'v4:jobs-review-resolve');
    return jsonResponse({ results: Array.isArray(data?.results) ? data.results : [] });
  },
  { permission: [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE], campaignFrom: 'path', label: 'api/v4/review-resolve' },
);
