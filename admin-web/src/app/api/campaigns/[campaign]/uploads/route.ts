import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { deliverV3, deliverV4, newUploadId, parseUploadRequest, verifyPlan } from '@/server/contacts/delivery';
import { v3History, v4History } from '@/server/contacts/history';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';
// La entrega a v3 puede tardar (hasta 200 archivos) y el PUT a v4 sube hasta 10 MB.
export const maxDuration = 60;

const MAX_BODY_BYTES = 11 * 1024 * 1024;

/** Sección Contactos: admin o upload + distribute (spec admin-web/contact-upload). */
const SECTION_PERMISSIONS = [PERMISSIONS.CONTACTS_UPLOAD, PERMISSIONS.CONTACTS_DISTRIBUTE];

/**
 * POST /api/campaigns/{campaign}/uploads — verifica el plan con el roster
 * vigente y entrega a v3 (archivos por agente) o v4 (presign + PUT).
 * Nunca registra contenido del CSV: solo campaña, flota, usuario, ids y conteos.
 */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign, campaignRaw }) => {
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) throw new HttpError('payload_too_large');
    const text = await req.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new HttpError('payload_too_large');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const upload = parseUploadRequest(body);
    const names = { v3: campaign, v4: campaignRaw };
    const verified = await verifyPlan(upload, identity.token, names);
    const log = { evt: 'contacts_upload', campaign, fleet: upload.fleet, by: identity.username, rows: verified.valid.length, agents: verified.plan.agents.length };

    if (upload.fleet === 'v3') {
      const uploadId = newUploadId();
      try {
        const manifest = await deliverV3(upload, verified, identity.token, campaign, uploadId);
        console.log(JSON.stringify({ ...log, uploadId, status: manifest.status }));
        return jsonResponse({ fleet: 'v3', status: 'completed', uploadId, manifest });
      } catch (e) {
        console.error(JSON.stringify({ ...log, uploadId, status: 'failed', code: e instanceof HttpError ? e.code : 'internal' }));
        throw e;
      }
    }
    try {
      const { srcKey } = await deliverV4(upload, verified, identity.token, campaignRaw);
      console.log(JSON.stringify({ ...log, srcKey, status: 'uploaded' }));
      return jsonResponse({ fleet: 'v4', status: 'processing', srcKey });
    } catch (e) {
      console.error(JSON.stringify({ ...log, status: 'failed', code: e instanceof HttpError ? e.code : 'internal' }));
      throw e;
    }
  },
  { permission: SECTION_PERMISSIONS, campaignFrom: 'path', label: 'api/campaigns/uploads' },
);

/** GET /api/campaigns/{campaign}/uploads?fleet=v3|v4&srcKey= — historial normalizado. */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign, campaignRaw }) => {
    const url = new URL(req.url);
    const fleet = url.searchParams.get('fleet');
    if (fleet !== 'v3' && fleet !== 'v4') throw new HttpError('invalid_request', 'Flota inválida');
    const items =
      fleet === 'v3' ? await v3History(identity.token, campaign) : await v4History(identity.token, campaignRaw, url.searchParams.get('srcKey'));
    return jsonResponse({ campaign, fleet, items });
  },
  { permission: SECTION_PERMISSIONS, campaignFrom: 'path', label: 'api/campaigns/uploads:list' },
);
