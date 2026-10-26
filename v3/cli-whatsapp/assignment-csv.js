import { renderTemplate } from './template-utils.js';

/**
 * Parseo del CSV de asignación de `/get/chats` (módulo puro, sin efectos al importarse).
 */

// Mapeo de nombres de columnas del servidor a nombres esperados por el cliente
const FIELD_MAPPING = {
  'phone_number': 'phone',
  'contact_phone': 'phone',
  'contact_pho': 'phone',
  'phone': 'phone',
  'contact_name': 'name',
  'first_name': 'first_name',
  'last_name': 'last_name',
  'name': 'name',
  'message': 'message',
  'credit': 'credit',
  'credito': 'credit',
  'credit_id': 'credit',
  'id_credito': 'credit',
  'discount': 'discount',
  'total_balance': 'total_balance',
  'product': 'product',
};

// Separar el CSV en filas lógicas respetando campos con comillas que contienen saltos de línea
function splitCSVRows(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // Fin de fila lógica (fuera de comillas)
      if (char === '\r' && text[i + 1] === '\n') i++; // Saltar \r\n
      if (current.trim()) rows.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) rows.push(current);
  return rows;
}

// Parsear una línea CSV respetando comillas dobles
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Comilla doble escapada ""
        current += '"';
        i++; // Saltar la siguiente comilla
      } else {
        // Toggle estado de comillas
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Coma fuera de comillas = separador de campo
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Agregar el último campo
  values.push(current.trim());

  return values;
}

/**
 * Parsea el CSV de asignación a un array de contactos (maneja comillas dobles, comas y
 * saltos de línea dentro de comillas). El campo `message` de cada contacto queda ya
 * renderizado (una sola pasada, ver template-utils.js).
 * @param {string} csvText - Texto CSV
 * @returns {Array<Object>} Contactos
 */
export function parseAssignmentCsv(csvText) {
  const lines = splitCSVRows(String(csvText || '').trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const contacts = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length >= headers.length) {
      const contact = {};
      // Guardar todos los valores por nombre original de columna CSV
      const rawValues = {};
      headers.forEach((header, idx) => {
        const value = values[idx] || '';
        rawValues[header] = value;
        // Usar el nombre mapeado si existe, sino usar el original
        const fieldName = FIELD_MAPPING[header] || header;
        contact[fieldName] = value;
      });

      // Renderizar el mensaje con los campos mapeados y las columnas originales
      if (contact.message) {
        contact.message = renderTemplate(contact.message, { fields: contact, raw: rawValues });
      }

      contacts.push(contact);
    }
  }

  return contacts;
}
