// File: POST /interactions/report — registra en el CRM el resultado de un envío.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, JOB_TTL_DAYS } from '../lib/jobs';
import { ok, bad, claimUser } from '../lib/http';
import {
  searchCreditIdByPhone,
  insertInteraction,
  markPhoneNoWhatsapp,
  toE164Mx,
  toPhone10,
} from '../lib/interactions';

// Columnas del CSV donde puede venir el credit_id (mismos alias que v3-cli).
const CREDIT_COLUMNS = ['credit', 'credito', 'credit_id', 'id_credito'];

interface ReportPayload {
  jobId?: string;
  campaign?: string; // campaign_name del CRM
  phone?: string; // crudo, tal cual del CSV
  status?: 'sent' | 'no_whatsapp' | 'error';
  row?: Record<string, string>; // fila del CSV (para credit_id y comments)
}

/**
 * El desktop lo llama tras cada job de campaña (fire-and-forget). El Lambda:
 *  1. resuelve credit_id (columna del CSV, o lookup por teléfono en el CRM)
 *  2. inserta la interacción outbound (subdictamen según status)
 *  3. si no_whatsapp: PATCH del teléfono en el CRM
 * Idempotente por jobId: un marcador en la tabla de jobs (PK=REPORT#<op>) hace
 * que el retry del desktop no duplique interacciones en el CRM.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const user = claimUser(event);
  if (!user) return bad('no autenticado', 401);
  if (event.routeKey !== 'POST /interactions/report')
    return bad(`ruta no manejada: ${event.routeKey}`, 404);

  try {
    const p = JSON.parse(event.body ?? '{}') as ReportPayload;
    const { jobId, campaign, phone, status } = p;
    if (!jobId || !phone || !status) return bad('faltan jobId/phone/status');
    if (!campaign) return ok({ reported: false, reason: 'sin campaña, no se registra' });

    // Idempotencia: marcador por (operador, jobId). Si ya existe, no repetir.
    try {
      await ddb.send(
        new PutCommand({
          TableName: JOBS_TABLE,
          Item: {
            operatorId: `REPORT#${user}`,
            jobId,
            ttl: Math.floor(Date.now() / 1000) + JOB_TTL_DAYS * 86400,
          },
          ConditionExpression: 'attribute_not_exists(jobId)',
        }),
      );
    } catch (e: any) {
      if (e?.name === 'ConditionalCheckFailedException')
        return ok({ reported: false, reason: 'ya reportado' });
      throw e;
    }

    const row = p.row ?? {};
    const phone10 = toPhone10(phone);

    // credit_id: primero columnas del CSV, si no lookup por teléfono (como v3).
    let creditId = '';
    for (const col of CREDIT_COLUMNS) {
      if (row[col]?.trim()) {
        creditId = row[col].trim();
        break;
      }
    }
    if (!creditId) creditId = await searchCreditIdByPhone(campaign, toE164Mx(phone));

    const sent = status === 'sent';
    const inserted = await insertInteraction({
      creditId,
      campaign,
      phone10,
      contactable: sent,
      subdictamen: status === 'no_whatsapp' ? 'No tiene Whatsapp' : 'Se envía WhatsApp',
      comments: `product=${row.product ?? ''}; discount=${row.discount ?? ''}; total_balance=${row.total_balance ?? ''}`,
      at: new Date(),
    });

    let phonePatched = false;
    if (status === 'no_whatsapp' && creditId && phone10)
      phonePatched = await markPhoneNoWhatsapp(creditId, campaign, phone10);

    return ok({ reported: inserted, creditId, phonePatched });
  } catch (e) {
    console.error('[interactions] error', e);
    return bad('error interno', 500);
  }
};
