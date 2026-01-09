/**
 * Reemplaza variables en el mensaje con datos del contacto
 * @param {string} template - Plantilla del mensaje con variables {{variable}}
 * @param {Object} contact - Objeto con los datos del contacto
 * @returns {string} Mensaje personalizado
 */
export function replaceVariables(template, contact) {
  let message = template;
  
  const replacements = {
    '{{phone}}': contact.phone || '',
    '{{name}}': contact.name || '',
    '{{first_name}}': contact.first_name || '',
    '{{last_name}}': contact.last_name || '',
    '{{credit}}': contact.credit || '',
    '{{discount}}': contact.discount || '',
    '{{total_balance}}': contact.total_balanc || '',
    '{{total_balanc}}': contact.total_balanc || '', // Compatibilidad con versión anterior
    '{{product}}': contact.product || '',
  };

  Object.entries(replacements).forEach(([key, value]) => {
    const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
    message = message.replace(regex, value);
  });

  return message;
}

/**
 * Normaliza los datos de un contacto desde una fila CSV
 * @param {Object} row - Fila del CSV
 * @returns {Object} Contacto normalizado
 */
export function normalizeContact(row) {
  const contact = {
    phone: row.phone_number || row.contact_phone || row.contact_pho || row.phone || row.telefono || '',
    name: row.name || row.nombre || '',
    first_name: row.first_name || row.nombre_pila || '',
    last_name: row.last_name || row.apellido || '',
    credit: row.credit || row.credito || '',
    discount: row.discount || row.descuento || '',
    total_balanc: row.total_balance || row.total_balanc || row.balance || row.saldo || '',
    product: row.product || row.producto || '',
    message: row.message || row.mensaje || '',
  };

  // Construir nombre si no existe
  if (!contact.name && (contact.first_name || contact.last_name)) {
    contact.name = `${contact.first_name} ${contact.last_name}`.trim();
  }
  if (!contact.name) {
    contact.name = contact.phone;
  }

  return contact;
}
