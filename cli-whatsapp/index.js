import fs from 'fs';
import path from 'path';
import { CONFIG, __dirname_export as __dirname } from './config.js';
import { readContacts, saveResults, saveResponses } from './csv-utils.js';
import { initWhatsApp, sendMessage, closeBrowser, getPage, getAgentConfig } from './whatsapp.js';
import { initManualWhatsApp, closeManualBrowser } from './whatsapp-manual.js';
import { sendBackup, hasAgentConfig } from './agent-config.js';

// Función principal
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   WhatsApp CLI Mass Sender v2.0       ║');
  console.log('║      Sistema de Dos Ventanas          ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Leer contactos primero
    const contacts = await readContacts().catch(() => []);
    
    // Decidir qué ventanas abrir
    const hasContacts = contacts.length > 0;
    const shouldOpenManual = CONFIG.enableManualWindow;
    const credentialsExist = hasAgentConfig();
    
    console.log(`📊 Contactos para automatización: ${contacts.length}`);
    console.log(`🔓 Ventana manual: ${shouldOpenManual ? 'ACTIVADA' : 'DESACTIVADA'}`);
    console.log(`🔐 Credenciales: ${credentialsExist ? 'CONFIGURADAS' : 'PENDIENTES'}\n`);
    
    // La ventana manual solo se abre si ya hay credenciales configuradas
    // Si no hay credenciales, primero se debe abrir la ventana de automatización para configurarlas
    let manualWindowPromise = null;
    let manualWindowStarted = false;
    
    // Si hay contactos, abrir ventana de automatización
    if (hasContacts) {
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
        manualWindowPromise = initManualWhatsApp(contacts).then(() => {
          console.log('\n💬 Ventana manual lista para responder');
          console.log('⚠️  Esta ventana permanecerá abierta\n');
        });
      }

      // Enviar mensajes
      const results = [];
      const page = getPage();
      
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
        console.log('   Agrega contactos en contactos.csv para configurar credenciales primero.\n');
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
  } finally {
    await closeBrowser();
    await closeManualBrowser();
  }
}

// Ejecutar
main().catch(console.error);
