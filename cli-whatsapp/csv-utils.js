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

    fs.createReadStream(CONFIG.inputCsv)
      .pipe(csvParser({ columns: true, trim: true }))
      .on('data', (row) => {
        const contact = normalizeContact(row);
        
        if (contact.phone) {
          contacts.push(contact);
        }
      })
      .on('end', () => {
        console.log(`✅ ${contacts.length} contactos cargados desde CSV`);
        resolve(contacts);
      })
      .on('error', reject);
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
