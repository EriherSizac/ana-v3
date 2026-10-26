// File: GET /jobs/poll y POST /jobs/ack — cola de send-jobs del propio operador.
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, isFinalStatus, type FinalStatus, type SendJob } from '../lib/jobs';
import { ok, bad, claimUser } from '../lib/http';

/**
 * GET /jobs/poll  → jobs del PROPIO operador, sin lease (v4-harden-send-job-queue D3):
 *                   primero los no finales (pending, sin estado o `leased`
 *                   heredado) hasta POLL_MAX_PENDING en orden de jobId, luego
 *                   los POLL_MAX_HISTORY finales más recientes por sentAt.
 *                   `truncated` avisa que quedaron pendientes fuera.
 * POST /jobs/ack  → marca jobs como procesados (NO los borra): body
 *                   { acks: [{ jobId, status }] } con status sent|no_whatsapp|error.
 *                   (Compat: { ids: [...] } los marca como 'sent'.)
 *
 * Aislamiento: la PK es operatorId = claim del JWT.
 */
export const POLL_MAX_ITEMS = 10_000;
export const POLL_MAX_PENDING = 2000;
export const POLL_MAX_HISTORY = 300;

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
  const items: SendJob[] = [];
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
    for (const item of res.Items ?? []) items.push(item as SendJob);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey && items.length < POLL_MAX_ITEMS);
  const overflow = !!ExclusiveStartKey || items.length > POLL_MAX_ITEMS;
  const read = items.slice(0, POLL_MAX_ITEMS);

  // DynamoDB devuelve la partición en orden de jobId (agrupa por carga).
  const pending = read.filter((j) => !isFinalStatus(j.status));
  const history = read
    .filter((j) => isFinalStatus(j.status))
    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));

  const jobs = [...pending.slice(0, POLL_MAX_PENDING), ...history.slice(0, POLL_MAX_HISTORY)];
  return ok({
    jobs: jobs.map((job) => ({ id: job.jobId, job })),
    truncated: pending.length > POLL_MAX_PENDING || overflow,
    pendingTotal: pending.length,
    historyTotal: history.length,
  });
}

async function ack(
  user: string,
  payload: { acks?: { jobId?: unknown; status?: unknown }[]; ids?: unknown[] },
): Promise<APIGatewayProxyResultV2> {
  // Normaliza ambos formatos: {acks:[{jobId,status}]} o {ids:[...]} (→ sent).
  const raw = Array.isArray(payload.acks)
    ? payload.acks
    : (Array.isArray(payload.ids) ? payload.ids : []).map((jobId) => ({ jobId, status: 'sent' }));
  const now = Date.now();
  const notFound: string[] = [];
  const invalid: string[] = [];
  let acked = 0;

  await Promise.all(
    raw.map(async (a) => {
      const jobId = typeof a?.jobId === 'string' ? a.jobId : '';
      // Estado fuera de sent|no_whatsapp|error → se rechaza sin escribir.
      if (!jobId || !isFinalStatus(a?.status)) {
        invalid.push(jobId || String(a?.jobId ?? ''));
        return;
      }
      const status: FinalStatus = a.status;
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: JOBS_TABLE,
            Key: { operatorId: user, jobId },
            UpdateExpression: 'SET #s = :s, sentAt = :t REMOVE leaseUntil',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':s': status, ':t': now },
            ConditionExpression: 'attribute_exists(jobId)', // no recrear borrados
          }),
        );
        acked += 1;
      } catch (e) {
        if ((e as { name?: string })?.name !== 'ConditionalCheckFailedException') throw e;
        notFound.push(jobId);
      }
    }),
  );
  return ok({ acked, notFound, invalid });
}
