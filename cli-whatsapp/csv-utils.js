import fs from 'fs';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { CONFIG } from './config.js';
import { normalizeContact } from './message-utils.js';

/**
 * Lee contactos desde el archivo CSV configurado
 * @returns {Promise<Array>} Array de contactos normalizados
 */
export async function readContacts() {
  return new Promise((resolve, reject) => {
    const contacts = [];
    
    if (!fs.existsSync(CONFIG.inputCsv)) {
      reject(new Error(`No se encontró el archivo: ${CONFIG.inputCsv}`));
      return;
    }

    // Leer todo el archivo primero para manejar campos multilínea correctamente
    const fileContent = fs.readFileSync(CONFIG.inputCsv, 'utf-8');
    const lines = fileContent.split('\n');
    
    if (lines.length === 0) {
      resolve([]);
      return;
    }
    
    // Obtener headers de la primera línea
    const headers = lines[0].split(',').map(h => h.trim());
    
    // Procesar líneas, manejando campos entre comillas con saltos de línea
    let currentRow = [];
    let inQuotedField = false;
    let currentField = '';
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      
      // Contar comillas para determinar si estamos dentro de un campo
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        if (char === '"') {
          // Comilla doble escapada
          if (line[j + 1] === '"') {
            currentField += '"';
            j++; // Skip next quote
          } else {
            // Toggle quoted field state
            inQuotedField = !inQuotedField;
          }
        } else if (char === ',' && !inQuotedField) {
          // Fin de campo
          currentRow.push(currentField.trim());
          currentField = '';
        } else {
          currentField += char;
        }
      }
      
      // Si no estamos en un campo entre comillas, es fin de registro
      if (!inQuotedField) {
        currentRow.push(currentField.trim());
        currentField = '';
        
        // Crear objeto del registro
        if (currentRow.length === headers.length) {
          const rowObj = {};
          headers.forEach((header, idx) => {
            rowObj[header] = currentRow[idx];
          });
          
          const contact = normalizeContact(rowObj);
          if (contact.phone) {
            contacts.push(contact);
          }
        }
        
        currentRow = [];
      } else {
        // Agregar salto de línea al campo actual
        currentField += '\n';
      }
    }
    
    console.log(`✅ ${contacts.length} contactos cargados desde CSV`);
    resolve(contacts);
  });
}

/**
 * Guarda los resultados del envío en CSV
 * @param {Array} results - Array de resultados
 */
export async function saveResults(results) {
  const csvWriter = createObjectCsvWriter({
    path: CONFIG.outputCsv,
    header: [
      { id: 'phone', title: 'phone' },
      { id: 'name', title: 'name' },
      { id: 'first_name', title: 'first_name' },
      { id: 'last_name', title: 'last_name' },
      { id: 'credit', title: 'credit' },
      { id: 'discount', title: 'discount' },
      { id: 'total_balanc', title: 'total_balanc' },
      { id: 'product', title: 'product' },
      { id: 'status', title: 'status' },
      { id: 'error', title: 'error' },
      { id: 'sent_at', title: 'sent_at' },
      { id: 'response', title: 'response' },
    ],
  });

  await csvWriter.writeRecords(results);
  console.log(`\n💾 Resultados guardados en: ${CONFIG.outputCsv}`);
}

/**
 * Guarda solo las respuestas recibidas en un CSV separado
 * @param {Array} results - Array de resultados
 */
export async function saveResponses(results) {
  const responsesOnly = results.filter(r => r.response && r.response.trim() !== '');
  
  if (responsesOnly.length === 0) {
    console.log('ℹ️  No hay respuestas para guardar');
    return;
  }

  const csvWriter = createObjectCsvWriter({
    path: CONFIG.responsesCsv,
    header: [
      { id: 'phone', title: 'phone' },
      { id: 'name', title: 'name' },
      { id: 'sent_at', title: 'sent_at' },
      { id: 'response', title: 'response' },
    ],
  });

  await csvWriter.writeRecords(responsesOnly);
  console.log(`💬 ${responsesOnly.length} respuestas guardadas en: ${CONFIG.responsesCsv}`);
}
