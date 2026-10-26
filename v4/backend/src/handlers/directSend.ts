// File: POST /send — encola un mensaje directo para que lo envíe un agente.
// Created: 2026-06-10
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomBytes } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, JOB_TTL_DAYS, type SendJob } from '../lib/jobs';
import { ok, bad } from '../lib/http';
import { campaignExists } from '../lib/campaignsDb';
import { fetchEligibleAgents } from '../lib/dashboard';
import { matchesApiKey } from '../lib/apiKey';
import { resolveCatalogCampaign } from '../lib/identity';

// Endpoint sistema-a-sistema (sin Cognito): autentica por X-Api-Key contra
// SEND_API_KEY y, solo durante una rotación, SEND_API_KEY_NEXT. Ambas llegan
// de SSM Parameter Store al desplegar (ver serverless.yml); nunca del repo.
// Se leen en cada invocación (no al importar) para que un entorno sin keys
// siempre responda 401.

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface DirectSendPayload {
  message?: string; // texto a enviar (literal; admite {campos} si mandas row)
  username?: string; // operatorId del agente cuya sesión enviará
  phone?: string; // teléfono destino (crudo; se normaliza con la lada)
  campaign?: string; // campaña — agrupa en el GSI y el registro CRM
  countryCode?: string; // default 52
  row?: Record<string, string>; // opcional: datos para interpolar {campos}
  idempotencyKey?: string; // opcional: reintentos sin duplicar el job
}

/** jobId de un envío directo: sin clave lleva sufijo aleatorio (sin colisiones). */
export function directJobId(now: number, phone: string, idempotencyKey?: string): string {
  if (idempotencyKey) return `direct#key#${idempotencyKey}`;
  return `direct#${now}#${String(phone).replace(/\D/g, '')}#${randomBytes(4).toString('hex')}`;
}

/**
 * Encola un SendJob `auto: true` en la partición del agente. Su app de
 * escritorio lo recoge en el siguiente poll (~5s) y lo envía de inmediato,
 * sin pasar por la aprobación de "Mi asignación" (es un mensaje puntual ya
 * autorizado por el sistema que invoca). El resultado se registra en el CRM
 * igual que cualquier envío de campaña.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.routeKey !== 'POST /send')
    return bad(`ruta no manejada: ${event.routeKey}`, 404);

  const gotKey = event.headers?.['x-api-key'];
  if (!matchesApiKey(gotKey, [process.env.SEND_API_KEY, process.env.SEND_API_KEY_NEXT]))
    return bad('no autorizado', 401);

  try {
    const p = JSON.parse(event.body ?? '{}') as DirectSendPayload;
    const { message, username, phone, idempotencyKey } = p;
    if (!message || !username || !phone || !p.campaign)
      return bad('faltan message/username/phone/campaign');
    if (
      idempotencyKey !== undefined &&
      (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(idempotencyKey))
    )
      return bad('idempotencyKey inválida');
    // Grafía del catálogo para el job y el CRM (v4-canonical-identity-keys D4).
    const campaign = await resolveCatalogCampaign(String(p.campaign));
    // La campaña debe existir en la DB (validada contra SELECT name FROM campaigns).
    if (!(await campaignExists(campaign)))
      return bad(`la campaña "${campaign}" no existe`, 400);

    // El agente debe ser elegible en la campaña (misma fuente/regla que el
    // reparto de CSV). Fuente caída → 503: encolar a ciegas deja jobs huérfanos.
    const agents = await fetchEligibleAgents(campaign);
    if (agents === null) return bad('no se pudo validar el agente', 503);
    const wanted = String(username).toLowerCase();
    const operatorId = agents.find((a) => a.toLowerCase() === wanted);
    if (!operatorId) return bad(`el agente "${username}" no pertenece a la campaña`, 400);

    const now = Date.now();
    const job: SendJob & { auto: boolean } = {
      operatorId, // grafía que devuelve la fuente de agentes
      jobId: directJobId(now, String(phone), idempotencyKey),
      campaignId: `direct-${campaign}`,
      campaign,
      phone: String(phone),
      template: message,
      row: p.row ?? {},
      countryCode: p.countryCode ?? '52',
      srcKey: '', // no viene de un CSV → nada que borrar en S3
      status: 'pending',
      attempts: 0,
      ttl: Math.floor(now / 1000) + JOB_TTL_DAYS * 86400,
      auto: true, // el desktop lo envía sin aprobación manual
    };

    try {
      // Condicional siempre: nunca se pisa un job existente (con o sin clave).
      await ddb.send(
        new PutCommand({
          TableName: JOBS_TABLE,
          Item: job,
          ConditionExpression: 'attribute_not_exists(jobId)',
        }),
      );
    } catch (e) {
      if (idempotencyKey && (e as { name?: string })?.name === 'ConditionalCheckFailedException')
        return ok({ queued: true, jobId: job.jobId, operatorId, campaign, duplicate: true });
      throw e;
    }
    return ok({ queued: true, jobId: job.jobId, operatorId, campaign });
  } catch (e) {
    console.error('[directSend] error', e);
    return bad('error interno', 500);
  }
};
