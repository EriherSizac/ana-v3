// File: Normalización de teléfonos (mismas reglas que el desktop).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/**
 * MISMAS reglas que v4/desktop/electron/whatsapp/phone.ts (no hay paquete
 * compartido en v4/); la coherencia la garantizan los vectores compartidos
 * v4/shared/phone-mx-vectors.json, probados en ambos paquetes.
 *
 * Lada 52 (México), decidida por LONGITUD, no por prefijo de texto:
 *  - escrito con `+` o `00` y otra lada → número extranjero (11–15 dígitos)
 *  - 10 dígitos → 52 + 10
 *  - 52 + 10 → igual · 521 + 10 → 52 + 10
 *  - 044/045 + 10 → 52 + 10 · 01 + 10 → 52 + 10 · 1 + 10 → 52 + 10
 *  - cualquier otra forma → null (inválido)
 */
export function normalizeMx(raw: string): string | null {
  const s = String(raw ?? '');
  const international = /^\s*(\+|00)/.test(s);
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);

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

/** Igual que el desktop: lada 52 → normalizeMx; otra lada → regla genérica. */
export function normalizeDigits(raw: string, countryCode = '52'): string | null {
  const cc = String(countryCode ?? '52').replace(/\D/g, '') || '52';
  if (cc === '52') return normalizeMx(raw);
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (!d.startsWith(cc)) d = cc + d;
  return /^\d{11,15}$/.test(d) ? d : null;
}
