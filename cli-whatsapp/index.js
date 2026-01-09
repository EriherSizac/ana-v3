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

const safeResetDir = (dir, label) => {
  try {
    if (!dir) return;
    if (!fs.existsSync(dir)) return;
    const parent = path.dirname(dir);
    const base = path.basename(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(parent, `${base}.bak-${stamp}`);
    fs.renameSync(dir, backup);
    console.log(`🧹 Reset ${label}: renombrado a ${backup}`);
  } catch (e) {
    console.error(`❌ No se pudo resetear ${label}:`, e?.message || e);
  }
};

const formatMsAsHms = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

const ensureStatusWidget = async (page) => {
  if (!page) return;
  try {
    await page.evaluate(() => {
      const ID = 'ana-status-widget';
      if (document.getElementById(ID)) return;

      const el = document.createElement('div');
      el.id = ID;
      el.style.cssText = [
        'position:fixed',
        'right:18px',
        'bottom:18px',
        'z-index:2147483647',
        'background:rgba(0,0,0,0.75)',
        'color:#fff',
        'padding:10px 12px',
        'border-radius:12px',
        'font-family:Arial, sans-serif',
        'font-size:13px',
        'line-height:1.25',
        'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
        'backdrop-filter:blur(2px)',
        'max-width:280px',
        'white-space:pre-line',
      ].join(';');
      el.textContent = 'ANA';
      document.body.appendChild(el);
    });
  } catch (_) {
    // ignore
  }
};

const setStatusWidgetText = async (page, text) => {
  if (!page) return;
  try {
    await ensureStatusWidget(page);
    await page.evaluate((payload) => {
      const el = document.getElementById('ana-status-widget');
      if (!el) return;
      el.textContent = String(payload?.text || '');
    }, { text: String(text || '') });
  } catch (_) {
    // ignore
  }
};

const setPauseBlocker = async (page, enabled) => {
  if (!page) return;
  try {
    await page.evaluate((payload) => {
      const ID = 'ana-pause-blocker';
      const existing = document.getElementById(ID);

      if (!payload?.enabled) {
        if (existing) existing.remove();
        return;
      }

      if (existing) return;

      const el = document.createElement('div');
      el.id = ID;
      el.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:rgba(0,0,0,0.25)',
        'z-index:2147483646',
        'pointer-events:auto',
      ].join(';');
      document.body.appendChild(el);
    }, { enabled: enabled === true });
  } catch (_) {
    // ignore
  }
};

const sleepWithCountdown = async (totalMs, label, pages = []) => {
  const endAt = Date.now() + totalMs;

  // En ambientes no-interactivos, evitar spam: log cada minuto
  const isInteractive = Boolean(process.stdout && process.stdout.isTTY);
  let lastLoggedMinute = null;

  while (true) {
    const remaining = endAt - Date.now();
    if (remaining <= 0) break;

    const uiText = `${label}: ${formatMsAsHms(remaining)}`;
    const pagesToUpdate = Array.isArray(pages) ? pages.filter(Boolean) : [];
    if (pagesToUpdate.length) {
      await Promise.all(pagesToUpdate.map((p) => setStatusWidgetText(p, uiText)));
    }

    if (isInteractive) {
      process.stdout.write(`\r⏳ ${label}: ${formatMsAsHms(remaining)}   `);
    } else {
      const m = Math.floor(remaining / 60000);
      if (m !== lastLoggedMinute) {
        lastLoggedMinute = m;
        console.log(`⏳ ${label}: ${formatMsAsHms(remaining)}`);
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  if (isInteractive) process.stdout.write('\n');
  const pagesToClear = Array.isArray(pages) ? pages.filter(Boolean) : [];
  if (pagesToClear.length) {
    await Promise.all(pagesToClear.map((p) => setStatusWidgetText(p, '')));
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
import { initManualWhatsApp, closeManualBrowser, getManualPage } from './whatsapp-manual.js';
import { initMonitorWhatsApp, closeMonitorBrowser, getMonitorPage } from './whatsapp-monitor.js';
import { sendBackup, hasAgentConfig, fetchAssignedChats, updatePendingContacts, loadAgentConfig, insertInteractions } from './agent-config.js';

// Función principal
async function main() {
  // Flags de utilería para recuperar perfiles corruptos (pantalla de carga infinita)
  if (process.argv.includes('--reset-monitor-session')) {
    safeResetDir(CONFIG.monitorSessionPath, 'Monitor Session');
  }
  if (process.argv.includes('--reset-manual-session')) {
    safeResetDir(CONFIG.manualSessionPath, 'Manual Session');
  }
  if (process.argv.includes('--reset-auto-session')) {
    safeResetDir(CONFIG.sessionPath, 'Auto Session');
  }

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
    try {
      await closeMonitorBrowser();
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

    // Decidir qué ventanas abrir
    const shouldOpenManual = CONFIG.enableManualWindow;
    const shouldOpenMonitor = CONFIG.enableMonitorWindow;

    const agentConfig = loadAgentConfig();
    const rawCampaign = agentConfig?.campaign || '';
    const campaignName = rawCampaign.includes('-') ? rawCampaign.split('-').slice(1).join('-') : rawCampaign;
    const INTERACTIONS_USER_ID = '6898b89b-ab72-4196-92b1-70d51781f68f';
    
    console.log(`🔓 Ventana manual: ${shouldOpenManual ? 'ACTIVADA' : 'DESACTIVADA'}`);
    console.log(`👀 Ventana monitor: ${shouldOpenMonitor ? 'ACTIVADA' : 'DESACTIVADA'}`);
    console.log(`🔐 Credenciales: ${credentialsExist ? 'CONFIGURADAS' : 'PENDIENTES'}\n`);
    
    // La ventana manual solo se abre si ya hay credenciales configuradas
    // Si no hay credenciales, primero se debe abrir la ventana de automatización para configurarlas
    let manualWindowPromise = null;
    let manualWindowStarted = false;

    let monitorWindowPromise = null;
    let monitorWindowStarted = false;
    
    // Iniciar WhatsApp para automatización (necesario para polling y envíos)
    {

      // Activar modo media por portapapeles si se pasa el flag en la línea de comandos
      if (process.argv.includes('--clipboard-media')) {
        CONFIG.useClipboardMedia = true;
        console.log('📎 Modo media por portapapeles ACTIVADO');
        console.log('   Asegúrate de tener una imagen/video copiado antes de cada envío.');
        console.log('─────────────────────────────────────\n');
      }

      await initWhatsApp();
      
      // Después de initWhatsApp, las credenciales ya están configuradas
      // Ahora podemos abrir la ventana manual si está habilitada
      if (shouldOpenManual && !manualWindowStarted) {
        console.log('\n═══════════════════════════════════════');
        console.log('🔓 Iniciando ventana manual...');
        console.log('═══════════════════════════════════════\n');
        
        manualWindowStarted = true;
        manualWindowPromise = initManualWhatsApp([])
          .then(() => {
            console.log('\n💬 Ventana manual lista para responder');
            console.log('⚠️  Esta ventana permanecerá abierta\n');
          })
          .catch((error) => {
            console.error('❌ Error al iniciar ventana manual:', error.message);
            console.error('Stack:', error.stack);
          });
      }

      // Abrir ventana monitor (no leídos) si está habilitada
      if (shouldOpenMonitor && !monitorWindowStarted) {
        console.log('\n═══════════════════════════════════════');
        console.log('👀 Iniciando ventana monitor (No leídos)...');
        console.log('═══════════════════════════════════════\n');

        monitorWindowStarted = true;
        monitorWindowPromise = initMonitorWhatsApp()
          .then(() => {
            console.log('\n👀 Ventana monitor lista (No leídos)');
            console.log('⚠️  Esta ventana permanecerá abierta\n');
          })
          .catch((error) => {
            console.error('❌ Error al iniciar ventana monitor:', error.message);
            console.error('Stack:', error.stack);
          });
      }

      const POLL_INTERVAL_MS = 30 * 1000;
      const PAUSE_AFTER_MESSAGES = 40;
      const PAUSE_DURATION_MS = 20 * 60 * 1000;

      const results = [];
      const page = getPage();
      let sentSinceLastPause = 0;
      let cycle = 0;

      while (true) {
        cycle++;
        const manualPage = getManualPage();
        const monitorPage = getMonitorPage();
        await Promise.all([
          setStatusWidgetText(page, 'Poll: consultando servidor...'),
          setStatusWidgetText(manualPage, 'Poll: consultando servidor...'),
          setStatusWidgetText(monitorPage, 'Poll: consultando servidor...'),
        ]);

        console.log('📡 Obteniendo contactos del servidor...');
        const contacts = (await fetchAssignedChats()) || [];
        console.log(`📊 Contactos para automatización: ${contacts.length}`);

        if (contacts.length === 0) {
          console.log('ℹ️  No hay contactos asignados.');
          await sleepWithCountdown(POLL_INTERVAL_MS, 'Próximo poll', [page, manualPage, monitorPage]);
          continue;
        }

        console.log(`\n╔════════════════════════════════════════╗`);
        console.log(`║        CICLO ${cycle}: ${contacts.length} contactos        ║`);
        console.log(`╚════════════════════════════════════════╝\n`);

        for (let i = 0; i < contacts.length; i++) {
          const contact = contacts[i];
          const idx = i + 1;
          console.log(`\n[${idx}/${contacts.length}] Procesando: ${contact.name}`);

          const result = await sendMessage(contact, contact.message);
          results.push(result);
          sentSinceLastPause += 1;
          const remainingToPause = Math.max(0, PAUSE_AFTER_MESSAGES - sentSinceLastPause);
          const counterLine = `📨 Contador pausa: ${sentSinceLastPause}/${PAUSE_AFTER_MESSAGES} (faltan ${remainingToPause})`;
          console.log(counterLine);

          const statusText = `Ciclo ${cycle} | ${idx}/${contacts.length}\n${counterLine}`;
          await Promise.all([
            setStatusWidgetText(page, statusText),
            setStatusWidgetText(manualPage, statusText),
            setStatusWidgetText(monitorPage, statusText),
          ]);

          try {
            const now = new Date();
            const contact_date = now.toISOString().slice(0, 10);
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const nextH = String((now.getHours() + 1) % 24).padStart(2, '0');
            const phoneDigits = String(contact.phone || '').replace(/\D/g, '');
            const phone10 = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits;
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

          if (i < contacts.length - 1) {
            console.log(`⏳ Esperando ${CONFIG.delayBetweenMessages / 1000}s antes del siguiente mensaje...`);
            await page.waitForTimeout(CONFIG.delayBetweenMessages);
          }

          if (sentSinceLastPause >= PAUSE_AFTER_MESSAGES) {
            console.log(`\n⏸️  Límite alcanzado (${PAUSE_AFTER_MESSAGES} mensajes). Pausando 20 minutos...`);
            await Promise.all([
              setPauseBlocker(page, true),
              setPauseBlocker(manualPage, true),
              setPauseBlocker(monitorPage, true),
            ]);
            await sleepWithCountdown(PAUSE_DURATION_MS, 'Fin de pausa', [page, manualPage, monitorPage]);
            await Promise.all([
              setPauseBlocker(page, false),
              setPauseBlocker(manualPage, false),
              setPauseBlocker(monitorPage, false),
            ]);
            sentSinceLastPause = 0;
          }
        }

        console.log(`\n☁️  Marcando contactos como procesados en el servidor...`);
        const updated = await updatePendingContacts([]);
        if (!updated) {
          console.error('❌ Error al actualizar contactos pendientes (limpiar lista).');
        }

        await saveResults(results);
        await saveResponses(results);

        const sent = results.filter(r => r.status === 'sent').length;
        const errors = results.filter(r => r.status === 'error').length;
        const withResponse = results.filter(r => r.response && r.response.trim() !== '').length;

        console.log('\nℹ️  Backup automático desactivado (solo manual).');

        console.log(`\n✅ Ciclo ${cycle} completado. Volviendo a hacer poll en ${POLL_INTERVAL_MS / 1000}s...`);
        await sleepWithCountdown(POLL_INTERVAL_MS, 'Próximo poll', [page, manualPage, monitorPage]);
      }
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
      await closeMonitorBrowser();
    }
  }
}

// Ejecutar
main().catch(console.error);
