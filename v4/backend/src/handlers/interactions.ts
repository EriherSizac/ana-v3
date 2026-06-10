// File: POST /interactions/report — registra en el CRM el resultado de un envío.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CONVERSATIONS_TABLE } from '../lib/dynamo';
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

/** credit_id de una fila: columnas del CSV o lookup por teléfono en el CRM. */
async function resolveCreditId(
  row: Record<string, string>,
  campaign: string,
  phone: string,
): Promise<string> {
  for (const col of CREDIT_COLUMNS) {
    if (row[col]?.trim()) return row[col].trim();
  }
  return await searchCreditIdByPhone(campaign, toE164Mx(phone));
}

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

  try {
    if (event.routeKey === 'POST /interactions/open')
      return await reportOpen(user, JSON.parse(event.body ?? '{}'));
    if (event.routeKey === 'POST /interactions/manual')
      return await reportManual(user, JSON.parse(event.body ?? '{}'));
    if (event.routeKey !== 'POST /interactions/report')
      return bad(`ruta no manejada: ${event.routeKey}`, 404);

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
    const creditId = await resolveCreditId(row, campaign, phone);

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

/**
 * Registra una interacción al ABRIR un chat (como la ventana manual de v3):
 * el agente está atendiendo ese contacto. Datos del contacto vienen de la
 * conversación guardada (campaign + row). Idempotente por (chat, día) para no
 * spamear el CRM cada vez que se abre el mismo chat.
 */
async function reportOpen(
  user: string,
  payload: { chatId?: string },
): Promise<APIGatewayProxyResultV2> {
  const chatId = payload.chatId;
  if (!chatId) return bad('falta chatId');

  // Lee los datos del contacto guardados en la conversación.
  const res = await ddb.send(
    new GetCommand({ TableName: CONVERSATIONS_TABLE, Key: { operatorId: user, chatId } }),
  );
  const conv = res.Item;
  const campaign = String(conv?.campaign ?? '');
  if (!campaign) return ok({ reported: false, reason: 'conversación sin campaña' });

  const row = (conv?.contact ?? {}) as Record<string, string>;
  // Teléfono: de la fila o de los dígitos del chatId (5215513023544@c.us).
  const phone = row.phone || row.telefono || chatId.replace(/\D/g, '');
  const phone10 = toPhone10(phone);

  // Idempotencia diaria: marcador (OPEN#op, chatId#YYYY-MM-DD).
  const day = new Date().toISOString().slice(0, 10);
  try {
    await ddb.send(
      new PutCommand({
        TableName: JOBS_TABLE,
        Item: {
          operatorId: `OPEN#${user}`,
          jobId: `${chatId}#${day}`,
          ttl: Math.floor(Date.now() / 1000) + 2 * 86400,
        },
        ConditionExpression: 'attribute_not_exists(jobId)',
      }),
    );
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException')
      return ok({ reported: false, reason: 'ya registrado hoy' });
    throw e;
  }

  const creditId = await resolveCreditId(row, campaign, phone);
  const inserted = await insertInteraction({
    creditId,
    campaign,
    phone10,
    contactable: true,
    subdictamen: 'Atención WhatsApp',
    comments: `product=${row.product ?? ''}; discount=${row.discount ?? ''}; total_balance=${row.total_balance ?? ''}`,
    at: new Date(),
    inoutbound: 'inbound',
  });
  return ok({ reported: inserted, creditId });
}

interface ManualPayload {
  chatId?: string;
  subdictamen?: string; // resultado de la gestión
  comments?: string;
  contactable?: boolean; // ¿se logró contacto?
  promiseDate?: string; // YYYY-MM-DD
  promiseAmount?: number;
}

/**
 * Interacción MANUAL que el agente registra desde el chat (botón "Registrar
 * gestión"): resultado, comentarios y promesa de pago opcional. Toma campaña y
 * credit_id de la conversación guardada (o lookup por teléfono). No idempotente
 * — cada gestión es un registro nuevo, como en v3.
 */
async function reportManual(
  user: string,
  p: ManualPayload,
): Promise<APIGatewayProxyResultV2> {
  if (!p.chatId) return bad('falta chatId');
  if (!p.subdictamen) return bad('falta subdictamen (resultado)');

  const res = await ddb.send(
    new GetCommand({ TableName: CONVERSATIONS_TABLE, Key: { operatorId: user, chatId: p.chatId } }),
  );
  const conv = res.Item;
  const campaign = String(conv?.campaign ?? '');
  if (!campaign) return bad('conversación sin campaña; no se puede registrar', 409);

  const row = (conv?.contact ?? {}) as Record<string, string>;
  const phone = row.phone || row.telefono || p.chatId.replace(/\D/g, '');
  const creditId = await resolveCreditId(row, campaign, phone);

  const inserted = await insertInteraction({
    creditId,
    campaign,
    phone10: toPhone10(phone),
    contactable: p.contactable ?? true,
    subdictamen: p.subdictamen,
    comments: p.comments ?? '',
    at: new Date(),
    inoutbound: 'inbound',
    promiseDate: p.promiseDate ?? null,
    promiseAmount: p.promiseAmount ?? null,
  });
  return ok({ reported: inserted, creditId });
}
