// File: Marcadores de idempotencia con estado (pending → done) en la tabla de jobs.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';
import { JOBS_TABLE } from './jobs';

/**
 * Un marcador `{operatorId: pk, jobId: sk}` evita registrar dos veces lo mismo
 * en el CRM sin perderlo si el CRM falla:
 *  - claim: se reserva como `pending` (con `claimedAt`) solo si no existe, si
 *    quedó `pending` abandonado hace más de STALE_MS o si está `failed`.
 *  - confirm: tras insertar con éxito pasa a `done`.
 *  - release: si el CRM falla se borra, solo si sigue siendo la reserva propia.
 * Compatibilidad: un marcador viejo sin `status` cuenta como `done`.
 */
export const STALE_MS = 2 * 60 * 1000; // > timeout de 29 s de la Lambda

export type ClaimResult =
  | { claimed: true; claimedAt: number }
  | { claimed: false; state: 'done' | 'pending' };

const isConditionFailed = (e: unknown) =>
  (e as { name?: string })?.name === 'ConditionalCheckFailedException';

export async function claim(
  pk: string,
  sk: string,
  ttlSec: number,
  now: number = Date.now(),
): Promise<ClaimResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ddb.send(
        new PutCommand({
          TableName: JOBS_TABLE,
          Item: { operatorId: pk, jobId: sk, status: 'pending', claimedAt: now, ttl: ttlSec },
          ConditionExpression:
            'attribute_not_exists(jobId) OR (#s = :pending AND claimedAt < :stale) OR #s = :failed',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':pending': 'pending', ':failed': 'failed', ':stale': now - STALE_MS },
        }),
      );
      return { claimed: true, claimedAt: now };
    } catch (e) {
      if (!isConditionFailed(e)) throw e;
    }
    const { Item } = await ddb.send(
      new GetCommand({ TableName: JOBS_TABLE, Key: { operatorId: pk, jobId: sk } }),
    );
    // Borrado entre el Put y el Get (otra invocación liberó): reintenta una vez.
    if (!Item) continue;
    return { claimed: false, state: Item.status === 'pending' ? 'pending' : 'done' };
  }
  return { claimed: false, state: 'pending' };
}

/** Marca `done` la reserva propia tras una inserción exitosa. */
export async function confirm(pk: string, sk: string, claimedAt: number): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: JOBS_TABLE,
        Key: { operatorId: pk, jobId: sk },
        UpdateExpression: 'SET #s = :done',
        ConditionExpression: 'claimedAt = :mine',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':done': 'done', ':mine': claimedAt },
      }),
    );
  } catch (e) {
    if (!isConditionFailed(e)) throw e;
    console.warn('[idempotency] confirm: la reserva ya no es propia', pk, sk);
  }
}

/** Libera la reserva propia (solo si sigue `pending` con el mismo `claimedAt`). */
export async function release(pk: string, sk: string, claimedAt: number): Promise<void> {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: JOBS_TABLE,
        Key: { operatorId: pk, jobId: sk },
        ConditionExpression: '#s = :pending AND claimedAt = :mine',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':pending': 'pending', ':mine': claimedAt },
      }),
    );
  } catch (e) {
    if (!isConditionFailed(e)) throw e;
  }
}
