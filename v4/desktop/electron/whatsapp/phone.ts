// File: Normaliza un teléfono a candidato JID de whatsapp-web.js (`<digits>@c.us`).
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/**
 * Normaliza un teléfono a los dígitos que se consultan en WhatsApp.
 * Quien envía resuelve el JID real con `client.getNumberId()`.
 *
 * MISMAS reglas que v4/backend/src/lib/phone.ts; la coherencia la garantizan
 * los vectores compartidos v4/shared/phone-mx-vectors.json.
 *
 * Lada 52 (México), decidida por LONGITUD, no por prefijo de texto:
 *  - escrito con `+` o `00` y otra lada → número extranjero (11–15 dígitos)
 *  - 10 dígitos → 52 + 10
 *  - 52 + 10 → igual · 521 + 10 → 52 + 10
 *  - 044/045 + 10 → 52 + 10 · 01 + 10 → 52 + 10 · 1 + 10 → 52 + 10
 *  - cualquier otra forma → null (inválido)
 * Otra lada: quita `00`, antepone la lada si falta, acepta 11–15 dígitos.
 */
export function normalizeMx(raw: string): string | null {
  const s = String(raw ?? '');
  const international = /^\s*(\+|00)/.test(s);
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);

  // Escrito como internacional con otra lada → se respeta el extranjero.
  if (international && !d.startsWith('52')) {
    return /^[1-9]\d{10,14}$/.test(d) ? d : null;
  }
  const last10 = d.slice(-10);
  if (d.length === 10) return '52' + d;
  if (d.length === 12 && d.startsWith('52')) return d;
  if (d.length === 13 && d.startsWith('521')) return '52' + last10;
  if (d.length === 13 && (d.startsWith('044') || d.startsWith('045'))) return '52' + last10;
  if (d.length === 12 && d.startsWith('01')) return '52' + last10;
  if (d.length === 11 && d.startsWith('1')) return '52' + last10;
  return null;
}

export function normalizeDigits(raw: string, countryCode = '52'): string | null {
  countryCode = String(countryCode ?? '52').replace(/\D/g, '') || '52';
  if (countryCode === '52') return normalizeMx(raw);
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  // sin lada país → anteponer
  if (!d.startsWith(countryCode)) d = countryCode + d;
  if (!/^\d{11,15}$/.test(d)) return null;
  return d;
}

export const toJid = (digits: string) => `${digits}@c.us`;
