// File: Registro de conexiones realtime en DynamoDB (add-realtime-gateway D4).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { BatchWriteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';
import type { ClientType } from './realtime';

/**
 * Tabla `ana-backend-realtime-<stage>`:
 *  - `PK=<tema>, SK=<connectionId>` por suscripción (con `tokenExp` para el reparto).
 *  - `PK=conn#<id>, SK=meta` con usuario, tipo, versión, hora y temas.
 * TTL `ttl` = conexión + 3 h por si `$disconnect` nunca llega.
 */
export const REALTIME_TTL_S = 3 * 3600;
const table = () => process.env.REALTIME_TABLE ?? '';
const metaKey = (id: string) => ({ PK: `conn#${id}`, SK: 'meta' });

export interface ConnectionMeta {
  connectionId: string;
  username: string;
  client: ClientType;
  version: string;
  connectedAt: number;
  /** ms epoch del `exp` del ID token. */
  tokenExp: number;
  topics: string[];
}

export interface TopicMember {
  connectionId: string;
  tokenExp?: number;
  username?: string;
  client?: string;
}

async function batchWrite(requests: Record<string, any>[]): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    let pending = requests.slice(i, i + 25);
    for (let attempt = 0; pending.length > 0 && attempt < 5; attempt++) {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [table()]: pending } }));
      pending = (res.UnprocessedItems?.[table()] ?? []) as Record<string, any>[];
    }
  }
}

/** Registra la conexión y sus suscripciones. */
export async function putConnection(meta: ConnectionMeta, now = Date.now()): Promise<void> {
  const ttl = Math.floor(now / 1000) + REALTIME_TTL_S;
  const items = [
    { ...metaKey(meta.connectionId), ...meta, ttl },
    ...meta.topics.map((t) => ({
      PK: t,
      SK: meta.connectionId,
      tokenExp: meta.tokenExp,
      username: meta.username,
      client: meta.client,
      ttl,
    })),
  ];
  await batchWrite(items.map((Item) => ({ PutRequest: { Item } })));
}

export async function getConnection(connectionId: string): Promise<ConnectionMeta | null> {
  const { Item } = await ddb.send(new GetCommand({ TableName: table(), Key: metaKey(connectionId) }));
  return (Item as ConnectionMeta | undefined) ?? null;
}

/** Borra la conexión y todas sus suscripciones (idempotente). */
export async function removeConnection(connectionId: string, known?: ConnectionMeta | null): Promise<void> {
  const meta = known ?? (await getConnection(connectionId));
  const keys = [metaKey(connectionId), ...(meta?.topics ?? []).map((t) => ({ PK: t, SK: connectionId }))];
  await batchWrite(keys.map((Key) => ({ DeleteRequest: { Key } })));
}

/** Conexiones suscritas a un tema (paginado, sin Scan). */
export async function queryTopic(topic: string): Promise<TopicMember[]> {
  const out: TopicMember[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: table(),
        KeyConditionExpression: 'PK = :t',
        ExpressionAttributeValues: { ':t': topic },
        ProjectionExpression: 'SK, tokenExp, username, #c',
        ExpressionAttributeNames: { '#c': 'client' },
        ExclusiveStartKey,
      }),
    );
    for (const i of res.Items ?? []) out.push({ connectionId: String(i.SK), tokenExp: i.tokenExp, username: i.username, client: i.client });
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/** Conexiones únicas de varios temas. */
export async function queryTopics(topics: string[]): Promise<TopicMember[]> {
  const byId = new Map<string, TopicMember>();
  for (const t of [...new Set(topics)]) for (const m of await queryTopic(t)) if (!byId.has(m.connectionId)) byId.set(m.connectionId, m);
  return [...byId.values()];
}

/** Número de conexiones de un tema (`Select: COUNT`, paginado). */
export async function countTopic(topic: string): Promise<number> {
  let n = 0;
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: table(),
        KeyConditionExpression: 'PK = :t',
        ExpressionAttributeValues: { ':t': topic },
        Select: 'COUNT',
        ExclusiveStartKey,
      }),
    );
    n += res.Count ?? 0;
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return n;
}
