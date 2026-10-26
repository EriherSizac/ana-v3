import { requireAdminAccess } from '../lib/adminAccess';
import { adminError, adminInternal, adminOk, parseJsonBody, type AdminEvent, type AdminResult } from '../lib/adminHttp';
import { parseCampaignParam, parseUsername } from '../lib/identifiers';
import { getText } from '../lib/s3Json';
import {
  phoneDigits,
  readAllReviewItems,
  listReviewItems,
  ReviewConflictError,
  writeStates,
  type ItemRef,
  type StateEntry,
} from '../lib/reviewItems';
import { CONTACTS_DISTRIBUTE, CONTACTS_UPLOAD, manifestKey, type UploadManifest } from './adminContacts';

/**
 * Contactos por revisar (link-review-contacts-to-uploads), authorizer `cognitoAdminJwt`:
 *  GET  /admin/campaigns/{campaign}/review-items?uploadId=<id>|none
 *  POST /admin/campaigns/{campaign}/review-items/resolve
 * Ninguna ruta escribe ni borra bajo `review/` (solo `review-state/`).
 */

const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const ASSIGNMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS = 5000;
const PERMS = [CONTACTS_UPLOAD, CONTACTS_DISTRIBUTE];

/** Autorización de la revisión: el 403 (permiso o campaña) responde siempre "Sin permiso" (spec). */
async function authorize(event: AdminEvent, campaign: string) {
  const auth = await requireAdminAccess(event, { permissions: PERMS, campaign });
  if (!auth.ok && auth.response.statusCode === 403) return { ok: false as const, response: adminError(403, 'Sin permiso') };
  return auth;
}

export const listReview = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const uploadId = event.queryStringParameters?.uploadId ?? '';
  if (uploadId !== 'none' && !UPLOAD_ID_RE.test(uploadId)) return adminError(400, 'uploadId inválido');
  const auth = await authorize(event, campaign);
  if (!auth.ok) return auth.response;
  try {
    const items = await listReviewItems(campaign, uploadId);
    console.log(JSON.stringify({ evt: 'review_items_list', campaign, uploadId, by: auth.username, count: items.length }));
    return adminOk({ uploadId, items });
  } catch (e) {
    return adminInternal('listReview', e);
  }
};

interface ResolveBody {
  action: 'discard' | 'reassign';
  items: ItemRef[];
  reassignUploadId?: string;
}

export function parseResolveBody(body: unknown): ResolveBody | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body inválido' };
  const b = body as Record<string, unknown>;
  if (b.action !== 'discard' && b.action !== 'reassign') return { error: 'action inválida' };
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_ITEMS) return { error: `items debe tener entre 1 y ${MAX_ITEMS} elementos` };
  const items: ItemRef[] = [];
  const seen = new Set<string>();
  for (const it of b.items) {
    const agent = parseUsername((it as { agent?: unknown })?.agent);
    const assignmentId = (it as { assignmentId?: unknown })?.assignmentId;
    const phone = (it as { phone?: unknown })?.phone;
    if (!agent || typeof assignmentId !== 'string' || !ASSIGNMENT_ID_RE.test(assignmentId) || typeof phone !== 'string' || !phoneDigits(phone)) {
      return { error: 'Item inválido' };
    }
    const k = `${agent}/${assignmentId}/${phoneDigits(phone)}`;
    if (seen.has(k)) return { error: `Item repetido: ${k}` };
    seen.add(k);
    items.push({ agent, assignmentId, phone });
  }
  if (b.action === 'reassign') {
    if (typeof b.reassignUploadId !== 'string' || !UPLOAD_ID_RE.test(b.reassignUploadId)) return { error: 'reassignUploadId inválido' };
    return { action: 'reassign', items, reassignUploadId: b.reassignUploadId };
  }
  return { action: 'discard', items };
}

const refKey = (r: { agent: string; assignmentId: string; phone: string }) => `${r.agent}/${r.assignmentId}/${phoneDigits(r.phone)}`;

export const resolveReview = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const auth = await authorize(event, campaign);
  if (!auth.ok) return auth.response;
  const body = parseJsonBody(event);
  if (body === undefined) return adminError(400, 'Body inválido');
  const parsed = parseResolveBody(body);
  if ('error' in parsed) return adminError(400, parsed.error);

  try {
    // Los items deben existir en review/.
    const all = await readAllReviewItems(campaign);
    const byKey = new Map(all.map((i) => [refKey(i), i]));
    const missing = parsed.items.filter((r) => !byKey.has(refKey(r)));
    if (missing.length > 0) return adminError(400, 'Contactos inexistentes', { items: missing });

    let targetAgent: string | undefined;
    if (parsed.action === 'reassign') {
      const obj = await getText(manifestKey(campaign, parsed.reassignUploadId!));
      let manifest: UploadManifest | null = null;
      try {
        manifest = obj.text ? (JSON.parse(obj.text) as UploadManifest) : null;
      } catch {
        manifest = null;
      }
      const src = manifest?.source as { type?: string; items?: ItemRef[] } | undefined;
      const declared = new Set((src?.items ?? []).map((i) => refKey({ ...i, agent: i.agent.toLowerCase() })));
      if (!manifest || manifest.status !== 'completed' || src?.type !== 'review' || !parsed.items.every((r) => declared.has(refKey(r)))) {
        return adminError(409, 'Carga de reasignación no válida');
      }
      targetAgent = manifest.perAgent[0]?.agent;
    }

    // Items ya resueltos → 409 sin cambios (salvo reassigned con el mismo reassignUploadId).
    const conflicts = parsed.items.filter((r) => {
      const cur = byKey.get(refKey(r))!;
      if (cur.state === 'pending') return false;
      return !(parsed.action === 'reassign' && cur.state === 'reassigned' && cur.reassignUploadId === parsed.reassignUploadId);
    });
    if (conflicts.length > 0) return adminError(409, 'Contactos ya resueltos', { items: conflicts });

    const at = new Date().toISOString();
    await writeStates(campaign, parsed.items, (current) => {
      if (current) {
        // Idempotente: ya marcado con el mismo reassignUploadId → sin cambios (conserva by/at).
        if (parsed.action === 'reassign' && current.state === 'reassigned' && current.reassignUploadId === parsed.reassignUploadId) return null;
        throw new ReviewConflictError('Contactos ya resueltos');
      }
      const entry: StateEntry =
        parsed.action === 'discard'
          ? { state: 'discarded', by: auth.username, at }
          : { state: 'reassigned', by: auth.username, at, reassignUploadId: parsed.reassignUploadId!, ...(targetAgent ? { targetAgent } : {}) };
      return entry;
    });

    const after = await readAllReviewItems(campaign);
    const wanted = new Set(parsed.items.map(refKey));
    const items = after.filter((i) => wanted.has(refKey(i))).map(({ uploadId: _u, ...rest }) => rest);
    console.log(JSON.stringify({ evt: 'review_items_resolve', campaign, action: parsed.action, by: auth.username, count: items.length, reassignUploadId: parsed.reassignUploadId ?? null }));
    return adminOk({ items });
  } catch (e) {
    if (e instanceof ReviewConflictError) return adminError(409, e.message);
    return adminInternal('resolveReview', e);
  }
};
