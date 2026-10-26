// File: api
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  listConversations,
  listMessages,
  putMessage,
  putConversationMeta,
  markRead,
} from '../lib/conversations';
import { s3, CSV_BUCKET, MEDIA_BUCKET } from '../lib/s3';
import { ok, bad, claimUser } from '../lib/http';
import { resolveUserAccess, can, type UserAccess } from '../lib/access';
import { ANA_PERMISSIONS, sanitizeRolePermissions } from '../lib/permissions';
import { setRolePermissions, getRolePermissions } from '../lib/rolePerms';
import { invalidateByRole } from '../lib/accessCache';
import { checkAssignmentsEnabled, getDistributableAgents } from '../lib/distribution';
import { campaignExists } from '../lib/campaignsDb';
import { listAllRoles } from '../lib/roles';
import { listUploads } from '../lib/uploads';

/**
 * Resuelve el operador cuyas conversaciones se van a leer y autoriza el acceso.
 *  - sin operatorId, o == self → el propio usuario.
 *  - admin → cualquier operador.
 *  - líder con team-view → solo agentes de sus campañas.
 * Devuelve el operatorId o null si no está autorizado.
 */
async function resolveViewTarget(
  access: UserAccess,
  requested?: string,
): Promise<string | null> {
  const target = requested ?? access.username;
  if (target === access.username) return target;
  // "Ver como" (leer conversaciones de otro agente): SOLO admins.
  if (access.isAdmin) return target;
  return null;
}

const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const user = claimUser(event);
  if (!user) return bad('no autenticado', 401);

  const route = event.routeKey;
  try {
    const access = await resolveUserAccess(user);
    switch (route) {
      case 'GET /me':
        return ok({ access });
      case 'GET /conversations': {
        if (!can(access, ANA_PERMISSIONS.CHATS_VIEW)) return bad('sin permiso', 403);
        const target = await resolveViewTarget(access, event.queryStringParameters?.operatorId);
        if (!target) return bad('sin permiso', 403);
        return await listConversations(target, event.queryStringParameters ?? {});
      }
      case 'GET /conversations/{chatId}/messages': {
        if (!can(access, ANA_PERMISSIONS.CHATS_VIEW)) return bad('sin permiso', 403);
        const target = await resolveViewTarget(access, event.queryStringParameters?.operatorId);
        if (!target) return bad('sin permiso', 403);
        return await listMessages(target, event.pathParameters?.chatId, event.queryStringParameters ?? {});
      }
      case 'PUT /messages':
        return await putMessage(user, JSON.parse(event.body ?? '{}'));
      case 'PUT /conversations/meta':
        return await putConversationMeta(user, JSON.parse(event.body ?? '{}'));
      case 'POST /conversations/{chatId}/read':
        // Siempre la partición propia (se ignora ?operatorId=).
        return await markRead(user, event.pathParameters?.chatId);
      case 'POST /uploads/presign':
        // Hard check (no depende del flag de enforcement): subir CSV es solo
        // para líderes/admin o roles con el grant explícito — nunca agentes.
        if (
          !access.isAdmin &&
          !access.isLeader &&
          !access.permissions.includes(ANA_PERMISSIONS.CONTACTS_UPLOAD)
        )
          return bad('sin permiso', 403);
        return await presignCsv(access, JSON.parse(event.body ?? '{}'));
      case 'POST /uploads/delete':
        return await deleteCsv(user, JSON.parse(event.body ?? '{}'));
      case 'GET /uploads/history':
        return await uploadsHistory(access, event.queryStringParameters ?? {});
      case 'GET /admin/roles':
        if (!access.isAdmin) return bad('sin permiso', 403);
        return ok({ roles: await listAllRoles() });
      case 'GET /admin/role-permissions/{roleId}':
        if (!access.isAdmin) return bad('sin permiso', 403);
        return await getRolePerms(event.pathParameters?.roleId);
      case 'PUT /admin/role-permissions/{roleId}':
        // Hard check: el sink de admin no depende del flag de enforcement.
        if (!access.isAdmin) return bad('sin permiso', 403);
        return await setRolePerms(event.pathParameters?.roleId, JSON.parse(event.body ?? '{}'));
      case 'POST /media/presign':
        // key con scope al propio username → basta estar autenticado.
        return await presignMedia(user, JSON.parse(event.body ?? '{}'));
      case 'GET /media/url':
        if (!can(access, ANA_PERMISSIONS.CHATS_VIEW)) return bad('sin permiso', 403);
        return await presignMediaGet(access, event.queryStringParameters?.key);
      // --- Sesión de WhatsApp respaldada en S3 (RemoteAuth) ---
      case 'POST /wa-session/presign':
        return await presignWaSession(user, JSON.parse(event.body ?? '{}'));
      case 'GET /wa-session/exists':
        return await waSessionExists(user);
      case 'POST /wa-session/delete':
        return await deleteWaSession(user);
      default:
        return bad(`ruta no manejada: ${route}`, 404);
    }
  } catch (e) {
    // No filtrar el detalle interno al cliente.
    console.error('[api] error', route, e);
    return bad('error interno', 500);
  }
};

/**
 * GET /uploads/history?campaign=<c>[&srcKey=<k>] — historial de cargas CSV
 * (add-contact-upload-console D7). Chequeo fail-closed, independiente de
 * PERMISSIONS_ENFORCED: admin cualquier campaña; CONTACTS_UPLOAD solo propias o `*`.
 */
async function uploadsHistory(
  access: UserAccess,
  q: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  const campaign = (q.campaign ?? '').trim();
  if (!campaign) return bad('falta campaign');
  const own = access.campaigns.map((c) => c.trim().toLowerCase());
  const allowed =
    access.isAdmin ||
    (access.permissions.includes(ANA_PERMISSIONS.CONTACTS_UPLOAD) &&
      (own.includes('*') || own.includes(campaign.toLowerCase())));
  if (!allowed) return bad('sin permiso', 403);
  const srcKey = q.srcKey?.trim() || undefined;
  return ok({ campaign, items: await listUploads(campaign, { srcKey }) });
}

// Conversaciones/mensajes (resumen, paginación, leída): ver lib/conversations.ts.

// Key de la sesión WhatsApp del operador (un zip por usuario). El scope por
// username del JWT aísla: un agente solo lee/escribe SU sesión.
const waSessionKey = (user: string) =>
  `wa-sessions/${user.replace(/[^\w.\-]/g, '_')}/session.zip`;

/** Presigned PUT/GET para el zip de sesión de WhatsApp (RemoteAuth). */
async function presignWaSession(
  user: string,
  payload: { op?: 'put' | 'get' },
): Promise<APIGatewayProxyResultV2> {
  const key = waSessionKey(user);
  const op = payload.op === 'put' ? 'put' : 'get';
  const cmd =
    op === 'put'
      ? new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, ContentType: 'application/zip' })
      : new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key });
  const url = await getSignedUrl(s3, cmd, { expiresIn: 300 });
  return ok({ url, key });
}

/** ¿Existe el zip de sesión del operador? (HeadObject). */
async function waSessionExists(user: string): Promise<APIGatewayProxyResultV2> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: waSessionKey(user) }));
    return ok({ exists: true });
  } catch {
    return ok({ exists: false });
  }
}

/** Borra el zip de sesión (logout / sesión muerta). */
async function deleteWaSession(user: string): Promise<APIGatewayProxyResultV2> {
  await s3
    .send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: waSessionKey(user) }))
    .catch(() => {});
  return ok({ deleted: true });
}

async function presignCsv(
  access: import('../lib/access').UserAccess,
  payload: {
    filename?: string;
    template?: string;
    countryCode?: string;
    phoneColumn?: string;
    campaignId?: string;
    campaign?: string;
    distribute?: boolean;
    // Reparto explícito por pesos {operatorId: peso}. Requiere distribute.
    assignments?: Record<string, number>;
  },
): Promise<APIGatewayProxyResultV2> {
  const user = access.username;
  const safeUser = user.replace(/[^\w.\-]/g, '_');
  const filename = (payload.filename ?? 'upload.csv').replace(/[^\w.\-]/g, '_');
  if (filename === '.' || filename === '..') return bad('filename inválido');

  // Repartir entre agentes solo si el usuario tiene el permiso de distribución.
  const distribute = !!payload.distribute && can(access, ANA_PERMISSIONS.CONTACTS_DISTRIBUTE);
  if (payload.distribute && !distribute) return bad('sin permiso para repartir', 403);

  // Campaña: siempre requerida (se usa para el registro CRM, no solo reparto).
  const campaign = payload.campaign ?? access.campaigns[0] ?? '';
  if (!campaign) return bad('falta campaign');
  // Debe ser propia (o admin/global).
  if (
    !access.isAdmin &&
    !access.campaigns.includes('*') &&
    !access.campaigns.includes(campaign)
  ) {
    return bad('campaña no permitida', 403);
  }
  // Y debe EXISTIR en la DB de campañas (typos no generan jobs huérfanos).
  if (!(await campaignExists(campaign))) {
    return bad(`la campaña "${campaign}" no existe`, 400);
  }

  // Reparto explícito por pesos: solo con permiso de distribución y pesos sanos.
  let assignments = '';
  if (payload.assignments && Object.keys(payload.assignments).length > 0) {
    if (!distribute) return bad('assignments requiere distribute', 403);
    const clean: Record<string, number> = {};
    for (const [op, w] of Object.entries(payload.assignments)) {
      const n = Math.floor(Number(w));
      if (op && Number.isFinite(n) && n > 0) clean[op] = n;
    }
    if (Object.keys(clean).length === 0) return bad('assignments sin pesos válidos');
    // Con AGENT_ROSTER_FILTER: solo destinatarios habilitados (400) y lista sana (503).
    const check = await checkAssignmentsEnabled(campaign, Object.keys(clean));
    if (!check.ok) return bad(check.error, check.status);
    assignments = JSON.stringify(clean);
    // Metadata S3 cabe en ~2KB total: acotar el tamaño del reparto.
    if (assignments.length > 1500) return bad('assignments demasiado grande');
  }

  // Config fijada server-side en metadata firmada → el cliente no la altera.
  const key = `csv-uploads/${safeUser}/${Date.now()}_${filename}`;
  const metadata: Record<string, string> = {
    operatorid: user,
    template: payload.template ?? '{mensaje}',
    countrycode: payload.countryCode ?? '52',
    phonecolumn: payload.phoneColumn ?? 'telefono',
    campaignid: payload.campaignId ?? key,
    distribute: distribute ? '1' : '0',
    campaign,
    ...(assignments ? { assignments } : {}),
  };

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: CSV_BUCKET,
      Key: key,
      ContentType: 'text/csv',
      Metadata: metadata,
    }),
    { expiresIn: 300 },
  );
  // Preview del reparto: a quién irían los jobs (misma fuente que csvTrigger),
  // para que la UI lo muestre ANTES de subir el archivo.
  const eligibleAgents =
    distribute && !assignments ? await getDistributableAgents(campaign) : undefined;
  return ok({ url, key, maxBytes: MAX_CSV_BYTES, metadata, eligibleAgents });
}

async function setRolePerms(
  roleId: string | undefined,
  payload: { permissions?: string[]; roleName?: string },
): Promise<APIGatewayProxyResultV2> {
  if (!roleId) return bad('falta roleId');
  // Acepta grants (`perm`) y denies (`-perm`) de permisos del catálogo.
  const permissions = sanitizeRolePermissions(payload.permissions ?? []);
  await setRolePermissions(roleId, permissions, payload.roleName);
  await invalidateByRole(roleId); // usuarios con ese rol re-resuelven acceso
  return ok({ roleId, permissions });
}

/** Borra un CSV de uploads. Solo el dueño (key bajo csv-uploads/<user>/). */
async function deleteCsv(
  user: string,
  payload: { key?: string },
): Promise<APIGatewayProxyResultV2> {
  const key = payload.key ?? '';
  const safeUser = user.replace(/[^\w.\-]/g, '_');
  if (!key.startsWith(`csv-uploads/${safeUser}/`)) return bad('key no permitida', 403);
  await s3.send(new DeleteObjectCommand({ Bucket: CSV_BUCKET, Key: key }));
  return ok({ deleted: key });
}

async function getRolePerms(roleId: string | undefined): Promise<APIGatewayProxyResultV2> {
  if (!roleId) return bad('falta roleId');
  return ok({ roleId, permissions: await getRolePermissions(roleId) });
}

// Content-types permitidos para backup de media (no eco del valor del cliente).
const ALLOWED_MEDIA_PREFIXES = ['image/', 'audio/', 'video/'];
const ALLOWED_MEDIA_EXACT = new Set(['application/pdf', 'application/octet-stream']);

function safeContentType(mimetype?: string): string {
  const m = (mimetype ?? '').split(';')[0].trim().toLowerCase();
  if (ALLOWED_MEDIA_EXACT.has(m)) return m;
  if (ALLOWED_MEDIA_PREFIXES.some((p) => m.startsWith(p))) return m;
  return 'application/octet-stream'; // desconocido → genérico, no se confía
}

/** Presign PUT para subir media entrante. key = media/<op>/<nonce>_<archivo>. */
async function presignMedia(
  user: string,
  payload: { filename?: string; mimetype?: string },
): Promise<APIGatewayProxyResultV2> {
  const safeUser = user.replace(/[^\w.\-]/g, '_');
  const filename = (payload.filename ?? 'media.bin').replace(/[^\w.\-]/g, '_');
  if (filename === '.' || filename === '..') return bad('filename inválido');
  // nonce server-side → evita que un cliente sobrescriba media existente.
  const key = `media/${safeUser}/${Date.now()}_${filename}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: key,
      ContentType: safeContentType(payload.mimetype),
    }),
    { expiresIn: 300 },
  );
  return ok({ url, key });
}

/**
 * Presign GET para VER media de una conversación. Autoriza igual que la vista
 * de conversaciones: la key empieza con `media/<dueño>/` y el solicitante debe
 * poder ver a ese operador (self / admin / líder de su campaña).
 */
async function presignMediaGet(
  access: UserAccess,
  key?: string,
): Promise<APIGatewayProxyResultV2> {
  if (!key || !key.startsWith('media/')) return bad('key inválida');
  const owner = key.split('/')[1]; // media/<owner>/...
  const target = await resolveViewTarget(access, owner);
  if (!target) return bad('sin permiso', 403);
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }),
    { expiresIn: 300 },
  );
  return ok({ url });
}
