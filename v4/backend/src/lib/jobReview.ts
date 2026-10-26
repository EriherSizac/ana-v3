// File: Paso perezoso de envíos interrumpidos a "por revisar" (v4-review-interrupted-sends D2).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';
import { JOBS_TABLE, REVIEW_AFTER_MS, type SendJob } from './jobs';

/**
 * Pasa un job `sending` reservado hace más de 10 min a `review`
 * (`reviewReason: "interrupted"`, `reviewAt`), con escritura condicional.
 * Devuelve el job actualizado o null si la condición no se cumplió (siguió
 * `sending` reciente, llegó el acuse o ya no existe).
 */
export async function promoteToReview(
  operatorId: string,
  jobId: string,
  now: number = Date.now(),
): Promise<SendJob | null> {
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: JOBS_TABLE,
        Key: { operatorId, jobId },
        UpdateExpression: 'SET #s = :review, reviewReason = :why, reviewAt = :now',
        ConditionExpression: '#s = :sending AND claimedAt < :cutoff',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':review': 'review',
          ':why': 'interrupted',
          ':now': now,
          ':sending': 'sending',
          ':cutoff': now - REVIEW_AFTER_MS,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    console.log(JSON.stringify({ evt: 'job_review', operatorId, jobId }));
    return (res.Attributes as SendJob | undefined) ?? null;
  } catch (e) {
    if ((e as { name?: string })?.name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}
