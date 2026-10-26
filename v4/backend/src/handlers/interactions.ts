// File: POST /interactions/report — registra en el CRM el resultado de un envío.
// Created: 2026-06-10
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CONVERSATIONS_TABLE } from '../lib/dynamo';
import { JOB_TTL_DAYS } from '../lib/jobs';
import { ok, bad, claimUser } from '../lib/http';
import {
  searchCreditIdByPhone,
  insertInteraction,
  markPhoneNoWhatsapp,
  mxDateParts,
  toE164Mx,
  toPhone10,
} from '../lib/interactions';
import { claim, confirm, release } from '../lib/idempotency';
import { resolveCatalogCampaign } from '../lib/identity';
import { routeAllowed } from '../lib/access';

// Columnas del CSV donde puede venir el credit_id (mismos alias que v3-cli).
const CREDIT_COLUMNS = ['credit', 'credito', 'credit_id', 'id_credito'];
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

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

const ttlInDays = (days: number) => Math.floor(Date.now() / 1000) + days * 86400;

/**
 * Ejecuta `insert` bajo un marcador de idempotencia con estado: reserva
 * `pending`, confirma `done` si insertó y libera si falló (→ `retryable`).
 * Devuelve la respuesta de "duplicado"/"en curso" sin llamar al CRM.
 */
async function withMarker(
  pk: string,
  sk: string,
  ttlSec: number,
  duplicateReason: string,
  insert: () => Promise<{ inserted: boolean; body: Record<string, unknown>; afterConfirm?: () => Promise<Record<string, unknown>> }>,
): Promise<APIGatewayProxyResultV2> {
  const c = await claim(pk, sk, ttlSec);
  if (!c.claimed)
    return ok({ reported: false, reason: c.state === 'done' ? duplicateReason : 'en curso' });
  let r: Awaited<ReturnType<typeof insert>>;
  try {
    r = await insert();
  } catch (e) {
    await release(pk, sk, c.claimedAt).catch(() => undefined);
    throw e;
  }
  if (!r.inserted) {
    await release(pk, sk, c.claimedAt);
    return ok({ reported: false, retryable: true, ...r.body });
  }
  await confirm(pk, sk, c.claimedAt);
  // Lo secundario (PATCH /phone) va tras confirmar: si falla, no se reintenta
  // la interacción (duplicaría).
  const extra = r.afterConfirm ? await r.afterConfirm() : {};
  return ok({ reported: true, ...r.body, ...extra });
}

interface ReportPayload {
  jobId?: string;
  campaign?: string; // campaign_name del CRM
  phone?: string; // crudo, tal cual del CSV
  status?: 'sent' | 'no_whatsapp' | 'error';
  row?: Record<string, string>; // fila del CSV (para credit_id y comments)
}

/**
 * El desktop lo llama tras cada job de campaña. El Lambda:
 *  1. reserva el marcador REPORT#<op>/<jobId> (pending)
 *  2. resuelve credit_id (columna del CSV, o lookup por teléfono en el CRM)
 *  3. inserta la interacción outbound (subdictamen según status)
 *  4. confirma el marcador (done) o lo libera si el CRM falló (retryable)
 *  5. si no_whatsapp: PATCH del teléfono en el CRM
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const user = claimUser(event);
  if (!user) return bad('no autenticado', 401);

  try {
    // report → envío de campaña; open/manual → responder (según PERMISSIONS_ENFORCED).
    if (!(await routeAllowed(user, event.routeKey))) return bad('sin permiso', 403);
    if (event.routeKey === 'POST /interactions/open')
      return await reportOpen(user, JSON.parse(event.body ?? '{}'));
    if (event.routeKey === 'POST /interactions/manual')
      return await reportManual(user, JSON.parse(event.body ?? '{}'));
    if (event.routeKey !== 'POST /interactions/report')
      return bad(`ruta no manejada: ${event.routeKey}`, 404);

    const p = JSON.parse(event.body ?? '{}') as ReportPayload;
    const { jobId, phone, status } = p;
    if (!jobId || !phone || !status) return bad('faltan jobId/phone/status');
    if (!p.campaign) return ok({ reported: false, reason: 'sin campaña, no se registra' });
    // El CRM recibe la grafía del catálogo (v4-canonical-identity-keys D4).
    const campaign = await resolveCatalogCampaign(p.campaign);

    return await withMarker(`REPORT#${user}`, jobId, ttlInDays(JOB_TTL_DAYS), 'ya reportado', async () => {
      const row = p.row ?? {};
      const phone10 = toPhone10(phone);
      const creditId = await resolveCreditId(row, campaign, phone);
      const inserted = await insertInteraction({
        creditId,
        campaign,
        phone10,
        contactable: status === 'sent',
        subdictamen: status === 'no_whatsapp' ? 'No tiene Whatsapp' : 'Se envía WhatsApp',
        comments: `product=${row.product ?? ''}; discount=${row.discount ?? ''}; total_balance=${row.total_balance ?? ''}`,
        at: new Date(),
      });
      return {
        inserted,
        body: { creditId },
        afterConfirm: async () => {
          let phonePatched = false;
          if (status === 'no_whatsapp' && creditId && phone10)
            phonePatched = await markPhoneNoWhatsapp(creditId, campaign, phone10);
          return { phonePatched };
        },
      };
    });
  } catch (e) {
    console.error('[interactions] error', e);
    return bad('error interno', 500);
  }
};

/**
 * Registra una interacción al ABRIR un chat (como la ventana manual de v3):
 * el agente está atendiendo ese contacto. Datos del contacto vienen de la
 * conversación guardada (campaign + row). Idempotente por (chat, día de
 * Ciudad de México) para no spamear el CRM cada vez que se abre el mismo chat.
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
  const campaign = await resolveCatalogCampaign(String(conv?.campaign ?? ''));
  if (!campaign) return ok({ reported: false, reason: 'conversación sin campaña' });

  const row = (conv?.contact ?? {}) as Record<string, string>;
  // Teléfono: de la fila o de los dígitos del chatId (5215513023544@c.us).
  const phone = row.phone || row.telefono || chatId.replace(/\D/g, '');
  const phone10 = toPhone10(phone);

  // Idempotencia diaria (día de México): marcador (OPEN#op, chatId#YYYY-MM-DD).
  const now = new Date();
  const day = mxDateParts(now).date;
  return withMarker(`OPEN#${user}`, `${chatId}#${day}`, ttlInDays(2), 'ya registrado hoy', async () => {
    const creditId = await resolveCreditId(row, campaign, phone);
    const inserted = await insertInteraction({
      creditId,
      campaign,
      phone10,
      contactable: true,
      subdictamen: 'Atención WhatsApp',
      comments: `product=${row.product ?? ''}; discount=${row.discount ?? ''}; total_balance=${row.total_balance ?? ''}`,
      at: now,
      inoutbound: 'inbound',
    });
    return { inserted, body: { creditId } };
  });
}

interface ManualPayload {
  chatId?: string;
  subdictamen?: string; // resultado de la gestión
  comments?: string;
  contactable?: boolean; // ¿se logró contacto?
  promiseDate?: string; // YYYY-MM-DD
  promiseAmount?: number;
  requestId?: string; // UUID por apertura del modal (idempotencia opcional)
}

/**
 * Interacción MANUAL que el agente registra desde el chat (botón "Registrar
 * gestión"): resultado, comentarios y promesa de pago opcional. Toma campaña y
 * credit_id de la conversación guardada (o lookup por teléfono). Con
 * `requestId` es idempotente (marcador MANUAL#<op>/<requestId>); sin él (desktops
 * viejos) cada llamada es un registro nuevo, como en v3.
 */
async function reportManual(
  user: string,
  p: ManualPayload,
): Promise<APIGatewayProxyResultV2> {
  if (!p.chatId) return bad('falta chatId');
  if (!p.subdictamen) return bad('falta subdictamen (resultado)');
  if (p.requestId !== undefined && (typeof p.requestId !== 'string' || !REQUEST_ID_RE.test(p.requestId)))
    return bad('requestId inválido');

  const res = await ddb.send(
    new GetCommand({ TableName: CONVERSATIONS_TABLE, Key: { operatorId: user, chatId: p.chatId } }),
  );
  const conv = res.Item;
  const campaign = await resolveCatalogCampaign(String(conv?.campaign ?? ''));
  if (!campaign) return bad('conversación sin campaña; no se puede registrar', 409);

  const row = (conv?.contact ?? {}) as Record<string, string>;
  const phone = row.phone || row.telefono || p.chatId.replace(/\D/g, '');

  const insert = async () => {
    const creditId = await resolveCreditId(row, campaign, phone);
    const inserted = await insertInteraction({
      creditId,
      campaign,
      phone10: toPhone10(phone),
      contactable: p.contactable ?? true,
      subdictamen: p.subdictamen!,
      comments: p.comments ?? '',
      at: new Date(),
      inoutbound: 'inbound',
      promiseDate: p.promiseDate ?? null,
      promiseAmount: p.promiseAmount ?? null,
    });
    return { inserted, body: { creditId } };
  };

  if (!p.requestId) {
    const r = await insert();
    return ok({ reported: r.inserted, ...r.body });
  }
  return withMarker(`MANUAL#${user}`, p.requestId, ttlInDays(2), 'ya reportado', insert);
}
