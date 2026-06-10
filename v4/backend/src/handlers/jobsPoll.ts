// File: GET /jobs/poll  → entrega hasta MAX_BATCH jobs del PROPIO operador y los
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, type SendJob } from '../lib/jobs';
import { ok, bad, claimUser } from '../lib/http';

/**
 * GET /jobs/poll  → TODOS los jobs del PROPIO operador (pendientes + historial).
 *                   El desktop separa pendientes (por enviar) de procesados
 *                   (sent/no_whatsapp/error). El historial vive hasta el TTL (7d).
 * POST /jobs/ack  → marca jobs como procesados (NO los borra): body
 *                   { acks: [{ jobId, status }] } con status sent|no_whatsapp|error.
 *                   (Compat: { ids: [...] } los marca como 'sent'.)
 *
 * Aislamiento: la PK es operatorId = claim del JWT.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const user = claimUser(event);
  if (!user) return bad('no autenticado', 401);

  try {
    if (event.routeKey === 'GET /jobs/poll') return await poll(user);
    if (event.routeKey === 'POST /jobs/ack')
      return await ack(user, JSON.parse(event.body ?? '{}'));
    return bad(`ruta no manejada: ${event.routeKey}`, 404);
  } catch (e) {
    console.error('[jobsPoll] error', event.routeKey, e);
    return bad('error interno', 500);
  }
};

async function poll(user: string): Promise<APIGatewayProxyResultV2> {
  // Todos los pendientes del operador (paginado). El orden no importa: el
  // agente agrupa por archivo (srcKey) y procesa uno a la vez.
  const jobs: SendJob[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: JOBS_TABLE,
        KeyConditionExpression: 'operatorId = :u',
        ExpressionAttributeValues: { ':u': user },
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) jobs.push(item as SendJob);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey && jobs.length < 2000);

  return ok({ jobs: jobs.map((job) => ({ id: job.jobId, job })) });
}

type AckStatus = 'sent' | 'no_whatsapp' | 'error';
const VALID: AckStatus[] = ['sent', 'no_whatsapp', 'error'];

async function ack(
  user: string,
  payload: { acks?: { jobId: string; status?: AckStatus }[]; ids?: string[] },
): Promise<APIGatewayProxyResultV2> {
  // Normaliza ambos formatos: {acks:[{jobId,status}]} o {ids:[...]} (→ sent).
  const acks =
    payload.acks ?? (payload.ids ?? []).map((jobId) => ({ jobId, status: 'sent' as AckStatus }));
  const now = Date.now();

  await Promise.all(
    acks.map(({ jobId, status }) => {
      const s: AckStatus = status && VALID.includes(status) ? status : 'sent';
      return ddb
        .send(
          new UpdateCommand({
            TableName: JOBS_TABLE,
            Key: { operatorId: user, jobId },
            UpdateExpression: 'SET #s = :s, sentAt = :t REMOVE leaseUntil',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':s': s, ':t': now },
            ConditionExpression: 'attribute_exists(jobId)', // no recrear borrados
          }),
        )
        .catch((e) => {
          if (e?.name !== 'ConditionalCheckFailedException') throw e;
        });
    }),
  );
  return ok({ acked: acks.length });
}
