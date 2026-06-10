// File: Normaliza un teléfono a candidato JID de whatsapp-web.js (`<digits>@c.us`).
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

/**
 * Normaliza un teléfono a candidato JID de whatsapp-web.js (`<digits>@c.us`).
 *
 * Devuelve solo los dígitos canónicos; quien envía debe resolver el JID real
 * con `client.getNumberId()` (WhatsApp decide si lleva el `1` de MX o no).
 *
 * Reglas:
 *  - quita todo lo no-dígito, prefijos `00` y `+`
 *  - México: 52 + 1 (legacy móvil) → se normaliza a 52 + 10 dígitos.
 *    WhatsApp ya no usa el `1`; getNumberId reconcilia.
 *  - si no trae lada país, la antepone (countryCode).
 */
export function normalizeDigits(raw: string, countryCode = '52'): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;

  if (d.startsWith('00')) d = d.slice(2);

  // MX legacy: 521XXXXXXXXXX (13) → quita el 1 → 52XXXXXXXXXX (12)
  if (d.startsWith('521') && d.length === 13) d = '52' + d.slice(3);

  // sin lada país → anteponer
  if (!d.startsWith(countryCode)) d = countryCode + d;

  if (!/^\d{11,15}$/.test(d)) return null;
  return d;
}

export const toJid = (digits: string) => `${digits}@c.us`;
