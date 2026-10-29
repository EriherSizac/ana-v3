import { PERMISSIONS } from '@/lib/access';
import { LIMITS } from '@/lib/contacts';
import { withAccess } from '@/server/access/withAccess';
import { newUploadId, presignV3 } from '@/server/contacts/delivery';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/campaigns/{campaign}/uploads/presign — carga v3 grande
 * (support-crm-base-upload): pide a v3 una URL firmada (PUT, 15 min) para
 * que el navegador suba el CSV maestro directo a S3 (sin pasar por el BFF).
 * Body `{ fleet: 'v3', bytes }`; responde `{ uploadId, sourceKey, url, headers, expiresIn }`.
 */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => {
    let body: { fleet?: unknown; bytes?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    if (body?.fleet !== 'v3') throw new HttpError('invalid_request', 'La carga por S3 solo aplica a v3');
    const bytes = body.bytes;
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) throw new HttpError('invalid_request', 'Tamaño inválido');
    if (bytes > LIMITS.v3.maxBytes) throw new HttpError('payload_too_large', `El archivo supera ${LIMITS.v3.label} para v3`);
    const uploadId = newUploadId();
    const signed = await presignV3(identity.token, campaign, uploadId, bytes);
    console.log(JSON.stringify({ evt: 'contacts_presign', campaign, fleet: 'v3', by: identity.username, uploadId, bytes }));
    return jsonResponse({ uploadId: signed.uploadId, sourceKey: signed.sourceKey, url: signed.url, headers: signed.headers, expiresIn: signed.expiresIn });
  },
  { permission: [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE], campaignFrom: 'path', label: 'api/campaigns/uploads:presign' },
);
