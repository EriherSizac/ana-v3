// File: GET /jobs/poll, POST /jobs/claim y POST /jobs/ack — cola de send-jobs del propio operador.
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, classify, isFinalStatus, isReviewDue, type FinalStatus, type SendJob } from '../lib/jobs';
import { promoteToReview } from '../lib/jobReview';
import { ok, bad, claimUser } from '../lib/http';

/**
 * GET /jobs/poll  → jobs del PROPIO operador, sin lease (v4-harden-send-job-queue D3):
 *                   primero los no finales (pending/sin estado/`leased`, y los
 *                   `sending`/`review` por revisar) hasta POLL_MAX_PENDING en
 *                   orden de jobId, luego los POLL_MAX_HISTORY finales
 *                   (sent/no_whatsapp/error/discarded) más recientes.
 *                   `truncated` avisa que quedaron no finales fuera. Antes de
 *                   responder pasa a `review` los `sending` vencidos (10 min).
 * POST /jobs/claim → reserva un job pendiente (`sending` + claimedAt) justo antes
 *                   de enviarlo; 409 si ya no está disponible.
 * POST /jobs/ack  → marca jobs como procesados (NO los borra): body
 *                   { acks: [{ jobId, status }] } con status sent|no_whatsapp|error.
 *                   (Compat: { ids: [...] } los marca como 'sent'.) Acepta desde
 *                   pending, sending o review; discarded u otro final → invalid.
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
    if (event.routeKey === 'POST /jobs/claim')
      return await claim(user, JSON.parse(event.body ?? '{}'));
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

  // Paso perezoso a review de los envíos interrumpidos (design D2).
  const now = Date.now();
  for (let i = 0; i < read.length; i++) {
    if (!isReviewDue(read[i], now)) continue;
    const updated = await promoteToReview(user, read[i].jobId, now);
    if (updated) read[i] = updated;
  }

  // DynamoDB devuelve la partición en orden de jobId (agrupa por carga).
  const open = read.filter((j) => classify(j, now) !== 'final');
  const history = read
    .filter((j) => classify(j, now) === 'final')
    .sort((a, b) => (b.sentAt ?? b.resolvedAt ?? 0) - (a.sentAt ?? a.resolvedAt ?? 0));

  const jobs = [...open.slice(0, POLL_MAX_PENDING), ...history.slice(0, POLL_MAX_HISTORY)];
  return ok({
    jobs: jobs.map((job) => ({ id: job.jobId, job })),
    truncated: open.length > POLL_MAX_PENDING || overflow,
    pendingTotal: open.length,
    historyTotal: history.length,
  });
}

const isConditionFailed = (e: unknown) =>
  (e as { name?: string })?.name === 'ConditionalCheckFailedException';

/** Estado actual de un job (null si no existe). */
async function currentStatus(user: string, jobId: string): Promise<{ exists: boolean; status: string | null }> {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: JOBS_TABLE, Key: { operatorId: user, jobId }, ProjectionExpression: '#s', ExpressionAttributeNames: { '#s': 'status' } }),
  );
  return { exists: !!Item, status: (Item?.status as string | undefined) ?? null };
}

/** POST /jobs/claim {jobId}: pending → sending (design D1). */
async function claim(user: string, payload: { jobId?: unknown }): Promise<APIGatewayProxyResultV2> {
  const jobId = typeof payload.jobId === 'string' ? payload.jobId : '';
  if (!jobId) return bad('falta jobId');
  const now = Date.now();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: JOBS_TABLE,
        Key: { operatorId: user, jobId },
        UpdateExpression: 'SET #s = :sending, claimedAt = :now ADD attempts :one REMOVE leaseUntil',
        ConditionExpression:
          'attribute_exists(jobId) AND (#s = :pending OR attribute_not_exists(#s) OR #s = :leased)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':sending': 'sending',
          ':now': now,
          ':one': 1,
          ':pending': 'pending',
          ':leased': 'leased',
        },
      }),
    );
    return ok({ claimed: true });
  } catch (e) {
    if (!isConditionFailed(e)) throw e;
    const cur = await currentStatus(user, jobId);
    return {
      statusCode: 409,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'job no disponible', status: cur.exists ? cur.status : null }),
    };
  }
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
            // Desde pending (desktops viejos), sending o review; el mismo
            // resultado repetido es idempotente (reintento del desktop).
            ConditionExpression:
              'attribute_exists(jobId) AND (attribute_not_exists(#s) OR #s IN (:pending, :leased, :sending, :review, :s))',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': status,
              ':t': now,
              ':pending': 'pending',
              ':leased': 'leased',
              ':sending': 'sending',
              ':review': 'review',
            },
          }),
        );
        acked += 1;
      } catch (e) {
        if (!isConditionFailed(e)) throw e;
        // No existe → notFound; discarded u otro final → invalid.
        const cur = await currentStatus(user, jobId);
        (cur.exists ? invalid : notFound).push(jobId);
      }
    }),
  );
  return ok({ acked, notFound, invalid });
}
