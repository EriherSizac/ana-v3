// File: Conversaciones y mensajes respaldados: resumen, paginación y leída.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CONVERSATIONS_TABLE, MESSAGES_TABLE, messageSk, convKey } from './dynamo';
import { ok, created, bad } from './http';

/** GSI de la tabla de conversaciones ordenado por lastMessageTime (serverless.yml). */
export const RECENT_INDEX = 'operator-recent-index';
export const CONV_LIMIT = { def: 100, max: 200 };
export const MSG_LIMIT = { def: 200, max: 500 };

const isConditionFailed = (e: unknown) =>
  (e as { name?: string })?.name === 'ConditionalCheckFailedException';

/** `limit` del query string: entero en [1, max]; ausente/ inválido → default. */
export function parseLimit(raw: string | undefined, l: { def: number; max: number }): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) return l.def;
  return Math.min(n, l.max);
}

export const encodeToken = (key: Record<string, unknown> | undefined): string | undefined =>
  key ? Buffer.from(JSON.stringify(key), 'utf8').toString('base64url') : undefined;

/**
 * nextToken → ExclusiveStartKey. undefined si no viene; null si es inválido o
 * apunta a otra partición (`expect` = atributos que deben coincidir).
 */
export function decodeToken(
  raw: string | undefined,
  expect: Record<string, string>,
): Record<string, unknown> | undefined | null {
  if (!raw) return undefined;
  try {
    if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    const key = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!key || typeof key !== 'object' || Array.isArray(key)) return null;
    for (const [k, v] of Object.entries(expect)) if (key[k] !== v) return null;
    for (const v of Object.values(key)) if (typeof v !== 'string' && typeof v !== 'number') return null;
    return key;
  } catch {
    return null;
  }
}

/** Página de conversaciones del operador, la más reciente primero (GSI). */
export async function listConversations(
  user: string,
  q: { limit?: string; nextToken?: string } = {},
): Promise<APIGatewayProxyResultV2> {
  const start = decodeToken(q.nextToken, { operatorId: user });
  if (start === null) return bad('nextToken inválido');
  const res = await ddb.send(
    new QueryCommand({
      TableName: CONVERSATIONS_TABLE,
      IndexName: RECENT_INDEX,
      KeyConditionExpression: 'operatorId = :u',
      ExpressionAttributeValues: { ':u': user },
      ScanIndexForward: false,
      Limit: parseLimit(q.limit, CONV_LIMIT),
      ...(start ? { ExclusiveStartKey: start } : {}),
    }),
  );
  const nextToken = encodeToken(res.LastEvaluatedKey);
  return ok({ conversations: res.Items ?? [], ...(nextToken ? { nextToken } : {}) });
}

/** Página de mensajes: los `limit` más recientes, en orden ascendente; nextToken = anteriores. */
export async function listMessages(
  user: string,
  chatId: string | undefined,
  q: { limit?: string; nextToken?: string } = {},
): Promise<APIGatewayProxyResultV2> {
  if (!chatId) return bad('falta chatId');
  const k = convKey(user, chatId);
  const start = decodeToken(q.nextToken, { convKey: k });
  if (start === null) return bad('nextToken inválido');
  // convKey incluye operatorId → solo lee la partición del propio operador.
  const res = await ddb.send(
    new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: 'convKey = :k',
      ExpressionAttributeValues: { ':k': k },
      ScanIndexForward: false,
      Limit: parseLimit(q.limit, MSG_LIMIT),
      ...(start ? { ExclusiveStartKey: start } : {}),
    }),
  );
  const messages = [...(res.Items ?? [])].reverse();
  const nextToken = encodeToken(res.LastEvaluatedKey);
  return ok({ chatId, messages, ...(nextToken ? { nextToken } : {}) });
}

/**
 * Respalda un mensaje. Solo si es NUEVO actualiza el resumen: lastMessage /
 * lastMessageTime si es igual o más reciente que el guardado, y +1 no leído
 * para entrantes (aunque lleguen tarde). Un reintento no cambia nada.
 */
export async function putMessage(user: string, msg: any): Promise<APIGatewayProxyResultV2> {
  const { chatId, id, timestamp } = msg ?? {};
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

  try {
    await ddb.send(
      new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: item,
        ConditionExpression: 'attribute_not_exists(sk)', // no sobre-escribir
      }),
    );
  } catch (e) {
    if (isConditionFailed(e)) return created({ ok: true, duplicate: true }); // ya existía
    throw e;
  }

  const key = { operatorId: user, chatId: item.chatId };
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: key,
        UpdateExpression: 'SET lastMessage = :b, lastMessageTime = :t',
        ConditionExpression: 'attribute_not_exists(lastMessageTime) OR lastMessageTime <= :t',
        ExpressionAttributeValues: { ':b': item.body, ':t': item.timestamp },
      }),
    );
  } catch (e) {
    if (!isConditionFailed(e)) throw e; // mensaje viejo: conserva el más reciente
  }
  if (!item.fromMe) {
    await ddb.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: key,
        UpdateExpression: 'ADD unreadCount :one',
        ExpressionAttributeValues: { ':one': 1 },
      }),
    );
  }
  return created({ ok: true });
}

/** Pone unreadCount en 0 en la conversación PROPIA; no la crea si no existe. */
export async function markRead(user: string, chatId: string | undefined): Promise<APIGatewayProxyResultV2> {
  if (!chatId) return bad('falta chatId');
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { operatorId: user, chatId: String(chatId) },
        UpdateExpression: 'SET unreadCount = :zero',
        ConditionExpression: 'attribute_exists(chatId)',
        ExpressionAttributeValues: { ':zero': 0 },
      }),
    );
  } catch (e) {
    if (!isConditionFailed(e)) throw e;
  }
  return ok({ ok: true });
}

/**
 * Guarda los datos del contacto en la conversación (PK=operatorId, SK=chatId):
 * campaña + fila completa del CSV. Merge (no pisa lastMessage); fija
 * lastMessageTime = 0 si no existe para que aparezca en el índice por recientes.
 */
export async function putConversationMeta(
  user: string,
  payload: { chatId?: string; campaign?: string; contact?: Record<string, string> },
): Promise<APIGatewayProxyResultV2> {
  const chatId = payload?.chatId;
  if (!chatId) return bad('falta chatId');
  const contact = payload.contact ?? {};
  const name =
    contact.name || contact.nombre ||
    `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim();

  await ddb.send(
    new UpdateCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { operatorId: user, chatId: String(chatId) },
      UpdateExpression:
        'SET campaign = :c, contact = :ct, lastMessageTime = if_not_exists(lastMessageTime, :zero)' +
        (name ? ', contactName = :n' : ''),
      ExpressionAttributeValues: {
        ':c': String(payload.campaign ?? ''),
        ':ct': contact,
        ':zero': 0,
        ...(name ? { ':n': name } : {}),
      },
    }),
  );
  return ok({ ok: true });
}
