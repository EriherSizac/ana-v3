import fs from 'fs';
import path from 'path';
import readline from 'readline';

const resolveAppDataDir = () => {
  if (process.env.ANA_DATA_DIR) return process.env.ANA_DATA_DIR;
  const appData = process.env.APPDATA;
  if (appData) return path.join(appData, 'ANA');
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return path.join(localAppData, 'ANA');
  return process.cwd();
};

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // ignore
  }
};

const writeCrashLog = (title, err) => {
  try {
    const dir = resolveAppDataDir();
    ensureDir(dir);
    const logFile = path.join(dir, 'ana-crash.log');
    const msg = String(err?.stack || err?.message || err);
    const line = `\n[${new Date().toISOString()}] ${title}\n${msg}\n`;
    fs.appendFileSync(logFile, line, 'utf-8');
  } catch (e) {
    // ignore
  }
};

const isPkg = typeof process.pkg !== 'undefined';

process.on('uncaughtException', async (err) => {
  writeCrashLog('uncaughtException', err);
  console.error('❌ Error fatal (uncaughtException):', err?.message || err);
  if (isPkg) {
    try {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Presiona ENTER para salir...', () => {
        rl.close();
        process.exit(1);
      });
      return;
    } catch (e) {
      // ignore
    }
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  writeCrashLog('unhandledRejection', reason);
  console.error('❌ Error fatal (unhandledRejection):', reason?.message || reason);
  if (isPkg) {
    try {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Presiona ENTER para salir...', () => {
        rl.close();
        process.exit(1);
      });
      return;
    } catch (e) {
      // ignore
    }
  }
  process.exit(1);
});

if (isPkg) {
  const exeDir = path.dirname(process.execPath);
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(exeDir, 'browsers');

  const appData = process.env.APPDATA;
  if (appData) {
    const dataDir = path.join(appData, 'ANA');
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
      // ignore
    }
    process.env.ANA_DATA_DIR = dataDir;
  }
}

function waitForEnterIfPkg(message) {
  if (!isPkg) return Promise.resolve();
  return new Promise((resolve) => {
    if (message) console.log(message);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Presiona ENTER para salir...', () => {
      rl.close();
      resolve();
    });
  });
}

import { CONFIG } from './config.js';
import { saveResults, saveResponses } from './csv-utils.js';
import { initWhatsApp, sendMessage, closeBrowser, getPage } from './whatsapp.js';
import { initManualWhatsApp, closeManualBrowser } from './whatsapp-manual.js';
import { sendBackup, hasAgentConfig, fetchAssignedChats, updatePendingContacts, loadAgentConfig, insertInteractions } from './agent-config.js';

// Función principal
async function main() {
  // Cierre ordenado (Ctrl+C)
  let shuttingDown = false;
  process.once('SIGINT', async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n🛑 Cerrando por Ctrl+C...');
    try {
      await closeBrowser();
    } catch (e) {
      // Ignorar
    }
    try {
      await closeManualBrowser();
    } catch (e) {
      // Ignorar
    }
    process.exit(0);
  });

  console.log('╔════════════════════════════════════════╗');
  console.log('║   WhatsApp CLI Mass Sender v2.0       ║');
  console.log('║      Sistema de Dos Ventanas          ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Solo backend: requiere credenciales y asignaciones del servidor
    let credentialsExist = hasAgentConfig();
    if (!credentialsExist) {
      console.log('⚠️  No hay credenciales configuradas.');
      console.log('   Se abrirá la ventana para configurar credenciales (backend).\n');

      await initWhatsApp();
      credentialsExist = hasAgentConfig();
      if (!credentialsExist) {
        console.log('⚠️  No se detectó configuración de agente todavía.');
        await waitForEnterIfPkg('\nConfigura credenciales y vuelve a ejecutar.');
        return;
      }
    }

    console.log('📡 Obteniendo contactos del servidor...');
    const contacts = (await fetchAssignedChats()) || [];
    if (contacts.length === 0) {
      console.log('ℹ️  No hay contactos asignados en el servidor.\n');
      await waitForEnterIfPkg();
      return;
    }
    
    // Decidir qué ventanas abrir
    const hasContacts = contacts.length > 0;
    const shouldOpenManual = CONFIG.enableManualWindow;

    const agentConfig = loadAgentConfig();
    const rawCampaign = agentConfig?.campaign || '';
    const campaignName = rawCampaign.includes('-') ? rawCampaign.split('-').slice(1).join('-') : rawCampaign;
    const INTERACTIONS_USER_ID = '6898b89b-ab72-4196-92b1-70d51781f68f';
    
    console.log(`📊 Contactos para automatización: ${contacts.length}`);
    console.log(`🔓 Ventana manual: ${shouldOpenManual ? 'ACTIVADA' : 'DESACTIVADA'}`);
    console.log(`🔐 Credenciales: ${credentialsExist ? 'CONFIGURADAS' : 'PENDIENTES'}\n`);
    
    // La ventana manual solo se abre si ya hay credenciales configuradas
    // Si no hay credenciales, primero se debe abrir la ventana de automatización para configurarlas
    let manualWindowPromise = null;
    let manualWindowStarted = false;
    
    // Si hay contactos, abrir ventana de automatización
    if (hasContacts) {

      // Activar modo media por portapapeles si se pasa el flag en la línea de comandos
      if (process.argv.includes('--clipboard-media')) {
        CONFIG.useClipboardMedia = true;
        console.log('📎 Modo media por portapapeles ACTIVADO');
        console.log('   Asegúrate de tener una imagen/video copiado antes de cada envío.');
        console.log('─────────────────────────────────────\n');
      }

      // Inicializar WhatsApp para automatización (esto mostrará login si no hay credenciales)
      await initWhatsApp();
      
      // Después de initWhatsApp, las credenciales ya están configuradas
      // Ahora podemos abrir la ventana manual si está habilitada
      if (shouldOpenManual && !manualWindowStarted) {
        console.log('\n═══════════════════════════════════════');
        console.log('🔓 Iniciando ventana manual...');
        console.log('═══════════════════════════════════════\n');
        
        manualWindowStarted = true;
        manualWindowPromise = initManualWhatsApp(contacts)
          .then(() => {
            console.log('\n💬 Ventana manual lista para responder');
            console.log('⚠️  Esta ventana permanecerá abierta\n');
          })
          .catch((error) => {
            console.error('❌ Error al iniciar ventana manual:', error.message);
            console.error('Stack:', error.stack);
          });
      }

      // Enviar mensajes con límite de 45
      const MESSAGE_LIMIT = 45;
      const PAUSE_DURATION = 2 * 60 * 60 * 1000; // 2 horas en milisegundos
      const results = [];
      const page = getPage();
      
      let messagesSent = 0;
      let currentBatch = 0;
      
      while (messagesSent < contacts.length) {
        const remainingContacts = contacts.slice(messagesSent);
        const batchSize = Math.min(MESSAGE_LIMIT, remainingContacts.length);
        const batchContacts = remainingContacts.slice(0, batchSize);
        
        currentBatch++;
        console.log(`\n╔════════════════════════════════════════╗`);
        console.log(`║     LOTE ${currentBatch}: ${batchSize} mensajes          ║`);
        console.log(`╚════════════════════════════════════════╝\n`);
        
        // Enviar mensajes del lote actual
        for (let i = 0; i < batchContacts.length; i++) {
          const contact = batchContacts[i];
          const globalIndex = messagesSent + i + 1;
          console.log(`\n[${globalIndex}/${contacts.length}] Procesando: ${contact.name}`);
          
          const result = await sendMessage(contact, contact.message);
          results.push(result);

          try {
            const now = new Date();
            const contact_date = now.toISOString().slice(0, 10);
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const nextH = String((now.getHours() + 1) % 24).padStart(2, '0');
            const phoneDigits = String(contact.phone || '').replace(/\D/g, '');
            const phone10 = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits;
            // TODO: Generar bien la interaccion 
            const subdictamen = result?.status === 'no_whatsapp' ? 'No tiene Whatsapp' : 'Se envía WhatsApp';

            const interactionRes = await insertInteractions([
              {
                credit_id: String(contact.credit || ''),
                campaign_name: String(campaignName || ''),
                user_id: INTERACTIONS_USER_ID,
                subdictamen,
                contact_date,
                contact_time: `${hh}:${mm}`,
                range_time: `${hh}:00 - ${nextH}:00`,
                action_channel: 'whatsapp',
                action: 'whatsapp',
                contactable: result?.status === 'sent',
                phone_number: phone10,
                email_address: null,
                template_used: null,
                comments: `product=${contact.product || ''}; discount=${contact.discount || ''}; total_balance=${contact.total_balance || ''}`,
                promise_date: null,
                promise_amount: null,
                promise_payment_plan: null,
                inoutbound: 'outbound',
                payment_made_date: null,
              },
            ]);

            if (interactionRes?.ok) {
              console.log(`✅ Interacción enviada (${contact.phone}) subdictamen='${subdictamen}'`);
            } else {
              console.error(`❌ Interacción NO enviada (${contact.phone}) subdictamen='${subdictamen}'`);
              if (interactionRes?.status) console.error(`   Status: ${interactionRes.status}`);
              if (interactionRes?.body) console.error(`   Body: ${JSON.stringify(interactionRes.body)}`);
              if (interactionRes?.error) console.error(`   Error: ${interactionRes.error}`);
            }
          } catch (e) {
            console.error('⚠️  No se pudo registrar la interacción:', e.message);
          }

          // Esperar entre mensajes (excepto el último del lote)
          if (i < batchContacts.length - 1) {
            console.log(`⏳ Esperando ${CONFIG.delayBetweenMessages / 1000}s antes del siguiente mensaje...`);
            await page.waitForTimeout(CONFIG.delayBetweenMessages);
          }
        }
        
        messagesSent += batchSize;
        
        // Si quedan más contactos, actualizar el CSV y pausar
        if (messagesSent < contacts.length) {
          const pendingContacts = contacts.slice(messagesSent);
          
          console.log(`\n╔════════════════════════════════════════╗`);
          console.log(`║   LÍMITE ALCANZADO: ${MESSAGE_LIMIT} mensajes     ║`);
          console.log(`╚════════════════════════════════════════╝`);
          console.log(`📊 Mensajes enviados: ${messagesSent}`);
          console.log(`📋 Contactos restantes: ${pendingContacts.length}`);
          console.log(`\n☁️  Actualizando contactos pendientes en el servidor...`);
          
          // Actualizar contactos pendientes en el servidor
          const updated = await updatePendingContacts(pendingContacts);
          
          if (updated) {
            console.log(`✅ Contactos pendientes guardados correctamente`);
            
            // Calcular tiempo de pausa
            const pauseHours = PAUSE_DURATION / (60 * 60 * 1000);
            const resumeTime = new Date(Date.now() + PAUSE_DURATION);
            
            console.log(`\n╔════════════════════════════════════════╗`);
            console.log(`║        PAUSA DE ${pauseHours} HORAS           ║`);
            console.log(`╚════════════════════════════════════════╝`);
            console.log(`⏰ Se reanudar\u00e1 a las: ${resumeTime.toLocaleString('es-MX')}`);
            console.log(`⏳ Esperando...\n`);
            
            // Esperar 2 horas
            await new Promise(resolve => setTimeout(resolve, PAUSE_DURATION));
            
            console.log(`\n╔════════════════════════════════════════╗`);
            console.log(`║      REANUDANDO ENVÍO...           ║`);
            console.log(`╚════════════════════════════════════════╝\n`);
          } else {
            console.error(`❌ Error al actualizar contactos pendientes`);
            console.log(`⚠️  Deteniendo proceso por seguridad`);
            break;
          }
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
      
      // Enviar backup al servidor
      console.log('\n☁️  Enviando backup al servidor...');
      const backupData = {
        results,
        summary: { sent, errors, withResponse, total: results.length },
        timestamp: new Date().toISOString(),
      };
      await sendBackup(backupData);
      
      console.log('\n✨ Proceso de automatización completado!\n');
    } else if (shouldOpenManual) {
      // No hay contactos pero queremos abrir ventana manual
      // Solo si ya existen credenciales
      if (credentialsExist) {
        // Primero inicializar la ventana de automatización (para backups y funcionalidad completa)
        console.log('═══════════════════════════════════════');
        console.log('🤖 Iniciando ventana de automatización...');
        console.log('═══════════════════════════════════════\n');
        
        await initWhatsApp();
        
        // Luego abrir la ventana manual
        console.log('\n═══════════════════════════════════════');
        console.log('🔓 Iniciando ventana manual...');
        console.log('═══════════════════════════════════════\n');
        
        manualWindowStarted = true;
        manualWindowPromise = initManualWhatsApp([]).then(() => {
          console.log('\n💬 Ventana manual lista para responder');
          console.log('⚠️  Esta ventana permanecerá abierta\n');
        });
      } else {
        console.log('⚠️  No hay credenciales configuradas.');
        console.log('   Configura las credenciales del agente (backend) y vuelve a ejecutar.\n');
      }
    }
    
    // Si la ventana manual está abierta, esperar a que se complete su inicialización
    if (manualWindowPromise) {
      await manualWindowPromise;
      
      console.log('═══════════════════════════════════════');
      console.log('   Presiona Ctrl+C para cerrar el programa');
      console.log('═══════════════════════════════════════\n');
      
      // Mantener el programa corriendo para la ventana manual
      await new Promise(() => {}); // Espera infinita
    }

  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    console.error(error.stack);
    await waitForEnterIfPkg();
  } finally {
    // Si la ventana manual queda abierta, el cierre se hace via Ctrl+C (SIGINT)
    if (!shuttingDown) {
      await closeBrowser();
      await closeManualBrowser();
    }
  }
}

// Ejecutar
main().catch(console.error);
