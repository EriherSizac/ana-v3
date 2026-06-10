// File: GET /jobs/poll  → entrega hasta MAX_BATCH jobs del PROPIO operador y los
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, type SendJob } from '../lib/jobs';
import { ok, bad, claimUser } from '../lib/http';

/**
 * GET /jobs/poll  → TODOS los jobs pendientes del PROPIO operador (sin lease).
 *                   Solo hay un agente por operador (su Electron), así que no
 *                   hay carrera; el agente procesa local (1 archivo a la vez,
 *                   rate-limited) y hace ack de cada uno al enviarlo.
 * POST /jobs/ack  → borra jobs procesados (body: { ids: string[] }).
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

async function ack(
  user: string,
  payload: { ids?: string[] },
): Promise<APIGatewayProxyResultV2> {
  const ids = payload.ids ?? [];
  await Promise.all(
    ids.map((jobId) =>
      ddb.send(
        new DeleteCommand({ TableName: JOBS_TABLE, Key: { operatorId: user, jobId } }),
      ),
    ),
  );
  return ok({ deleted: ids.length });
}
