import { renderTemplate } from './template-utils.js';

/**
 * Reemplaza variables en el mensaje con datos del contacto.
 * Envoltorio de compatibilidad sobre renderTemplate (una sola pasada); el flujo
 * automático ya renderiza el mensaje en parseAssignmentCsv.
 * @param {string} template - Plantilla del mensaje con variables {{variable}} o {variable}
 * @param {Object} contact - Objeto con los datos del contacto
 * @returns {string} Mensaje personalizado
 */
export function replaceVariables(template, contact) {
  return renderTemplate(template, { fields: contact || {}, raw: contact || {} });
}

/**
 * Normaliza los datos de un contacto desde una fila CSV
 * @param {Object} row - Fila del CSV
 * @returns {Object} Contacto normalizado
 */
export function normalizeContact(row) {
  // Primero, copiar TODAS las columnas del CSV al objeto contact
  const contact = { ...row };
  
  // Luego, mapear las columnas estándar con alias (para compatibilidad)
  contact.phone = row.phone_number || row.contact_phone || row.contact_pho || row.phone || row.telefono || '';
  contact.name = row.name || row.nombre || '';
  contact.first_name = row.first_name || row.nombre_pila || '';
  contact.last_name = row.last_name || row.apellido || '';
  contact.credit = row.credit || row.credito || '';
  contact.discount = row.discount || row.descuento || '';
  contact.total_balanc = row.total_balance || row.total_balanc || row.balance || row.saldo || '';
  contact.product = row.product || row.producto || '';
  contact.message = row.message || row.mensaje || '';

  // Construir nombre si no existe
  if (!contact.name && (contact.first_name || contact.last_name)) {
    contact.name = `${contact.first_name} ${contact.last_name}`.trim();
  }
  if (!contact.name) {
    contact.name = contact.phone;
  }

  return contact;
}
