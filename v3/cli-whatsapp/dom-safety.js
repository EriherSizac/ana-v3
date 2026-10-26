/**
 * Utilidades de renderizado seguro para las páginas de WhatsApp Web (módulo puro).
 *
 * REGLA: todo dato externo (backend ANA, CRM, DOM de WhatsApp) que se muestre en la
 * página se asigna con `textContent`/`dataset`; si se conserva una plantilla con
 * `innerHTML`, cada valor variable MUST pasar por `escapeHtml`.
 *
 * Las funciones son autocontenidas (sin referencias externas) porque se inyectan en la
 * página por su código fuente (`toString()`) con `domSafetyInitScript()`.
 */

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '"') return '&quot;';
    return '&#39;';
  });
}

export function digitsOnly(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\D/g, '');
}

// Últimos 10 dígitos para https://web.whatsapp.com/send?phone=52{10}; '' si hay menos de 10
export function phone10ForWhatsappUrl(value) {
  const digits = value === null || value === undefined ? '' : String(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Código para `page.addInitScript({ content })` que define `window.__anaDomSafety`.
 * @returns {string}
 */
export function domSafetyInitScript() {
  return `window.__anaDomSafety = Object.freeze({
  escapeHtml: (${escapeHtml.toString()}),
  digitsOnly: (${digitsOnly.toString()}),
  phone10ForWhatsappUrl: (${phone10ForWhatsappUrl.toString()}),
});`;
}
