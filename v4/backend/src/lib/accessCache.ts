// File: Escribe el acceso resuelto. `resolveStartedAt` = instante en que arrancó la
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';
import type { UserAccess } from './access';

// Caché de acceso en 2 capas (guía §6):
//  L1: memoria del contenedor, TTL corto (fast path entre requests calientes).
//  L2: DynamoDB compartida, para que todos los contenedores reúsen una sola
//      llamada a la API externa de Roles.
const CACHE_TABLE = process.env.ACCESS_CACHE_TABLE!;
const L1_TTL_MS = 15 * 1000;
const L2_TTL_S = 15 * 60;
// Un tombstone bloquea escrituras tardías el tiempo suficiente para cubrir el
// peor caso de latencia de resolveUserAccess (lectura de roles + permisos).
const TOMBSTONE_S = 60;

interface CacheItem {
  username: string;
  access?: UserAccess; // ausente en un tombstone
  roleIds?: string[];
  tombstoneAt?: number; // epoch ms de la última invalidación
  ttl: number; // epoch s
}

export async function getCached(username: string): Promise<UserAccess | null> {
  const now = Date.now();
  const hit = l1.get(username);
  if (hit && hit.exp > now) return hit.access;

  const res = await ddb.send(new GetCommand({ TableName: CACHE_TABLE, Key: { username } }));
  const item = res.Item as CacheItem | undefined;
  // Un tombstone (sin `access`) cuenta como miss pero sigue en la tabla para
  // bloquear a un escritor stale (ver putCached).
  if (item?.access && item.ttl * 1000 > now) {
    l1.set(username, { access: item.access, exp: now + L1_TTL_MS });
    return item.access;
  }
  return null;
}

/**
 * Escribe el acceso resuelto. `resolveStartedAt` = instante en que arrancó la
 * resolución; si hubo una invalidación DESPUÉS de ese instante, no sobrescribe
 * (evita resurrección de datos viejos por carrera).
 */
export async function putCached(access: UserAccess, resolveStartedAt: number): Promise<void> {
  const now = Date.now();
  l1.set(access.username, { access, exp: now + L1_TTL_MS });
  try {
    await ddb.send(
      new PutCommand({
        TableName: CACHE_TABLE,
        Item: {
          username: access.username,
          access,
          roleIds: access.roleIds,
          ttl: Math.floor(now / 1000) + L2_TTL_S,
        },
        // Solo escribe si no hay un tombstone más nuevo que el inicio de la
        // resolución (o no hay tombstone). Si una invalidación corrió mientras
        // resolvíamos, su tombstoneAt > resolveStartedAt → no sobrescribimos.
        ConditionExpression: 'attribute_not_exists(tombstoneAt) OR tombstoneAt < :start',
        ExpressionAttributeValues: { ':start': resolveStartedAt },
      }),
    );
  } catch (e: any) {
    if (e?.name !== 'ConditionalCheckFailedException') throw e; // invalidado en vuelo
  }
}

/**
 * Invalida el acceso cacheado de todos los usuarios con ese rol (guía §6).
 * Pagina el Scan (un solo Scan corta en 1 MB → revocación incompleta).
 * Deja un tombstone por usuario (no un simple delete) para bloquear escritores
 * stale en vuelo durante TOMBSTONE_S.
 */
export async function invalidateByRole(roleId: string): Promise<void> {
  l1.clear();
  const now = Date.now();
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: CACHE_TABLE,
        FilterExpression: 'contains(roleIds, :r)',
        ExpressionAttributeValues: { ':r': roleId },
        ProjectionExpression: 'username',
        ExclusiveStartKey,
      }),
    );
    await Promise.all(
      (res.Items ?? []).map((i) =>
        ddb.send(
          new PutCommand({
            TableName: CACHE_TABLE,
            Item: {
              username: i.username,
              tombstoneAt: now,
              ttl: Math.floor(now / 1000) + TOMBSTONE_S,
            },
          }),
        ),
      ),
    );
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

const l1 = new Map<string, { access: UserAccess; exp: number }>();
