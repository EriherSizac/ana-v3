// File: Vista y reasignación de send-jobs por campaña (líder/admin).
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, type SendJob } from '../lib/jobs';
import { ok, bad, claimUser } from '../lib/http';
import { resolveUserAccess, type UserAccess } from '../lib/access';

const CAMPAIGN_INDEX = 'campaign-index';

/**
 * GET /jobs/summary?campaign=X → pendientes por operador de la campaña (GSI).
 * POST /jobs/reassign { campaign, from, to } → mueve los jobs pendientes de un
 *   operador a otro (la PK cambia → delete+put transaccional por job). Cubre
 *   "agente se desconectó a media campaña" — el equivalente v4 del consume-once
 *   + updatePendingContacts de v3.
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

/** Todos los jobs de una campaña vía GSI (paginado, proyección mínima). */
async function queryCampaignJobs(
  campaign: string,
  operatorId?: string,
): Promise<Pick<SendJob, 'operatorId' | 'jobId' | 'campaignId' | 'leaseUntil' | 'ttl' | 'status'>[]> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: JOBS_TABLE,
        IndexName: CAMPAIGN_INDEX,
        KeyConditionExpression: operatorId
          ? 'campaign = :c AND operatorId = :o'
          : 'campaign = :c',
        ExpressionAttributeValues: {
          ':c': campaign,
          ...(operatorId ? { ':o': operatorId } : {}),
        },
        ProjectionExpression: 'operatorId, jobId, campaignId, leaseUntil, #ttl, #s',
        ExpressionAttributeNames: { '#ttl': 'ttl', '#s': 'status' },
        ExclusiveStartKey,
      }),
    );
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // TTL borra con retraso → filtra expirados. Solo POR ENVIAR: los procesados
  // (sent/no_whatsapp/error) son historial, no cuentan como pendientes.
  const nowS = Math.floor(Date.now() / 1000);
  const PENDING = new Set(['pending', 'leased', undefined]);
  return items.filter((i) => (!i.ttl || i.ttl > nowS) && PENDING.has(i.status));
}

async function summary(
  access: UserAccess,
  campaign?: string,
): Promise<APIGatewayProxyResultV2> {
  if (!campaign) return bad('falta campaign');
  if (!canManageCampaign(access, campaign)) return bad('sin permiso', 403);

  const jobs = await queryCampaignJobs(campaign);
  const now = Date.now();
  const byOperator = new Map<string, { pending: number; leased: number; files: Set<string> }>();
  for (const j of jobs) {
    const agg = byOperator.get(j.operatorId) ?? { pending: 0, leased: 0, files: new Set() };
    if ((j.leaseUntil ?? 0) > now) agg.leased += 1;
    else agg.pending += 1;
    agg.files.add(j.campaignId);
    byOperator.set(j.operatorId, agg);
  }

  return ok({
    campaign,
    total: jobs.length,
    operators: [...byOperator.entries()].map(([operatorId, a]) => ({
      operatorId,
      pending: a.pending,
      leased: a.leased,
      files: [...a.files],
    })),
  });
}

async function reassign(
  access: UserAccess,
  payload: { campaign?: string; from?: string; to?: string },
): Promise<APIGatewayProxyResultV2> {
  const { campaign, from, to } = payload;
  if (!campaign || !from || !to) return bad('faltan campaign/from/to');
  if (from === to) return bad('from y to son el mismo operador');
  if (!canManageCampaign(access, campaign)) return bad('sin permiso', 403);

  const refs = await queryCampaignJobs(campaign, from);
  const now = Date.now();
  let moved = 0;
  let skippedLeased = 0;

  for (const ref of refs) {
    // No mover un job que el agente tiene en lease activo (lo está enviando).
    if ((ref.leaseUntil ?? 0) > now) {
      skippedLeased += 1;
      continue;
    }
    // Lee el job completo de la tabla base (el GSI solo proyecta keys).
    const res = await ddb.send(
      new QueryCommand({
        TableName: JOBS_TABLE,
        KeyConditionExpression: 'operatorId = :o AND jobId = :j',
        ExpressionAttributeValues: { ':o': from, ':j': ref.jobId },
      }),
    );
    const job = res.Items?.[0] as SendJob | undefined;
    if (!job) continue;

    // delete+put atómico: el job nunca existe en dos particiones a la vez.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: JOBS_TABLE,
              Key: { operatorId: from, jobId: job.jobId },
              // Si el agente lo tomó en lease entre el query y aquí, abortar.
              ConditionExpression: 'attribute_exists(jobId) AND leaseUntil <= :now',
              ExpressionAttributeValues: { ':now': now },
            },
          },
          {
            Put: {
              TableName: JOBS_TABLE,
              Item: { ...job, operatorId: to, leaseUntil: 0, status: 'pending' },
            },
          },
        ],
      }),
    ).then(
      () => (moved += 1),
      (e) => {
        if (e?.name !== 'TransactionCanceledException') throw e;
        skippedLeased += 1; // carrera con el lease → lo dejamos donde está
      },
    );
  }

  return ok({ campaign, from, to, moved, skippedLeased });
}
