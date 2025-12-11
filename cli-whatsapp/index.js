import { chromium } from 'playwright';
import fs from 'fs';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración
const CONFIG = {
  inputCsv: path.join(__dirname, 'contactos.csv'),
  outputCsv: path.join(__dirname, 'resultados.csv'),
  responsesCsv: path.join(__dirname, 'respuestas.csv'),
  sessionPath: path.join(__dirname, 'whatsapp-session'),
  delayBetweenMessages: 5000, // 5 segundos entre mensajes
  waitForResponse: 10000, // 10 segundos para esperar respuesta
  typingSpeed: 50, // Milisegundos entre cada carácter (más alto = más lento)
};

let browser = null;
let page = null;

// Función para reemplazar variables en el mensaje
function replaceVariables(template, contact) {
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

// Leer CSV de contactos
async function readContacts() {
  return new Promise((resolve, reject) => {
    const contacts = [];
    
    if (!fs.existsSync(CONFIG.inputCsv)) {
      reject(new Error(`No se encontró el archivo: ${CONFIG.inputCsv}`));
      return;
    }

    fs.createReadStream(CONFIG.inputCsv)
      .pipe(csvParser({ columns: true, trim: true }))
      .on('data', (row) => {
        // Normalizar nombres de columnas
        const contact = {
          phone: row.contact_phone || row.contact_pho || row.phone || row.telefono || '',
          name: row.name || row.nombre || '',
          first_name: row.first_name || row.nombre_pila || '',
          last_name: row.last_name || row.apellido || '',
          credit: row.credit || row.credito || '',
          discount: row.discount || row.descuento || '',
          total_balanc: row.total_balance || row.total_balanc || row.balance || row.saldo || '',
          product: row.product || row.producto || '',
        };

        // Construir nombre si no existe
        if (!contact.name && (contact.first_name || contact.last_name)) {
          contact.name = `${contact.first_name} ${contact.last_name}`.trim();
        }
        if (!contact.name) {
          contact.name = contact.phone;
        }

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

// Inicializar WhatsApp
async function initWhatsApp() {
  console.log('🚀 Iniciando WhatsApp Web...');
  
  browser = await chromium.launchPersistentContext(CONFIG.sessionPath, {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    viewport: { width: 1280, height: 720 },
  });

  page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle' });

  console.log('⏳ Esperando a que WhatsApp Web cargue...');
  console.log('📱 Si ves un código QR, escanéalo con tu teléfono');
  
  // Esperar a que aparezca el panel de chats (señal de que está conectado)
  await page.waitForSelector('#side', { timeout: 300000 });
  
  console.log('✅ WhatsApp Web conectado!');
  await page.waitForTimeout(2000);
}

// Enviar mensaje a un contacto
async function sendMessage(contact, messageTemplate) {
  try {
    const cleanPhone = contact.phone.replace(/\D/g, '');
    const personalizedMessage = replaceVariables(messageTemplate, contact);
    
    console.log(`\n📤 Enviando a ${contact.name} (${contact.phone})...`);
    
    // Abrir chat
    const chatUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
    await page.goto(chatUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Verificar si el número es válido usando el modal de error (sin WhatsApp)
    const invalidNumberTextSelector = 'text="El número de teléfono compartido a través de la dirección URL no es válido."';
    let invalidNumber = null;
    try {
      // Esperar unos segundos por el modal de número inválido (buscando por texto en todo el DOM)
      invalidNumber = await page.waitForSelector(invalidNumberTextSelector, { timeout: 8000 });
    } catch (_) {
      // Si no aparece el texto en ese tiempo, asumimos que el número sí tiene WhatsApp y seguimos
      invalidNumber = null;
    }

    if (invalidNumber) {
      console.log(`❌ Número inválido (no tiene WhatsApp): ${contact.phone}`);
      return {
        ...contact,
        status: 'no_whatsapp',
        error: 'No tiene WhatsApp',
        sent_at: new Date().toISOString(),
        response: '',
      };
    }

    // Buscar el campo de mensaje del chat (no el buscador), usando el placeholder "Escribe un mensaje"
    const messageBoxSelector = 'div[contenteditable="true"][data-tab][aria-placeholder="Escribe un mensaje"]';
    try {
      await page.waitForSelector(messageBoxSelector, { timeout: 30000 });
    } catch (e) {
      // Antes de marcar error genérico, revisamos si apareció el texto de número inválido
      const maybeInvalid = await page.$(invalidNumberTextSelector);
      if (maybeInvalid) {
        console.log(`❌ Número inválido (no tiene WhatsApp) detectado tarde: ${contact.phone}`);
        return {
          ...contact,
          status: 'no_whatsapp',
          error: 'No tiene WhatsApp',
          sent_at: new Date().toISOString(),
          response: '',
        };
      }

      // Si no hay modal, es un error real de UI
      console.log(`❌ No se encontró el cuadro de mensaje para ${contact.phone}: ${e.message}`);
      return {
        ...contact,
        status: 'error',
        error: 'No se encontró el cuadro de mensaje en WhatsApp',
        sent_at: new Date().toISOString(),
        response: '',
      };
    }

    // Hacer clic en el campo para enfocarlo
    try {
      await page.click(messageBoxSelector);
    } catch (e) {
      // Si al hacer clic el popup de número inválido intercepta el click, lo tratamos como no_whatsapp
      const maybeInvalid = await page.$(invalidNumberTextSelector);
      if (maybeInvalid) {
        console.log(`❌ Número inválido (no tiene WhatsApp) al intentar enfocar el cuadro: ${contact.phone}`);
        return {
          ...contact,
          status: 'no_whatsapp',
          error: 'No tiene WhatsApp',
          sent_at: new Date().toISOString(),
          response: '',
        };
      }

      // Otro tipo de error de click
      console.log(`❌ Error al hacer clic en el cuadro de mensaje para ${contact.phone}: ${e.message}`);
      return {
        ...contact,
        status: 'error',
        error: 'No se pudo enfocar el cuadro de mensaje en WhatsApp',
        sent_at: new Date().toISOString(),
        response: '',
      };
    }
    await page.waitForTimeout(1000);

    // Escribir mensaje línea por línea con saltos de línea (más lento)
    const lines = personalizedMessage.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Escribir cada carácter con delay configurable usando insertText
      for (const char of line) {
        await page.keyboard.insertText(char);
        await page.waitForTimeout(CONFIG.typingSpeed);
      }
      
      // Si no es la última línea, agregar salto de línea con Shift+Enter
      if (i < lines.length - 1) {
        await page.waitForTimeout(300);
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await page.waitForTimeout(500);
      }
    }
    
    await page.waitForTimeout(1000);

    // Enviar con Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    console.log(`✅ Mensaje enviado a ${contact.name}`);

    // Esperar posible respuesta
    console.log(`⏳ Esperando respuesta (${CONFIG.waitForResponse / 1000}s)...`);
    await page.waitForTimeout(CONFIG.waitForResponse);

    // Intentar capturar última respuesta
    let response = '';
    try {
      // Esperar un poco más para que llegue la respuesta
      await page.waitForTimeout(2000);
      
      // Buscar todos los mensajes en el chat
      const allMessages = await page.$$('div.message-in, div.message-out');
      
      if (allMessages.length > 0) {
        // Recorrer desde el final para encontrar el último mensaje entrante (no enviado por nosotros)
        for (let i = allMessages.length - 1; i >= 0; i--) {
          const msg = allMessages[i];
          
          // Verificar si es mensaje entrante (tiene clase message-in)
          const className = await msg.evaluate(el => el.className);
          
          if (className.includes('message-in')) {
            // Buscar el texto del mensaje
            const textElement = await msg.$('span.selectable-text');
            if (textElement) {
              response = await textElement.evaluate(el => el.textContent);
              if (response && response.trim()) {
                console.log(`💬 Respuesta recibida: "${response.trim()}"`);
                break;
              }
            }
          }
        }
      }
      
      // Si no encontró con el método anterior, intentar método alternativo
      if (!response) {
        const incomingBubbles = await page.$$('div[data-pre-plain-text]');
        if (incomingBubbles.length > 0) {
          const lastBubble = incomingBubbles[incomingBubbles.length - 1];
          const textSpan = await lastBubble.$('span.selectable-text.copyable-text');
          if (textSpan) {
            response = await textSpan.evaluate(el => el.textContent);
            if (response && response.trim()) {
              console.log(`💬 Respuesta recibida (método 2): "${response.trim()}"`);
            }
          }
        }
      }
      
      if (!response || !response.trim()) {
        console.log('ℹ️  No se detectó respuesta');
      }
    } catch (error) {
      console.log('ℹ️  No se detectó respuesta:', error.message);
    }

    return {
      ...contact,
      status: 'sent',
      error: '',
      sent_at: new Date().toISOString(),
      response: response,
      message_sent: personalizedMessage,
    };

  } catch (error) {
    console.log(`❌ Error al enviar a ${contact.name}: ${error.message}`);
    return {
      ...contact,
      status: 'error',
      error: error.message,
      sent_at: new Date().toISOString(),
      response: '',
    };
  }
}

// Guardar resultados en CSV
async function saveResults(results) {
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

// Guardar solo respuestas en CSV separado
async function saveResponses(results) {
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

// Función principal
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   WhatsApp CLI Mass Sender v1.0       ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Leer plantilla de mensaje
    const templatePath = path.join(__dirname, 'mensaje.txt');
    if (!fs.existsSync(templatePath)) {
      console.error('❌ No se encontró el archivo mensaje.txt');
      console.log('📝 Crea un archivo "mensaje.txt" con tu plantilla de mensaje');
      process.exit(1);
    }

    const messageTemplate = fs.readFileSync(templatePath, 'utf-8');
    console.log('📝 Plantilla de mensaje cargada:');
    console.log('─────────────────────────────────────');
    console.log(messageTemplate);
    console.log('─────────────────────────────────────\n');

    // Leer contactos
    const contacts = await readContacts();
    
    if (contacts.length === 0) {
      console.error('❌ No hay contactos para procesar');
      process.exit(1);
    }

    console.log(`📊 Total de contactos: ${contacts.length}\n`);

    // Inicializar WhatsApp
    await initWhatsApp();

    // Enviar mensajes
    const results = [];
    
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      console.log(`\n[${i + 1}/${contacts.length}] Procesando: ${contact.name}`);
      
      const result = await sendMessage(contact, messageTemplate);
      results.push(result);

      // Esperar entre mensajes (excepto el último)
      if (i < contacts.length - 1) {
        console.log(`⏳ Esperando ${CONFIG.delayBetweenMessages / 1000}s antes del siguiente mensaje...`);
        await page.waitForTimeout(CONFIG.delayBetweenMessages);
      }
    }

    // Guardar resultados
    await saveResults(results);
    await saveResponses(results);

    // Resumen
    const sent = results.filter(r => r.status === 'sent').length;
    const errors = results.filter(r => r.status === 'error').length;
    const withResponse = results.filter(r => r.response && r.response.trim() !== '').length;

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║           RESUMEN FINAL                ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`✅ Enviados exitosamente: ${sent}`);
    console.log(`❌ Errores: ${errors}`);
    console.log(`💬 Respuestas recibidas: ${withResponse}`);
    console.log(`📊 Total procesados: ${results.length}`);
    console.log('\n✨ Proceso completado!\n');

  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      console.log('🔒 Cerrando navegador...');
      await browser.close();
    }
  }
}

// Ejecutar
main().catch(console.error);
