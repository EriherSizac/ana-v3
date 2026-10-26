/**
 * Normalización de teléfonos del CLI (módulo puro).
 *
 * `createPhoneUtils` MUST ser autocontenida (sin referencias a variables externas ni
 * imports): su código fuente se inyecta en las páginas de WhatsApp Web con
 * `page.addInitScript({ content: phoneUtilsInitScript() })` y queda en `window.__anaPhone`.
 */
export function createPhoneUtils() {
  const digitsOf = (raw) => String(raw === undefined || raw === null ? '' : raw).replace(/\D/g, '');

  // Solo longitudes exactas: 10 (nacional), 12 (52 + 10) o 13 (521 + 10)
  const parseMxPhone = (raw) => {
    const digits = digitsOf(raw);
    let national10 = null;
    if (digits.length === 10) national10 = digits;
    else if (digits.length === 12 && digits.startsWith('52')) national10 = digits.slice(2);
    else if (digits.length === 13 && digits.startsWith('521')) national10 = digits.slice(3);
    return { digits, national10 };
  };

  // URL de chat de WhatsApp Web: 52 + 10 dígitos; no MX: dígitos tal cual
  const toWhatsAppUrlPhone = (raw) => {
    const { digits, national10 } = parseMxPhone(raw);
    if (national10) return '52' + national10;
    return digits;
  };

  // Búsqueda en el CRM (/client-info) del flujo automático y el monitor: +52 + 10; no MX: + dígitos
  const toCrmSearchPhone = (raw) => {
    const { digits, national10 } = parseMxPhone(raw);
    if (!digits) return '';
    if (national10) return '+52' + national10;
    return '+' + digits;
  };

  // Gestión manual → CRM: +52 + 10; no MX: vacío
  const toGestionCrmPhone = (raw) => {
    const { national10 } = parseMxPhone(raw);
    return national10 ? '+52' + national10 : '';
  };

  // Últimos 10 dígitos (o los dígitos si son menos)
  const toLast10 = (raw) => {
    const digits = digitsOf(raw);
    return digits.length > 10 ? digits.slice(-10) : digits;
  };

  // Llave de respaldo de chats: 521 + 10; no MX: dígitos tal cual (contrato estable)
  const toBackupKeyPhone = (raw) => {
    const { digits, national10 } = parseMxPhone(raw);
    // Llave heredada: 12 dígitos que ya empiezan con 521 se conservan tal cual
    if (digits.length === 12 && digits.startsWith('521')) return digits;
    if (national10) return '521' + national10;
    return digits;
  };

  return {
    parseMxPhone,
    toWhatsAppUrlPhone,
    toCrmSearchPhone,
    toGestionCrmPhone,
    toLast10,
    toBackupKeyPhone,
  };
}

export const phone = createPhoneUtils();

/**
 * Script para `page.addInitScript({ content })` que define `window.__anaPhone`.
 * @returns {string}
 */
export function phoneUtilsInitScript() {
  return `window.__anaPhone = (${createPhoneUtils.toString()})();`;
}
