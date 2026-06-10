// File: POST /send — encola un mensaje directo para que lo envíe un agente.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, JOB_TTL_DAYS, type SendJob } from '../lib/jobs';
import { ok, bad } from '../lib/http';

// Endpoint sistema-a-sistema (sin Cognito): autentica por X-Api-Key contra
// SEND_API_KEY (backend/.env). Pensado para que el CRM u otra automatización
// dispare un WhatsApp puntual a través de la sesión del agente indicado.
const API_KEY = process.env.SEND_API_KEY ?? '';

interface DirectSendPayload {
  message?: string; // texto a enviar (literal; admite {campos} si mandas row)
  username?: string; // operatorId del agente cuya sesión enviará
  phone?: string; // teléfono destino (crudo; se normaliza con la lada)
  campaign?: string; // campaña — agrupa en el GSI y el registro CRM
  countryCode?: string; // default 52
  row?: Record<string, string>; // opcional: datos para interpolar {campos}
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

  const gotKey = event.headers?.['x-api-key'] ?? '';
  if (!API_KEY || gotKey !== API_KEY) return bad('no autorizado', 401);

  try {
    const p = JSON.parse(event.body ?? '{}') as DirectSendPayload;
    const { message, username, phone, campaign } = p;
    if (!message || !username || !phone || !campaign)
      return bad('faltan message/username/phone/campaign');

    const now = Date.now();
    const job: SendJob & { auto: boolean } = {
      operatorId: username,
      jobId: `direct#${now}#${String(phone).replace(/\D/g, '')}`,
      campaignId: `direct-${campaign}`,
      campaign,
      phone: String(phone),
      template: message,
      row: p.row ?? {},
      countryCode: p.countryCode ?? '52',
      srcKey: '', // no viene de un CSV → nada que borrar en S3
      status: 'pending',
      leaseUntil: 0,
      attempts: 0,
      ttl: Math.floor(now / 1000) + JOB_TTL_DAYS * 86400,
      auto: true, // el desktop lo envía sin aprobación manual
    };

    await ddb.send(new PutCommand({ TableName: JOBS_TABLE, Item: job }));
    return ok({ queued: true, jobId: job.jobId, operatorId: username, campaign });
  } catch (e) {
    console.error('[directSend] error', e);
    return bad('error interno', 500);
  }
};
