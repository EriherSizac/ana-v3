// File: api
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ddb,
  CONVERSATIONS_TABLE,
  MESSAGES_TABLE,
  messageSk,
  convKey,
} from '../lib/dynamo';
import { s3, CSV_BUCKET, MEDIA_BUCKET } from '../lib/s3';
import { ok, created, bad, claimUser } from '../lib/http';
import { resolveUserAccess, can, type UserAccess } from '../lib/access';
import { ANA_PERMISSIONS } from '../lib/permissions';
import { setRolePermissions, getRolePermissions } from '../lib/rolePerms';
import { invalidateByRole } from '../lib/accessCache';
import { isAgentInCampaigns } from '../lib/agents';
import { getEligibleAgents } from '../lib/dashboard';
import { listAllRoles } from '../lib/roles';

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
  if (access.isAdmin) return target;
  if (
    can(access, ANA_PERMISSIONS.CHATS_TEAM_VIEW) &&
    (await isAgentInCampaigns(target, access.campaigns))
  ) {
    return target;
  }
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
        return await listConversations(target);
      }
      case 'GET /conversations/{chatId}/messages': {
        if (!can(access, ANA_PERMISSIONS.CHATS_VIEW)) return bad('sin permiso', 403);
        const target = await resolveViewTarget(access, event.queryStringParameters?.operatorId);
        if (!target) return bad('sin permiso', 403);
        return await listMessages(target, event.pathParameters?.chatId);
      }
      case 'PUT /messages':
        return await putMessage(user, JSON.parse(event.body ?? '{}'));
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
      default:
        return bad(`ruta no manejada: ${route}`, 404);
    }
  } catch (e) {
    // No filtrar el detalle interno al cliente.
    console.error('[api] error', route, e);
    return bad('error interno', 500);
  }
};

async function listConversations(user: string): Promise<APIGatewayProxyResultV2> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: CONVERSATIONS_TABLE,
      KeyConditionExpression: 'operatorId = :u',
      ExpressionAttributeValues: { ':u': user },
    }),
  );
  const items = (res.Items ?? []).sort(
    (a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0),
  );
  return ok({ conversations: items });
}

async function listMessages(
  user: string,
  chatId?: string,
): Promise<APIGatewayProxyResultV2> {
  if (!chatId) return bad('falta chatId');
  // convKey incluye operatorId → solo lee la partición del propio operador.
  const res = await ddb.send(
    new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: 'convKey = :k',
      ExpressionAttributeValues: { ':k': convKey(user, chatId) },
      ScanIndexForward: true,
    }),
  );
  return ok({ chatId, messages: res.Items ?? [] });
}

async function putMessage(user: string, msg: any): Promise<APIGatewayProxyResultV2> {
  const { chatId, id, timestamp } = msg;
  if (!chatId || !id || !timestamp) return bad('faltan chatId/id/timestamp');

  // Whitelist: nunca confiar en el body completo (evita mass-assignment).
  const item = {
    convKey: convKey(user, chatId),
    sk: messageSk(Number(timestamp), String(id)),
    operatorId: user,
    chatId: String(chatId),
    id: String(id),
    timestamp: Number(timestamp),
    body: typeof msg.body === 'string' ? msg.body : '',
    fromMe: !!msg.fromMe,
    from: String(msg.from ?? ''),
    to: String(msg.to ?? ''),
    type: String(msg.type ?? 'chat'),
    // Punteros de media en S3 (los bytes viven en MediaBucket, no en Dynamo).
    ...(msg.mediaKey ? { mediaKey: String(msg.mediaKey) } : {}),
    ...(msg.mimetype ? { mimetype: String(msg.mimetype) } : {}),
    ...(msg.filename ? { filename: String(msg.filename) } : {}),
  };

  await ddb.send(
    new PutCommand({
      TableName: MESSAGES_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(sk)', // no sobre-escribir
    }),
  ).catch((e) => {
    if (e?.name !== 'ConditionalCheckFailedException') throw e; // idempotente
  });

  await ddb.send(
    new UpdateCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { operatorId: user, chatId: String(chatId) },
      UpdateExpression:
        'SET lastMessage = :b, lastMessageTime = :t ADD unreadCount :u',
      ExpressionAttributeValues: {
        ':b': item.body,
        ':t': item.timestamp,
        ':u': item.fromMe ? 0 : 1,
      },
    }),
  );

  return created({ ok: true });
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

  // Campaña destino del reparto: debe ser propia (o admin/global).
  const campaign = payload.campaign ?? access.campaigns[0] ?? '';
  if (
    distribute &&
    !access.isAdmin &&
    !access.campaigns.includes('*') &&
    !access.campaigns.includes(campaign)
  ) {
    return bad('campaña no permitida', 403);
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
    distribute && !assignments ? await getEligibleAgents(campaign) : undefined;
  return ok({ url, key, maxBytes: MAX_CSV_BYTES, metadata, eligibleAgents });
}

async function setRolePerms(
  roleId: string | undefined,
  payload: { permissions?: string[]; roleName?: string },
): Promise<APIGatewayProxyResultV2> {
  if (!roleId) return bad('falta roleId');
  const valid = new Set<string>(Object.values(ANA_PERMISSIONS));
  // Acepta grants (`perm`) y denies (`-perm`) de permisos válidos.
  const permissions = (payload.permissions ?? []).filter((p) => {
    const bare = p.startsWith('-') ? p.slice(1) : p;
    return valid.has(bare);
  });
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
