// File: Cliente del API de interactions del CRM (registro de envíos de campaña).
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Mismo API que usaba v3-cli, pero la key vive aquí (env del Lambda, backend/.env)
// y nunca en el desktop. Gotcha heredado de v3: el CRM a veces guarda teléfonos
// sin el prefijo +52 → todo lookup/insert con 404 reintenta sin el prefijo.
const BASE = process.env.INTERACTIONS_API_BASE!;
const KEY = process.env.INTERACTIONS_API_KEY!;
// user_id del CRM con el que se registran interacciones (mapa por operador: pendiente).
export const CRM_USER_ID = process.env.INTERACTIONS_USER_ID ?? '';

const headers = { 'content-type': 'application/json', 'X-Api-Key': KEY };

/** +52XXXXXXXXXX a partir de un crudo MX (10/12/13 dígitos). */
export function toE164Mx(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+52${digits}`;
  if (digits.startsWith('521') && digits.length === 13) return `+52${digits.slice(3)}`;
  if (digits.startsWith('52') && digits.length === 12) return `+${digits}`;
  return `+${digits}`;
}

/** Últimos 10 dígitos (formato que el CRM usa en phone_number). */
export function toPhone10(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** credit_id del cliente por teléfono, o '' si no se encuentra. */
export async function searchCreditIdByPhone(
  campaign: string,
  phoneE164: string,
): Promise<string> {
  const post = async (searchValue: string) =>
    fetch(`${BASE}/client-info`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        campaign_name: campaign,
        search_type: 'Telefono',
        search_value: searchValue,
      }),
    });

  try {
    let res = await post(phoneE164);
    if (res.status === 404 && phoneE164.startsWith('+52')) res = await post(phoneE164.slice(3));
    if (!res.ok) return '';
    const data = (await res.json().catch(() => ({}))) as { result?: any[] };
    const result = Array.isArray(data.result) ? data.result : [];
    return String(result[0]?.credit_info?.credit_id ?? '');
  } catch (e) {
    console.error('[interactions] client-info falló', e);
    return '';
  }
}

export interface InteractionInput {
  creditId: string;
  campaign: string;
  phone10: string;
  contactable: boolean; // true = mensaje enviado
  subdictamen: string; // "Se envía WhatsApp" | "No tiene Whatsapp" | "Atención WhatsApp"
  comments: string;
  at: Date;
  inoutbound?: 'inbound' | 'outbound'; // default outbound (envío de campaña)
  promiseDate?: string | null; // YYYY-MM-DD (promesa de pago)
  promiseAmount?: number | null;
}

/** Inserta la interacción outbound en el CRM (shape idéntico al de v3-cli). */
export async function insertInteraction(i: InteractionInput): Promise<boolean> {
  const hh = String(i.at.getHours()).padStart(2, '0');
  const mm = String(i.at.getMinutes()).padStart(2, '0');
  const nextH = String((i.at.getHours() + 1) % 24).padStart(2, '0');
  const interaction = {
    credit_id: i.creditId,
    campaign_name: i.campaign,
    user_id: CRM_USER_ID,
    subdictamen: i.subdictamen,
    contact_date: i.at.toISOString().slice(0, 10),
    contact_time: `${hh}:${mm}`,
    range_time: `${hh}:00 - ${nextH}:00`,
    action_channel: 'whatsapp',
    action: 'whatsapp',
    contactable: i.contactable,
    phone_number: i.phone10,
    email_address: null,
    template_used: null,
    comments: i.comments,
    promise_date: i.promiseDate ?? null,
    promise_amount: i.promiseAmount ?? null,
    promise_payment_plan: null,
    inoutbound: i.inoutbound ?? 'outbound',
    payment_made_date: null,
  };

  try {
    const res = await fetch(`${BASE}/interactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ interactions: [interaction] }),
    });
    if (!res.ok) {
      console.error('[interactions] insert falló', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[interactions] insert error red', e);
    return false;
  }
}

/** Marca el teléfono como sin WhatsApp en el CRM (PATCH /phone, como v3). */
export async function markPhoneNoWhatsapp(
  creditId: string,
  campaign: string,
  phone10: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/phone`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        credit_id: creditId,
        campaign_name: campaign,
        current_phone: phone10,
        phone: { has_whatsapp: false, whatsapp_contactable: false },
      }),
    });
    if (!res.ok) {
      console.error('[interactions] PATCH /phone falló', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[interactions] PATCH /phone error red', e);
    return false;
  }
}
