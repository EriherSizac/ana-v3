// File: Vista y reasignación de send-jobs por campaña (líder/admin).
// Created: 2026-06-10
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, isPendingStatus, jobsCampaignIndex, type SendJob } from '../lib/jobs';
import { ok, bad, claimUser } from '../lib/http';
import { resolveUserAccess, type UserAccess } from '../lib/access';

export const REASSIGN_CONCURRENCY = 10;
export const REASSIGN_BUDGET_MS = 25_000;

/**
 * GET /jobs/summary?campaign=X → pendientes por operador de la campaña (GSI).
 * POST /jobs/reassign { campaign, from, to } → mueve los jobs pendientes de un
 *   operador a otro (la PK cambia → delete+put transaccional por job). Cubre
 *   "agente se desconectó a media campaña" — el equivalente v4 del consume-once
 *   + updatePendingContacts de v3.
 *
 * Sin lease (v4-harden-send-job-queue D2): "pendiente" = `pending`, sin estado o
 * `leased` heredado; el resto es historial y no se cuenta ni se mueve.
 *
 * Autorización fail-closed (no depende del flag de enforcement): admin ve todo;
 * líder solo campañas propias.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const user = claimUser(event);
  if (!user) return bad('no autenticado', 401);

  try {
    const access = await resolveUserAccess(user);
    if (event.routeKey === 'GET /jobs/summary')
      return await summary(access, event.queryStringParameters?.campaign);
    if (event.routeKey === 'POST /jobs/reassign')
      return await reassign(access, JSON.parse(event.body ?? '{}'));
    return bad(`ruta no manejada: ${event.routeKey}`, 404);
  } catch (e) {
    console.error('[jobsAdmin] error', event.routeKey, e);
    return bad('error interno', 500);
  }
};

function canManageCampaign(access: UserAccess, campaign: string): boolean {
  if (access.isAdmin) return true;
  if (!access.isLeader) return false;
  return access.campaigns.includes('*') || access.campaigns.includes(campaign);
}

type JobRef = Pick<SendJob, 'operatorId' | 'jobId' | 'campaignId' | 'ttl' | 'status'>;

/** Jobs PENDIENTES vigentes de una campaña vía el índice por campaña (paginado). */
async function queryPendingCampaignJobs(campaign: string, operatorId?: string): Promise<JobRef[]> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: JOBS_TABLE,
        IndexName: jobsCampaignIndex(),
        KeyConditionExpression: operatorId
          ? 'campaign = :c AND operatorId = :o'
          : 'campaign = :c',
        ExpressionAttributeValues: {
          ':c': campaign,
          ...(operatorId ? { ':o': operatorId } : {}),
        },
        // `status` solo existe en campaign-status-index; en el índice viejo
        // falta y el job cuenta como pendiente (comportamiento previo).
        ProjectionExpression: 'operatorId, jobId, campaignId, #ttl, #s',
        ExpressionAttributeNames: { '#ttl': 'ttl', '#s': 'status' },
        ExclusiveStartKey,
      }),
    );
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // TTL borra con retraso → filtra expirados. Solo POR ENVIAR.
  const nowS = Math.floor(Date.now() / 1000);
  return items.filter((i) => (!i.ttl || i.ttl > nowS) && isPendingStatus(i.status));
}

async function summary(
  access: UserAccess,
  campaign?: string,
): Promise<APIGatewayProxyResultV2> {
  if (!campaign) return bad('falta campaign');
  if (!canManageCampaign(access, campaign)) return bad('sin permiso', 403);

  const jobs = await queryPendingCampaignJobs(campaign);
  const byOperator = new Map<string, { pending: number; files: Set<string> }>();
  for (const j of jobs) {
    const agg = byOperator.get(j.operatorId) ?? { pending: 0, files: new Set<string>() };
    agg.pending += 1;
    agg.files.add(j.campaignId);
    byOperator.set(j.operatorId, agg);
  }

  return ok({
    campaign,
    total: jobs.length,
    operators: [...byOperator.entries()].map(([operatorId, a]) => ({
      operatorId,
      pending: a.pending,
      leased: 0, // sin lease; se conserva por compatibilidad
      files: [...a.files],
    })),
  });
}

/** Mueve un job pendiente de `from` a `to`. 'skipped' si ya no está pendiente. */
async function moveJob(from: string, to: string, jobId: string): Promise<'moved' | 'skipped'> {
  // El índice no proyecta la fila: lee el job completo de la tabla base.
  const { Item } = await ddb.send(
    new GetCommand({ TableName: JOBS_TABLE, Key: { operatorId: from, jobId } }),
  );
  const job = Item as SendJob | undefined;
  if (!job || !isPendingStatus(job.status)) return 'skipped';
  const { leaseUntil: _lease, ...rest } = job;
  try {
    // delete+put atómico: el job nunca existe en dos particiones a la vez.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: JOBS_TABLE,
              Key: { operatorId: from, jobId },
              // Si el agente lo procesó entre la lectura y aquí, abortar.
              ConditionExpression: '#s = :pending OR attribute_not_exists(#s) OR #s = :leased',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':pending': 'pending', ':leased': 'leased' },
            },
          },
          {
            Put: {
              TableName: JOBS_TABLE,
              Item: { ...rest, operatorId: to, status: 'pending' },
            },
          },
        ],
      }),
    );
    return 'moved';
  } catch (e) {
    if ((e as { name?: string })?.name !== 'TransactionCanceledException') throw e;
    return 'skipped'; // carrera con el agente origen → se queda donde está
  }
}

async function reassign(
  access: UserAccess,
  payload: { campaign?: string; from?: string; to?: string },
): Promise<APIGatewayProxyResultV2> {
  const { campaign, from, to } = payload;
  if (!campaign || !from || !to) return bad('faltan campaign/from/to');
  if (from === to) return bad('from y to son el mismo operador');
  if (!canManageCampaign(access, campaign)) return bad('sin permiso', 403);

  const started = Date.now();
  const refs = await queryPendingCampaignJobs(campaign, from);
  let moved = 0;
  let skipped = 0;
  let next = 0;

  // Pool de REASSIGN_CONCURRENCY workers; ninguno arranca un job nuevo una vez
  // agotado el presupuesto (la Lambda corta a los 29 s).
  const worker = async () => {
    while (next < refs.length) {
      if (Date.now() - started >= REASSIGN_BUDGET_MS) return;
      const ref = refs[next++];
      const r = await moveJob(from, to, ref.jobId);
      if (r === 'moved') moved += 1;
      else skipped += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(REASSIGN_CONCURRENCY, refs.length) }, worker));
  const remaining = refs.length - next;
  const partial = remaining > 0;

  return ok({
    campaign,
    from,
    to,
    moved,
    skipped,
    skippedLeased: skipped, // alias por compatibilidad con el desktop actual
    partial,
    ...(partial ? { remaining } : {}),
  });
}
