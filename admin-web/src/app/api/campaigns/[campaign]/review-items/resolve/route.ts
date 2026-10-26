import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { callUpstream, upstreamMessage } from '@/server/backends/http';
import { ensureOk } from '@/server/backends/v4';
import { serverEnv } from '@/server/env';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/campaigns/{campaign}/review-items/resolve
 * `{action:"discard"|"reassign", items:[{agent,assignmentId,phone}], reassignUploadId?}` → v3.
 * El log solo lleva campaña, acción, usuario y conteo (nunca teléfonos).
 */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const b = (body ?? {}) as { action?: unknown; items?: unknown; reassignUploadId?: unknown };
    if (b.action !== 'discard' && b.action !== 'reassign') throw new HttpError('invalid_request', 'Acción inválida');
    if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError('invalid_request', 'Selecciona contactos');
    const res = await callUpstream<{ data?: unknown; message?: string }>(
      `${serverEnv().v3ApiBase}/admin/campaigns/${encodeURIComponent(campaign)}/review-items/resolve`,
      {
        method: 'POST',
        token: identity.token,
        body: { action: b.action, items: b.items, ...(b.reassignUploadId ? { reassignUploadId: b.reassignUploadId } : {}) },
        label: 'v3:review-resolve',
      },
    );
    console.log(JSON.stringify({ evt: 'review_resolve', campaign, action: b.action, by: identity.username, count: b.items.length, status: res.status }));
    if (res.status === 409) throw new HttpError('conflict', upstreamMessage(res.data) ?? 'Los contactos cambiaron; recarga', (res.data as { data?: Record<string, unknown> })?.data);
    if (res.status === 400) throw new HttpError('invalid_request', upstreamMessage(res.data));
    return jsonResponse(ensureOk(res, 'v3:review-resolve').data);
  },
  { permission: [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE], campaignFrom: 'path', label: 'api/review-resolve' },
);
