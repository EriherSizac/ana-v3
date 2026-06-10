/**
 * Reemplaza variables en el mensaje con datos del contacto
 * @param {string} template - Plantilla del mensaje con variables {{variable}}
 * @param {Object} contact - Objeto con los datos del contacto
 * @returns {string} Mensaje personalizado
 */
export function replaceVariables(template, contact) {
  let message = template;
  
  // Primero, mapear las variables estándar (para compatibilidad)
  const standardReplacements = {
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

  Object.entries(standardReplacements).forEach(([key, value]) => {
    const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
    message = message.replace(regex, value);
  });

  // Luego, reemplazar CUALQUIER otra variable que venga del CSV original
  // Buscar todas las variables {{algo}} en el mensaje (puede incluir expresiones matemáticas)
  const variablePattern = /\{\{([^}]+)\}\}/g;
  message = message.replace(variablePattern, (match, varExpr) => {
    const trimmed = varExpr.trim();

    // Detectar si es una expresión matemática: contiene operadores o funciones
    const hasMathOp = /[+\-*\/()^%]/.test(trimmed);

    if (hasMathOp) {
      // Reemplazar nombres de columnas por sus valores numéricos
      let expr = trimmed.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (colName) => {
        if (contact.hasOwnProperty(colName)) {
          const val = parseFloat(String(contact[colName]).replace(/,/g, '.'));
          if (!isNaN(val)) return val;
        }
        return colName;
      });

      try {
        // Evaluar solo expresiones numéricas seguras
        if (/^[0-9+\-*\/().\s%]+$/.test(expr)) {
          // eslint-disable-next-line no-new-func
          const result = Function('"use strict"; return (' + expr + ')')();
          if (typeof result === 'number' && isFinite(result)) {
            // Redondear a 2 decimales si tiene parte decimal
            return Number.isInteger(result) ? String(result) : result.toFixed(2);
          }
        }
      } catch (_) {
        // Si falla la evaluación, continuar al fallback
      }
    }

    // Variable simple: si existe en el contacto, usarla
    if (contact.hasOwnProperty(trimmed)) {
      return contact[trimmed] || '';
    }

    // Si no existe, dejar la variable sin reemplazar
    return match;
  });

  // Convertir \n literales a saltos de línea reales
  message = message.replace(/\\n/g, '\n');

  return message;
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
