// File: Vista y reasignación de send-jobs por campaña (líder/admin).
// Created: 2026-06-10
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, JOB_TTL_DAYS, isPendingStatus, jobsCampaignIndex, type SendJob } from '../lib/jobs';
import { promoteToReview } from '../lib/jobReview';
import { checkAssignmentsEnabled } from '../lib/distribution';
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
 * GET /jobs/review?campaign=X[&srcKey=K] → jobs por revisar/descartados.
 * POST /jobs/review/resolve → descarta o reencola jobs por revisar.
 *
 * Sin lease (v4-harden-send-job-queue D2): "pendiente" = `pending`, sin estado o
 * `leased` heredado; `sending`/`review` no se mueven (v4-review-interrupted-sends)
 * y el resto es historial.
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
    if (event.routeKey === 'GET /jobs/review')
      return await review(access, event.queryStringParameters?.campaign, event.queryStringParameters?.srcKey);
    if (event.routeKey === 'POST /jobs/review/resolve')
      return await resolveReview(access, JSON.parse(event.body ?? '{}'));
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

type JobRef = Pick<SendJob, 'operatorId' | 'jobId' | 'campaignId' | 'ttl' | 'status' | 'srcKey'>;

/** Jobs PENDIENTES vigentes de una campaña vía el índice por campaña (paginado). */
async function queryPendingCampaignJobs(campaign: string, operatorId?: string): Promise<JobRef[]> {
  return (await queryCampaignJobs(campaign, operatorId)).filter((i) => isPendingStatus(i.status));
}

/**
 * Jobs vigentes (TTL) de una campaña vía el índice por campaña; los `sending`
 * vencidos pasan a `review` en el camino (paso perezoso, design D2).
 */
async function queryCampaignJobs(campaign: string, operatorId?: string): Promise<JobRef[]> {
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
        ProjectionExpression: 'operatorId, jobId, campaignId, srcKey, #ttl, #s',
        ExpressionAttributeNames: { '#ttl': 'ttl', '#s': 'status' },
        ExclusiveStartKey,
      }),
    );
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // TTL borra con retraso → filtra expirados.
  const now = Date.now();
  const nowS = Math.floor(now / 1000);
  const live: JobRef[] = items.filter((i) => !i.ttl || i.ttl > nowS);
  // El índice no proyecta claimedAt: la condición de la escritura decide.
  for (const j of live) {
    if (j.status !== 'sending') continue;
    const updated = await promoteToReview(j.operatorId, j.jobId, now);
    if (updated) j.status = 'review';
  }
  return live;
}

async function summary(
  access: UserAccess,
  campaign?: string,
): Promise<APIGatewayProxyResultV2> {
  if (!campaign) return bad('falta campaign');
  if (!canManageCampaign(access, campaign)) return bad('sin permiso', 403);

  const jobs = await queryCampaignJobs(campaign);
  const byOperator = new Map<string, { pending: number; review: number; files: Set<string> }>();
  let total = 0;
  for (const j of jobs) {
    const pending = isPendingStatus(j.status);
    const review = j.status === 'review';
    if (!pending && !review) continue;
    const agg = byOperator.get(j.operatorId) ?? { pending: 0, review: 0, files: new Set<string>() };
    if (pending) {
      agg.pending += 1;
      agg.files.add(j.campaignId);
      total += 1;
    } else agg.review += 1;
    byOperator.set(j.operatorId, agg);
  }

  return ok({
    campaign,
    total, // solo pendientes
    operators: [...byOperator.entries()].map(([operatorId, a]) => ({
      operatorId,
      pending: a.pending,
      leased: 0, // sin lease; se conserva por compatibilidad
      review: a.review,
      files: [...a.files],
    })),
  });
}

const REVIEW_STATUSES = new Set(['review', 'discarded']);
export const RESOLVE_MAX_ITEMS = 100;

/** BatchGet de la tabla base (100 por request, reintenta UnprocessedKeys). */
async function batchGetJobs(keys: { operatorId: string; jobId: string }[]): Promise<SendJob[]> {
  const out: SendJob[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    let pending: Record<string, any>[] = keys.slice(i, i + 100);
    for (let attempt = 0; pending.length > 0 && attempt < 5; attempt++) {
      const res = await ddb.send(new BatchGetCommand({ RequestItems: { [JOBS_TABLE]: { Keys: pending } } }));
      out.push(...((res.Responses?.[JOBS_TABLE] ?? []) as SendJob[]));
      pending = (res.UnprocessedKeys?.[JOBS_TABLE]?.Keys ?? []) as Record<string, any>[];
    }
  }
  return out;
}

/**
 * GET /jobs/review?campaign=<c>[&srcKey=<k>] — jobs `review` y `discarded`
 * vigentes de la campaña (o de esa carga), con la fila para identificarlos.
 */
async function review(
  access: UserAccess,
  campaign?: string,
  srcKey?: string,
): Promise<APIGatewayProxyResultV2> {
  if (!campaign) return bad('falta campaign');
  if (!canManageCampaign(access, campaign)) return bad('sin permiso', 403);

  const refs = (await queryCampaignJobs(campaign)).filter(
    (j) => REVIEW_STATUSES.has(String(j.status)) && (!srcKey || j.srcKey === srcKey),
  );
  const full = await batchGetJobs(refs.map((r) => ({ operatorId: r.operatorId, jobId: r.jobId })));
  const items = full
    // La fila de la tabla base manda (pudo resolverse entre el índice y aquí).
    .filter((j) => REVIEW_STATUSES.has(String(j.status)) && (!srcKey || j.srcKey === srcKey))
    .sort((a, b) => a.operatorId.localeCompare(b.operatorId) || a.jobId.localeCompare(b.jobId))
    .map((j) => ({
      operatorId: j.operatorId,
      jobId: j.jobId,
      srcKey: j.srcKey ?? '',
      label: j.label ?? null,
      phone: j.phone,
      row: j.row ?? {},
      auto: j.auto === true,
      claimedAt: j.claimedAt ?? null,
      reviewAt: j.reviewAt ?? null,
      status: j.status,
      ...(j.resolution ? { resolution: j.resolution } : {}),
      ...(j.resolvedBy ? { resolvedBy: j.resolvedBy } : {}),
      ...(j.resolvedAt ? { resolvedAt: j.resolvedAt } : {}),
      ...(j.requeuedTo ? { requeuedTo: j.requeuedTo } : {}),
    }));
  return ok({ campaign, items });
}

type ResolveResult = { jobId: string; operatorId: string; ok: boolean; error?: string; newJobId?: string; to?: string };

/** Quita los atributos de reserva/revisión/resolución para el job reencolado. */
function requeuedCopy(job: SendJob, to: string, now: number): SendJob {
  const {
    leaseUntil: _l,
    claimedAt: _c,
    reviewReason: _r,
    reviewAt: _ra,
    resolution: _res,
    resolvedBy: _rb,
    resolvedAt: _rat,
    requeuedTo: _rt,
    sentAt: _s,
    ...rest
  } = job;
  return {
    ...rest,
    operatorId: to,
    jobId: `${job.jobId}~r${now}`,
    status: 'pending',
    attempts: 0,
    ttl: Math.floor(now / 1000) + JOB_TTL_DAYS * 86400,
    requeuedFrom: `${job.operatorId}/${job.jobId}`,
  };
}

async function resolveOne(
  campaign: string,
  by: string,
  item: { operatorId: string; jobId: string },
  action: 'discard' | 'requeue',
  to: string | undefined,
): Promise<ResolveResult> {
  const now = Date.now();
  const base = { jobId: item.jobId, operatorId: item.operatorId };
  const { Item } = await ddb.send(
    new GetCommand({ TableName: JOBS_TABLE, Key: { operatorId: item.operatorId, jobId: item.jobId } }),
  );
  const job = Item as SendJob | undefined;
  // Solo jobs de ESTA campaña (la autorización es por campaña) y aún por revisar.
  if (!job || job.campaign !== campaign) return { ...base, ok: false, error: 'no encontrado' };
  if (job.status !== 'review') return { ...base, ok: false, error: 'ya no está por revisar' };

  const cond = {
    ConditionExpression: '#s = :review',
    ExpressionAttributeNames: { '#s': 'status' },
  };
  try {
    if (action === 'discard') {
      await ddb.send(
        new UpdateCommand({
          TableName: JOBS_TABLE,
          Key: { operatorId: item.operatorId, jobId: item.jobId },
          UpdateExpression: 'SET #s = :discarded, resolution = :res, resolvedBy = :by, resolvedAt = :now',
          ...cond,
          ExpressionAttributeValues: { ':review': 'review', ':discarded': 'discarded', ':res': 'discarded', ':by': by, ':now': now },
        }),
      );
      return { ...base, ok: true };
    }
    const target = to ?? job.operatorId;
    const copy = requeuedCopy(job, target, now);
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: JOBS_TABLE,
              Key: { operatorId: item.operatorId, jobId: item.jobId },
              UpdateExpression:
                'SET #s = :discarded, resolution = :res, resolvedBy = :by, resolvedAt = :now, requeuedTo = :to',
              ...cond,
              ExpressionAttributeValues: {
                ':review': 'review',
                ':discarded': 'discarded',
                ':res': 'requeued',
                ':by': by,
                ':now': now,
                ':to': target,
              },
            },
          },
          {
            Put: {
              TableName: JOBS_TABLE,
              Item: copy,
              ConditionExpression: 'attribute_not_exists(jobId)',
            },
          },
        ],
      }),
    );
    return { ...base, ok: true, newJobId: copy.jobId, to: target };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException')
      return { ...base, ok: false, error: 'ya no está por revisar' };
    throw e;
  }
}

/**
 * POST /jobs/review/resolve {campaign, items:[{operatorId,jobId}], action, to?}
 * (design D5): `discard` o `requeue` (job nuevo `pending`) por item.
 */
async function resolveReview(
  access: UserAccess,
  payload: { campaign?: unknown; items?: unknown; action?: unknown; to?: unknown },
): Promise<APIGatewayProxyResultV2> {
  const campaign = typeof payload.campaign === 'string' ? payload.campaign : '';
  if (!campaign) return bad('falta campaign');
  const action = payload.action;
  if (action !== 'discard' && action !== 'requeue') return bad('action inválida');
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length < 1 || items.length > RESOLVE_MAX_ITEMS) return bad(`items debe tener de 1 a ${RESOLVE_MAX_ITEMS}`);
  const refs: { operatorId: string; jobId: string }[] = [];
  for (const it of items) {
    const op = (it as { operatorId?: unknown })?.operatorId;
    const id = (it as { jobId?: unknown })?.jobId;
    if (typeof op !== 'string' || !op || typeof id !== 'string' || !id) return bad('item inválido');
    refs.push({ operatorId: op, jobId: id });
  }
  const to = typeof payload.to === 'string' && payload.to.trim() ? payload.to.trim() : undefined;
  if (payload.to !== undefined && payload.to !== null && !to) return bad('to inválido');
  if (!canManageCampaign(access, campaign)) return bad('sin permiso', 403);
  // Con AGENT_ROSTER_FILTER el destino del reencolado debe estar habilitado.
  if (action === 'requeue' && to) {
    const check = await checkAssignmentsEnabled(campaign, [to]);
    if (!check.ok) return bad(check.error, check.status);
  }

  const results: ResolveResult[] = [];
  for (const ref of refs) results.push(await resolveOne(campaign, access.username, ref, action, to));
  console.log(
    JSON.stringify({ evt: 'review_resolve', campaign, action, by: access.username, count: refs.length, ok: results.filter((r) => r.ok).length }),
  );
  return ok({ results });
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
