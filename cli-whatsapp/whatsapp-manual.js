// IMPORTANTE: setup-env.js debe importarse PRIMERO
import './setup-env.js';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { startBackupMonitor } from './chat-backup.js';
import { loadAgentConfig, saveAgentConfig, API_BASE_URL, INTERACTIONS_API_BASE_URL, insertInteractions } from './agent-config.js';

let manualBrowser = null;
let manualPage = null;
let backupMonitorInterval = null;

let cachedResultCodesByCampaign = new Map();

/**
 * Muestra el overlay de login en la ventana manual
 * @param {boolean} requireAll - Si es true, pide usuario, campaña y palabra. Si es false, solo palabra
 * @returns {Promise<Object>} Configuración del agente
 */
async function showManualLoginOverlay(requireAll = true) {
  return new Promise(async (resolve) => {
    const savedConfig = loadAgentConfig();
    
    await manualPage.evaluate((args) => {
      const { requireAll, savedUser, savedCampaign } = args;
      
      const existing = document.getElementById('manual-login-overlay');
      if (existing) existing.remove();
      
      const overlay = document.createElement('div');
      overlay.id = 'manual-login-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.95);
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        color: white;
      `;
      
      const userField = requireAll ? `
        <div style="margin-bottom: 20px; text-align: left;">
          <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #25D366;">Usuario</label>
          <input type="text" id="manual-login-user" value="${savedUser || ''}" placeholder="ej: erick" style="
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #333;
            border-radius: 10px;
            background: #1a1a1a;
            color: white;
            font-size: 16px;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.3s;
          " onfocus="this.style.borderColor='#25D366'" onblur="this.style.borderColor='#333'">
        </div>
      ` : '';
      
      const campaignField = requireAll ? `
        <div style="margin-bottom: 20px; text-align: left;">
          <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #25D366;">Campaña</label>
          <input type="text" id="manual-login-campaign" value="${savedCampaign || ''}" placeholder="ej: prueba" style="
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #333;
            border-radius: 10px;
            background: #1a1a1a;
            color: white;
            font-size: 16px;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.3s;
          " onfocus="this.style.borderColor='#25D366'" onblur="this.style.borderColor='#333'">
        </div>
      ` : `
        <div style="margin-bottom: 20px; text-align: left;">
          <p style="font-size: 14px; opacity: 0.7;">Usuario: <strong style="color: #25D366;">${savedUser}</strong></p>
          <p style="font-size: 14px; opacity: 0.7;">Campaña: <strong style="color: #25D366;">${savedCampaign}</strong></p>
        </div>
      `;
      
      overlay.innerHTML = `
        <div style="text-align: center; padding: 40px; background: rgba(30, 30, 30, 0.95); border-radius: 20px; border: 2px solid #25D366; min-width: 400px;">
          <div style="font-size: 60px; margin-bottom: 20px;">🔐</div>
          <h1 style="margin: 0 0 10px 0; font-size: 28px; color: #25D366;">${requireAll ? 'Iniciar Sesión (Manual)' : 'Verificación Diaria'}</h1>
          <p style="margin: 0 0 30px 0; font-size: 14px; opacity: 0.7;">Ventana de respuestas manuales</p>
          
          ${userField}
          ${campaignField}
          
          <div style="margin-bottom: 30px; text-align: left;">
            <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #25D366;">Palabra del Día</label>
            <input type="password" id="manual-login-daily-password" placeholder="Ingresa la palabra del día" style="
              width: 100%;
              padding: 12px 15px;
              border: 2px solid #333;
              border-radius: 10px;
              background: #1a1a1a;
              color: white;
              font-size: 16px;
              box-sizing: border-box;
              outline: none;
              transition: border-color 0.3s;
            " onfocus="this.style.borderColor='#25D366'" onblur="this.style.borderColor='#333'">
          </div>
          
          <button id="manual-login-submit-btn" style="
            width: 100%;
            padding: 15px;
            background: #25D366;
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.3s;
          " onmouseover="this.style.background='#1da851'" onmouseout="this.style.background='#25D366'">
            Verificar Credenciales
          </button>
          
          <p id="manual-login-error" style="margin: 15px 0 0 0; font-size: 14px; color: #ff6b6b; display: none;"></p>
          <p id="manual-login-loading" style="margin: 15px 0 0 0; font-size: 14px; color: #25D366; display: none;">Verificando...</p>
        </div>
      `;
      
      document.body.appendChild(overlay);
      
      setTimeout(() => {
        const firstInput = requireAll ? 
          document.getElementById('manual-login-user') : 
          document.getElementById('manual-login-daily-password');
        if (firstInput) firstInput.focus();
      }, 100);
      if (savedUser) window.__savedUser = savedUser;
      if (savedCampaign) window.__savedCampaign = savedCampaign;
    }, { requireAll, savedUser: savedConfig?.agent_id, savedCampaign: savedConfig?.campaign });

    // Exponer función para verificar credenciales
    await manualPage.exposeFunction('verifyManualCredentialsBackend', async (user, campaign, dailyPassword) => {
      try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/auth/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user, campaign, dailyPassword })
        });
        
        const data = await response.json();
        console.log('[Auth Manual] Respuesta del backend:', data);
        return data;
      } catch (error) {
        console.error('[Auth Manual] Error al verificar credenciales:', error);
        return { success: false, message: 'Error de conexión con el servidor' };
      }
    });

    // Escuchar el evento de submit
    const checkSubmit = async () => {
      await manualPage.evaluate((requireAll) => {
        return new Promise((innerResolve) => {
          const btn = document.getElementById('manual-login-submit-btn');
          const userInput = document.getElementById('manual-login-user');
          const campaignInput = document.getElementById('manual-login-campaign');
          const dailyPasswordInput = document.getElementById('manual-login-daily-password');
          const errorEl = document.getElementById('manual-login-error');
          const loadingEl = document.getElementById('manual-login-loading');
          
          if (!btn || btn.dataset.listenerAdded) return innerResolve(null);
          
          btn.dataset.listenerAdded = 'true';
          
          const handleSubmit = async () => {
            const user = requireAll ? userInput.value.trim() : window.__savedUser;
            const campaign = requireAll ? campaignInput.value.trim() : window.__savedCampaign;
            const dailyPassword = dailyPasswordInput.value.trim();
            
            if (requireAll && (!user || !campaign)) {
              errorEl.textContent = 'Por favor completa todos los campos';
              errorEl.style.display = 'block';
              return;
            }
            
            if (!dailyPassword) {
              errorEl.textContent = 'Por favor ingresa la palabra del día';
              errorEl.style.display = 'block';
              return;
            }
            
            errorEl.style.display = 'none';
            loadingEl.style.display = 'block';
            btn.disabled = true;
            btn.style.opacity = '0.5';
            
            const result = await window.verifyManualCredentialsBackend(user, campaign, dailyPassword);
            
            loadingEl.style.display = 'none';
            btn.disabled = false;
            btn.style.opacity = '1';
            
            if (result.success) {
              window.__manualLoginResult = { 
                agent_id: user, 
                campaign: campaign 
              };
              
              const overlay = document.getElementById('manual-login-overlay');
              if (overlay) overlay.remove();
            } else {
              errorEl.textContent = result.message || 'Credenciales incorrectas';
              errorEl.style.display = 'block';
            }
          };
          
          btn.addEventListener('click', handleSubmit);
          
          const inputs = [dailyPasswordInput];
          if (requireAll) {
            inputs.push(userInput, campaignInput);
          }
          
          inputs.forEach(input => {
            if (input) {
              input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleSubmit();
              });
            }
          });
          
          innerResolve(null);
        });
      }, requireAll);
      
      const pollResult = setInterval(async () => {
        try {
          const loginResult = await manualPage.evaluate(() => window.__manualLoginResult);
          if (loginResult) {
            clearInterval(pollResult);
            resolve(loginResult);
          }
        } catch (err) {
          // Contexto destruido (navegación), limpiar intervalo
          clearInterval(pollResult);
        }
      }, 200);
    };
    
    if (!requireAll && savedConfig) {
      await manualPage.evaluate((config) => {
        window.__savedUser = config.agent_id;
        window.__savedCampaign = config.campaign;
      }, savedConfig);
    }
    
    checkSubmit();
  });
}

async function injectNoWhatsappInfoButton(page) {
  const config = loadAgentConfig();
  if (!config) {
    console.log('⚠️  No hay configuración de agente, botón de info no-whatsapp no disponible');
    return;
  }

  const rawCampaign = config.campaign || '';
  const campaignName = rawCampaign.includes('-') ? rawCampaign.split('-').slice(1).join('-') : rawCampaign;
  const INTERACTIONS_USER_ID = '6898b89b-ab72-4196-92b1-70d51781f68f';

  const readNoWhatsappPhonesFromResultsCsv = () => {
    try {
      const filePath = CONFIG.outputCsv;
      if (!filePath || !fs.existsSync(filePath)) return [];

      const text = fs.readFileSync(filePath, 'utf-8');
      const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) return [];

      const headers = lines[0].split(',').map((h) => String(h || '').trim().toLowerCase());
      const idxPhone = headers.indexOf('phone');
      const idxStatus = headers.indexOf('status');
      if (idxPhone === -1 || idxStatus === -1) return [];

      const phones = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const status = String(cols[idxStatus] || '').trim();
        if (status !== 'no_whatsapp') continue;
        const phoneRaw = String(cols[idxPhone] || '').trim();
        const digits = phoneRaw.replace(/\D/g, '');
        if (!digits) continue;
        const last10 = digits.length > 10 ? digits.slice(-10) : digits;
        phones.push(last10);
      }

      return Array.from(new Set(phones));
    } catch (e) {
      console.error('⚠️  Error leyendo resultados.csv para no_whatsapp:', e?.message || e);
      return [];
    }
  };

  await page.exposeFunction('getNoWhatsappPhonesFromNode', async () => {
    const phones10 = readNoWhatsappPhonesFromResultsCsv();
    const masked = phones10.map((p) => String(p).slice(-4)).filter(Boolean);
    return {
      count: masked.length,
      phones10,
      masked,
    };
  });

  await page.exposeFunction('submitNoWhatsappInfoInteraction', async (phones10) => {
    try {
      const list = Array.isArray(phones10) ? phones10 : [];
      const now = new Date();
      const contact_date = now.toISOString().slice(0, 10);
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const nextH = String((now.getHours() + 1) % 24).padStart(2, '0');

      const interactions = list.slice(0, 200).map((phone10) => ({
        credit_id: '',
        campaign_name: String(campaignName || ''),
        user_id: INTERACTIONS_USER_ID,
        subdictamen: 'Consulta No Whatsapp',
        contact_date,
        contact_time: `${hh}:${mm}`,
        range_time: `${hh}:00 - ${nextH}:00`,
        action_channel: 'whatsapp',
        action: 'whatsapp',
        contactable: false,
        phone_number: String(phone10 || ''),
        email_address: null,
        template_used: null,
        comments: 'opened_no_whatsapp_info_modal',
        promise_date: null,
        promise_amount: null,
        promise_payment_plan: null,
        inoutbound: 'inbound',
        payment_made_date: null,
      }));

      if (interactions.length === 0) return { ok: true, status: 204, body: { message: 'no phones' } };
      return await insertInteractions(interactions);
    } catch (e) {
      console.error('❌ Error al insertar interacción (no_whatsapp info):', e?.message || e);
      return { ok: false, status: 0, body: null, error: e?.message || String(e) };
    }
  });

  await page.addInitScript(() => {
    const ensureStyles = () => {
      if (document.getElementById('no-whatsapp-info-styles')) return;
      const style = document.createElement('style');
      style.id = 'no-whatsapp-info-styles';
      style.textContent = `
        #no-whatsapp-info-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 99999996; backdrop-filter: blur(2px); }
        #no-whatsapp-info-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); background: #fff; border-radius: 14px; width: 420px; max-width: calc(100vw - 40px); max-height: 75vh; overflow: hidden; z-index: 99999997; font-family: Arial, sans-serif; }
        #no-whatsapp-info-modal header { background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: #fff; padding: 12px 14px; display:flex; align-items:center; justify-content: space-between; }
        #no-whatsapp-info-modal header h2 { margin:0; font-size: 14px; }
        #no-whatsapp-info-modal header button { background: rgba(255,255,255,.2); border:none; color:#fff; width: 28px; height: 28px; border-radius: 50%; font-size: 18px; cursor:pointer; }
        #no-whatsapp-info-body { padding: 12px 14px; overflow:auto; max-height: calc(75vh - 52px); }
        .no-wa-pill { display:inline-block; padding: 6px 10px; background:#f3f4f6; border: 1px solid #e5e7eb; border-radius: 999px; margin: 6px 6px 0 0; font-size: 12px; color: #111827; }
        .no-wa-muted { font-size: 12px; color: #6b7280; }
      `;
      document.head.appendChild(style);
    };

    const closeModal = () => {
      const overlay = document.getElementById('no-whatsapp-info-overlay');
      const modal = document.getElementById('no-whatsapp-info-modal');
      if (overlay) overlay.remove();
      if (modal) modal.remove();
    };

    const openModal = async () => {
      ensureStyles();
      closeModal();

      const overlay = document.createElement('div');
      overlay.id = 'no-whatsapp-info-overlay';
      overlay.onclick = () => closeModal();

      const modal = document.createElement('div');
      modal.id = 'no-whatsapp-info-modal';
      modal.onclick = (e) => e.stopPropagation();
      modal.innerHTML = `
        <header>
          <h2>ℹ️ Números sin WhatsApp</h2>
          <button id="no-whatsapp-info-close">×</button>
        </header>
        <div id="no-whatsapp-info-body">
          <div class="no-wa-muted">Cargando...</div>
        </div>
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(modal);

      const closeBtn = document.getElementById('no-whatsapp-info-close');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      try {
        const data = await window.getNoWhatsappPhonesFromNode();
        const body = document.getElementById('no-whatsapp-info-body');
        if (!body) return;

        const count = Number(data?.count || 0);
        const masked = Array.isArray(data?.masked) ? data.masked : [];
        const phones10 = Array.isArray(data?.phones10) ? data.phones10 : [];

        if (count === 0) {
          body.innerHTML = `<div class="no-wa-muted">No hay números marcados como <strong>no_whatsapp</strong> en resultados.csv.</div>`;
        } else {
          const header = `<div class="no-wa-muted">Total: <strong>${count}</strong></div>`;
          const pills = masked.map((d) => `<span class="no-wa-pill">**** ${String(d)}</span>`).join('');
          body.innerHTML = header + `<div style="margin-top: 8px;">${pills}</div>`;
        }

        if (typeof window.submitNoWhatsappInfoInteraction === 'function') {
          window.submitNoWhatsappInfoInteraction(phones10).catch(() => null);
        }
      } catch (e) {
        const body = document.getElementById('no-whatsapp-info-body');
        if (body) body.innerHTML = `<div class="no-wa-muted">Error cargando lista.</div>`;
      }
    };

    const createButton = () => {
      const existing = document.getElementById('no-whatsapp-info-btn');
      if (existing) return;

      const btn = document.createElement('button');
      btn.id = 'no-whatsapp-info-btn';
      btn.title = 'Números sin WhatsApp';
      btn.innerHTML = 'ℹ️';
      btn.style.cssText = `
        position: fixed;
        bottom: 70px;
        right: 20px;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 999px;
        background: rgba(255,255,255,0.92);
        color: #111;
        font-size: 16px;
        cursor: pointer;
        z-index: 999998;
        box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      `;
      btn.onmouseover = () => {
        btn.style.transform = 'scale(1.05)';
      };
      btn.onmouseout = () => {
        btn.style.transform = 'scale(1)';
      };
      btn.onclick = () => openModal();
      document.body.appendChild(btn);
    };

    window.addEventListener('load', () => {
      setTimeout(() => createButton(), 2500);
    });

    setInterval(() => {
      createButton();
    }, 5000);
  });
}

/**
 * Inicializa la ventana manual de WhatsApp para respuestas
 * @param {Array} allowedContacts - Lista de contactos permitidos (números de teléfono)
 */
export async function initManualWhatsApp(allowedContacts = []) {
  console.log(' Iniciando ventana manual de WhatsApp...');

  const downloadsPath = path.join(os.homedir(), 'Downloads');
  try {
    fs.mkdirSync(downloadsPath, { recursive: true });
  } catch (_) {
    // ignore
  }
  
  manualBrowser = await chromium.launchPersistentContext(CONFIG.manualSessionPath, {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--app=https://web.whatsapp.com', // Modo app (sin barra de navegación)
      '--disable-dev-tools', // Desactivar DevTools
    ],
    viewport: { width: 1280, height: 720 },
    devtools: false,
    acceptDownloads: true,
    downloadsPath,
  });

  manualPage = manualBrowser.pages()[0] || await manualBrowser.newPage();

  try {
    manualPage.on('download', async (download) => {
      try {
        const suggested = String(download.suggestedFilename() || 'download.bin');
        const parsed = path.parse(suggested);
        let finalPath = path.join(downloadsPath, suggested);
        let n = 1;
        while (fs.existsSync(finalPath)) {
          finalPath = path.join(downloadsPath, `${parsed.name} (${n})${parsed.ext}`);
          n += 1;
        }
        await download.saveAs(finalPath);
        console.log(`⬇️  Descarga guardada: ${finalPath}`);
      } catch (e) {
        console.error('⚠️  No se pudo guardar la descarga en Downloads:', e?.message || e);
      }
    });
  } catch (_) {
    // ignore
  }
  
  // Inyectar protecciones ANTES de cargar WhatsApp (EXACTO como en whatsapp.js)
  await manualPage.addInitScript(() => {
    // Bloquear atajos de teclado para DevTools
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F5') return;

      // Permitir pegar
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) return;
      if (e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) return;

      const k = String(e.key || '');
      const isFunctionKey = /^F\d{1,2}$/.test(k);
      const hasModifier = Boolean(e.ctrlKey || e.metaKey || e.altKey);

      if (isFunctionKey || hasModifier) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);
    
    // Bloquear menú contextual (clic derecho)
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }, true);
  });
  
  // Inyectar restricciones ANTES de cargar WhatsApp
  await applyUIRestrictions(allowedContacts);
  
  // Inyectar botón de historial ANTES de cargar la página
  try {
    await injectHistoryButton(manualPage);
  } catch (error) {
    console.error('⚠️  Error al preparar botón de historial:', error.message);
  }

  // Exponer función de logging para que los logs del navegador aparezcan en Node.js
  try {
    await manualPage.exposeFunction('logToNodeConsole', (message, ...args) => {
      console.log(message, ...args);
    });
  } catch (error) {
    console.error('⚠️  Error al exponer función de logging:', error.message);
  }

  // Exponer funciones para respaldo de conversaciones
  try {
    await manualPage.exposeFunction('getChatBackupFromBackend', async (campaign, agentId, contactPhone) => {
      try {
        const url = `${CONFIG.apiBaseUrl}/backups/chat/${campaign}/${agentId}/${contactPhone}`;
        console.log(`[ChatBackup] 📡 GET ${url}`);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        console.log(`[ChatBackup] 📡 Response status: ${response.status}`);
        const data = await response.json();
        console.log(`[ChatBackup] 📡 Response data:`, data);
        return data;
      } catch (error) {
        console.error('[ChatBackup] Error al obtener backup:', error);
        return { success: false, message: 'Error de conexión' };
      }
    });

    await manualPage.exposeFunction('saveChatBackupToBackend', async (campaign, agentId, contactPhone, messages) => {
      try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/backups/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ campaign, agent_id: agentId, contact_phone: contactPhone, messages })
        });
        const data = await response.json();
        return data;
      } catch (error) {
        console.error('[ChatBackup] Error al guardar backup:', error);
        return { success: false, message: 'Error de conexión' };
      }
    });
  } catch (error) {
    console.error('⚠️  Error al exponer funciones de chat backup:', error.message);
  }

  try {
    await injectGestionButton(manualPage);
  } catch (error) {
    console.error('⚠️  Error al preparar botón de gestión:', error.message);
  }

  try {
    await injectNoWhatsappInfoButton(manualPage);
  } catch (error) {
    console.error('⚠️  Error al preparar botón de info no-whatsapp:', error.message);
  }
  
  // IMPORTANTE:
  // Aunque se use --app=https://web.whatsapp.com, Chromium puede haber cargado la página
  // antes de que se inyecten los addInitScript. Forzamos navegación para que las
  // protecciones se apliquen desde la primera carga.
  await manualPage.goto('https://web.whatsapp.com', { waitUntil: 'networkidle' });

  console.log('⏳ Esperando que WhatsApp Web (Manual) cargue completamente...');
  
  // Esperar a que la página esté completamente cargada
  try {
    await manualPage.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await manualPage.waitForTimeout(2000); // Dar tiempo extra para estabilizar
  } catch (error) {
    console.log('⚠️  Timeout esperando carga, continuando...');
  }

  const manualConfig = loadAgentConfig();
  if (!manualConfig?.agent_id || !manualConfig?.campaign) {
    console.log('⚠️  [Manual] No se encontró configuración de agente. Ejecuta primero la ventana automática para validar credenciales.');
  } else {
    console.log(`✅ [Manual] Configuración cargada: ${manualConfig.agent_id} | Campaña: ${manualConfig.campaign}`);
  }

  console.log('📱 Escanea el código QR con OTRO teléfono/cuenta');
  
  console.log('⏳ Esperando conexión de WhatsApp Web (Manual)...');
  
  // Ahora sí, esperar a que WhatsApp se conecte
  await manualPage.waitForSelector('#side, #pane-side', { timeout: 300000 });
  
  console.log('✅ WhatsApp Web (Manual) conectado - Ventana lista!');
  
  // Aplicar bloqueos INMEDIATAMENTE en la primera carga
  await manualPage.evaluate(() => {
    // Bloquear atajos de teclado para DevTools
    document.addEventListener('keydown', (e) => {
      // F12
      if (e.key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      
      // Ctrl+Shift+I (Windows/Linux)
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      
      // Ctrl+Shift+J (Console)
      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      
      // Ctrl+Shift+C (Inspect)
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      
      // Cmd+Option+I (Mac)
      if (e.metaKey && e.altKey && e.key === 'I') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      
      // Cmd+Option+J (Mac Console)
      if (e.metaKey && e.altKey && e.key === 'J') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      
      // Cmd+Option+C (Mac Inspect)
      if (e.metaKey && e.altKey && e.key === 'C') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);
    
    // Bloquear menú contextual (clic derecho)
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }, true);
    
    // Aplicar restricciones de UI
    if (window.applyManualUIRestrictions) {
      window.applyManualUIRestrictions();
    }
  });
  
  await manualPage.waitForTimeout(2000);
  
  console.log('🔒 Restricciones aplicadas a la ventana manual');
  
  // Escuchar eventos de navegación/refresh para re-aplicar protecciones
  manualPage.on('load', async () => {
    console.log('🔄 Página recargada, re-aplicando protecciones...');
    
    // Re-aplicar bloqueos de teclado y menú contextual
    await manualPage.evaluate(() => {
      // Bloquear atajos de teclado para DevTools
      document.addEventListener('keydown', (e) => {
        if (e.key === 'F12') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'I') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'J') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'C') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        if (e.metaKey && e.altKey && e.key === 'I') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        if (e.metaKey && e.altKey && e.key === 'J') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        if (e.metaKey && e.altKey && e.key === 'C') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }, true);
      
      // Bloquear menú contextual
      document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }, true);
      
      // Re-aplicar restricciones de UI
      if (window.applyManualUIRestrictions) {
        window.applyManualUIRestrictions();
      }
    });
    
    console.log('✅ Protecciones re-aplicadas después del refresh');
  });
  
  // Iniciar monitor de backup (agrega botón "Respaldar Chats")
  backupMonitorInterval = await startBackupMonitor(manualPage);
  console.log('☁️  Botón de respaldo de chats activado');
  console.log('📜 Botón de historial activado (se mostrará cuando WhatsApp cargue)');
  
  // Iniciar sistema de respaldo automático de conversaciones
  await initChatBackupSystem(manualPage, manualConfig);
  console.log('💾 Sistema de respaldo automático de conversaciones activado');
  
  // Recargar la página para que el script de respaldo se ejecute
  console.log('[ChatBackup] Recargando página para activar sistema de respaldo...');
  await manualPage.reload({ waitUntil: 'networkidle' });
}

/**
 * Aplica restricciones de UI a la ventana manual
 * @param {Array} allowedContacts - Lista de contactos permitidos
 */
async function applyUIRestrictions(allowedContacts) {
  if (!manualPage) return;
  
  // Convertir números a formato limpio para comparación
  const allowedNumbers = allowedContacts.map(contact => 
    contact.phone ? contact.phone.replace(/\D/g, '') : ''
  ).filter(n => n);
  
  await manualPage.addInitScript((numbers) => {
    // Función global para aplicar restricciones
    if (window.__anaManualRestrictionsBootstrapped) return;
    window.__anaManualRestrictionsBootstrapped = true;

    let __anaManualApplyScheduled = false;
    let __anaManualLastApplyAt = 0;

    const runApplyManualUIRestrictions = () => {
      // Inyectar CSS global para bloquear elementos del navegador
      if (!document.getElementById('manual-restrictions-style')) {
        const style = document.createElement('style');
        style.id = 'manual-restrictions-style';
        style.textContent = `
          /* Bloquear cualquier elemento de DevTools que pueda aparecer */
          [class*="devtools"],
          [id*="devtools"],
          [class*="inspector"],
          [id*="inspector"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }

          /* Bloquear interacción con mensajes (evita selección/clic/menús) */
          .message-in,
          .message-in *,
          .message-out,
          .message-out * {
            pointer-events: none !important;
          }

          /* Permitir interacción en descargas de audio (adjuntos) */
          [data-icon="audio-download"],
          [data-icon="audio-download"] * {
            pointer-events: auto !important;
          }

          /* Permitir abrir fotos (preview) */
          [role="button"][aria-label="Abrir foto"],
          [role="button"][aria-label="Abrir foto"] *,
          [role="button"][aria-label="Open photo"],
          [role="button"][aria-label="Open photo"] * {
            pointer-events: auto !important;
          }

          /* Bloquear reenviar */
          [data-icon="forward-refreshed"],
          [data-icon="forward-refreshed"] * {
            pointer-events: none !important;
          }

          [role="gridcell"] {
            pointer-events: none !important;
          }

          #app > div > div > div.x78zum5.xdt5ytf.x5yr21d > div > div._aig-._as6h.x9f619.x1n2onr6.x5yr21d.x6ikm8r.x10wlt62.x17dzmu4.x1i1dayz.x2ipvbc.xjdofhw.xpilrb4.x1t7ytsu.x1vb5itz.x1c4vz4f.x2lah0s.x1oy9qf3.xwfak60.x5hsz1j.x17dq4o0.x10e4vud > span > div > span > div > div {
            pointer-events: none !important;
          }

          /* Fallback robusto para el mismo contenedor (WhatsApp cambia clases frecuentemente) */
          #app [role="application"] [data-icon="ic-chevron-down-menu"],
          #app [data-icon="ic-chevron-down-menu"] {
            pointer-events: none !important;
          }
          
          /* Bloquear selección de texto para evitar copiar/pegar */
          * {
            user-select: none !important;
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
          }
          
          /* Permitir selección solo en el input de mensajes */
          [contenteditable="true"],
          input,
          textarea {
            user-select: text !important;
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
          }

          /* Asegurar que el input/footer del chat siga funcionando */
          #main footer,
          #main footer * {
            pointer-events: auto !important;
          }

          /* Visor de imagen: desactivar interacciones del header/toolbar (mantener Cerrar) */
          button[aria-label="Alejar"],
          button[aria-label="Acercar"],
          button[aria-label="Ir al mensaje"],
          button[aria-label="Responder"],
          button[aria-label="Destacar"],
          button[aria-label="Fijar"],
          button[aria-label="Reaccionar"],
          button[aria-label="Reenviar"],
          button[aria-label="Menú"],
          button[aria-label="Zoom out"],
          button[aria-label="Zoom in"],
          button[aria-label="Go to message"],
          button[aria-label="Reply"],
          button[aria-label="Star"],
          button[aria-label="Pin"],
          button[aria-label="React"],
          button[aria-label="Forward"],
          button[aria-label="Menu"] {
            pointer-events: none !important;
          }

          /* Mantener botón de cerrar activo */
          button[aria-label="Cerrar"],
          button[aria-label="Close"],
          button[aria-label="Cerrar"] *,
          button[aria-label="Close"] * {
            pointer-events: auto !important;
          }
        `;
        document.head.appendChild(style);
      }
      
      // Función para ocultar elementos
      const hideElements = (selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.style.pointerEvents = 'none';
        });
      };

      const removeElements = (selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          try {
            el.style.pointerEvents = 'none';
            el.remove();
          } catch (e) {
            // Ignorar
          }
        });
      };

      const disableElements = (selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          try {
            el.style.pointerEvents = 'none';
            el.style.opacity = '0';
            el.style.visibility = 'hidden';
          } catch (e) {
            // Ignorar
          }
        });
      };
      // Ocultar botones de llamada y videollamada en el header del chat
      hideElements('[data-icon="voice-call"]');
      hideElements('[data-icon="video-call"]');
      hideElements('[aria-label*="llamada"]');
      hideElements('[aria-label*="videollamada"]');
      hideElements('[title*="llamada"]');
      hideElements('[title*="videollamada"]');
      
      // Ocultar botón de adjuntar audio y mensaje de voz
      hideElements('[data-icon="ptt"]');
      hideElements('[data-icon="mic-outlined"]');
      hideElements('[aria-label*="audio"]');
      hideElements('[aria-label="Mensaje de voz"]');
      hideElements('[title*="Grabar"]');
      hideElements('button[aria-label="Mensaje de voz"]');
      
      // Ocultar el botón de nuevo chat/búsqueda de nuevos contactos
      hideElements('[data-icon="new-chat"]');
      hideElements('[data-icon="new-chat-outline"]');
      hideElements('[title*="nuevo chat"]');
      hideElements('[aria-label*="nuevo chat"]');
      hideElements('[aria-label="New chat"]');
      hideElements('button[aria-label*="New chat"]');
      hideElements('button[data-tab="2"]'); // Botón de nuevo chat
      
      // Ocultar botón de menú (3 puntos)
      hideElements('[data-icon="more-refreshed"]');
      hideElements('[aria-label="Menu"]');
      hideElements('[aria-label="Menú"]');
      hideElements('button[aria-label*="Menu"]');
      hideElements('button[aria-label*="Menú"]');
      
      // Ocultar menú desplegable de cada chat (flechita)
      hideElements('[data-icon="down"]');
      hideElements('[data-icon="chevron-down"]');
      hideElements('span[data-icon="down"]');
      hideElements('button[aria-label*="Menú de chat"]');
      hideElements('button[aria-label*="Chat menu"]');
      hideElements('div[role="button"] span[data-icon="down"]');

      // Ocultar/eliminar contador de no leídos y menú desplegable en la lista de chats
      // (selector exacto proporcionado + selectores más robustos por si cambia el DOM)
      disableElements('#pane-side > div:nth-child(2) > div > div > div:nth-child(6) > div > div > div > div._ak8l._ap1_ > div._ak8j > div._ak8i');
      disableElements('[aria-label*="mensajes no leídos"]');
      disableElements('button span[data-icon="ic-chevron-down-menu"]');

      // Bloquear el área del chevron/menu en cada chat (selector exacto reportado)
      disableElements('#pane-side > div:nth-child(1) > div > div > div:nth-child(1) > div > div > div > div._ak8l._ap1_ > div._ak8j');

      // Fallback robusto: deshabilitar el botón que contiene el icono del chevron
      try {
        const chevrons = document.querySelectorAll('#pane-side span[data-icon="ic-chevron-down-menu"]');
        chevrons.forEach((icon) => {
          const btn = icon.closest('button');
          if (!btn) return;
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0';
          btn.style.visibility = 'hidden';
        });
      } catch (e) {
        // Ignorar
      }
      
      // Ocultar botones de navegación inferior (Estado, Canales, Comunidades, Multimedia, Ajustes, Perfil)
      hideElements('[data-icon="status-refreshed"]');
      hideElements('[data-icon="newsletter-outline"]');
      hideElements('[data-icon="community-refreshed-32"]');
      hideElements('[data-icon="media-refreshed"]');
      hideElements('[data-icon="settings-refreshed"]');
      hideElements('[data-icon="default-contact-refreshed"]');
      hideElements('button[aria-label="Estado"]');
      hideElements('button[aria-label="Canales"]');
      hideElements('button[aria-label="Comunidades"]');
      hideElements('button[aria-label="Contenido multimedia"]');
      hideElements('button[aria-label="Ajustes"]');
      hideElements('button[aria-label="Perfil"]');
      hideElements('button[data-navbar-item-index="1"]'); // Estado
      hideElements('button[data-navbar-item-index="2"]'); // Canales
      hideElements('button[data-navbar-item-index="3"]'); // Comunidades
      hideElements('button[data-navbar-item-index="4"]'); // Contenido multimedia
      hideElements('button[data-navbar-item-index="5"]'); // Ajustes
      hideElements('button[data-navbar-item-index="6"]'); // Perfil
      
      // Bloquear interacción con el header completo del chat
      const chatHeaders = document.querySelectorAll('header');
      chatHeaders.forEach(header => {
        // Verificar que sea el header del chat (contiene info del contacto)
        if (header.querySelector('[data-tab="6"]') || 
            header.querySelector('[aria-label*="Detalles"]') ||
            header.querySelector('img[alt=""]')) {
          header.style.pointerEvents = 'none';
          header.style.opacity = '0.6';
          header.style.cursor = 'not-allowed';
        }
      });
      
      // También bloquear clics en elementos específicos del header
      hideElements('[title="Detalles del perfil"]');
      hideElements('[role="button"][title*="Detalles"]');
      
      // Bloquear divs clickeables del header
      const headerClickables = document.querySelectorAll('header [role="button"]');
      headerClickables.forEach(el => {
        if (!el.querySelector('[data-icon="search-refreshed"]')) { // No bloquear búsqueda
          el.style.pointerEvents = 'none';
          el.style.opacity = '0.6';
        }
      });
      
      // Bloquear el cuadro de búsqueda de nuevos chats
      const searchBox = document.querySelector('[role="textbox"][title*="Buscar"]');
      if (searchBox && numbers.length > 0) {
        searchBox.setAttribute('readonly', 'true');
        searchBox.style.pointerEvents = 'none';
        searchBox.style.opacity = '0.5';
      }
      
      // Ocultar cualquier botón que tenga el SVG de new-chat-outline
      const newChatButtons = document.querySelectorAll('button');
      newChatButtons.forEach(btn => {
        const svg = btn.querySelector('svg[viewBox="0 0 24 24"]');
        if (svg) {
          const title = svg.querySelector('title');
          if (title && title.textContent === 'new-chat-outline') {
            btn.style.display = 'none';
            btn.style.visibility = 'hidden';
            btn.style.pointerEvents = 'none';
          }
        }
      });
      
      // Ocultar cualquier botón que tenga el SVG de more-refreshed
      newChatButtons.forEach(btn => {
        const svg = btn.querySelector('svg[viewBox="0 0 24 24"]');
        if (svg) {
          const title = svg.querySelector('title');
          if (title && title.textContent === 'more-refreshed') {
            btn.style.display = 'none';
            btn.style.visibility = 'hidden';
            btn.style.pointerEvents = 'none';
          }
        }
      });
      
      // Bloquear menú contextual en mensajes del chat
      const blockMessageContextMenu = () => {
        const messagesContainer = document.querySelector('[data-testid="conversation-panel-messages"]');
        if (!messagesContainer) return;

        if (window.__anaManualMessageContextMenuBlocked) return;
        window.__anaManualMessageContextMenuBlocked = true;

        const shouldAllow = (target) => {
          try {
            if (!target) return false;
            if (target.getAttribute && target.getAttribute('contenteditable') === 'true') return true;
            if (target.closest && target.closest('[contenteditable="true"]')) return true;
            const tag = String(target.tagName || '').toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA') return true;

            // Permitir abrir fotos (preview/visor)
            const photoButton =
              (target.closest &&
                target.closest('[role="button"][aria-label="Abrir foto"], [role="button"][aria-label="Open photo"]')) ||
              null;
            if (photoButton) return true;
            return false;
          } catch (_) {
            return false;
          }
        };

        messagesContainer.addEventListener(
          'contextmenu',
          (e) => {
            const target = e.target;
            if (shouldAllow(target)) return;
            const messageElement = target && target.closest ? target.closest('[data-id]') : null;
            if (messageElement && messageElement.getAttribute && messageElement.getAttribute('data-id')) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              return false;
            }
          },
          true
        );

        // Bloquear teclas que suelen abrir acciones sobre mensajes (por ejemplo Delete)
        if (!window.__anaManualMessageKeyBlocker) {
          window.__anaManualMessageKeyBlocker = (e) => {
            try {
              const k = String(e.key || '').toLowerCase();
              if (k === 'delete' || k === 'backspace') {
                const active = document.activeElement;
                if (active && (active.getAttribute?.('contenteditable') === 'true' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
              }
            } catch (_) {}
          };
          document.addEventListener('keydown', window.__anaManualMessageKeyBlocker, true);
        }

        messagesContainer.addEventListener(
          'click',
          (e) => {
            const target = e.target;
            if (shouldAllow(target)) return;
            const messageElement = target && target.closest ? target.closest('[data-id]') : null;
            if (messageElement && messageElement.getAttribute && messageElement.getAttribute('data-id')) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              return false;
            }
          },
          true
        );
        
        // Ocultar cualquier menú contextual que aparezca
        const contextMenus = document.querySelectorAll('[role="application"]');
        contextMenus.forEach(menu => {
          const menuItems = menu.querySelectorAll('[role="button"]');
          if (menuItems.length > 0) {
            // Si tiene opciones como "Info. del mensaje", "Responder", etc.
            const hasMessageOptions = Array.from(menuItems).some(item => 
              item.textContent.includes('Info') || 
              item.textContent.includes('Responder') ||
              item.textContent.includes('Reaccionar') ||
              item.textContent.includes('Descargar')
            );
            if (hasMessageOptions) {
              menu.style.display = 'none';
              menu.style.visibility = 'hidden';
              menu.style.pointerEvents = 'none';
              menu.remove();
            }
          }
        });
      };
      
      // Ejecutar bloqueo inicial
      blockMessageContextMenu();
      
      // Observar nuevos mensajes para aplicar el bloqueo
      if (!window.__anaManualMessageObserver) {
        window.__anaManualMessageObserver = new MutationObserver(() => {
          blockMessageContextMenu();
        });
        const chatContainer = document.querySelector('#main');
        if (chatContainer) {
          window.__anaManualMessageObserver.observe(chatContainer, {
            childList: true,
            subtree: true
          });
        }
      }

      // Bloquear menú/contextmenu de la lista de chats (evita eliminar/archivar)
      if (!window.__anaManualChatListBlockerInstalled) {
        window.__anaManualChatListBlockerInstalled = true;
        const pane = document.querySelector('#pane-side');
        if (pane) {
          const shouldAllowPane = (target) => {
            try {
              if (!target) return false;
              if (target.getAttribute && target.getAttribute('contenteditable') === 'true') return true;
              if (target.closest && target.closest('[contenteditable="true"]')) return true;
              const tag = String(target.tagName || '').toUpperCase();
              if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
              // permitir click normal sobre el row para abrir chat
              const isRow = target.closest && target.closest('[role="row"], [role="listitem"]');
              const isMenuButton = target.closest && target.closest('button[aria-label*="Menú"], button[aria-label*="Menu"], [data-icon="down"], [data-icon="chevron-down"], [data-icon="more"], [data-icon="more-refreshed"]');
              if (isRow && !isMenuButton) return true;
              return false;
            } catch (_) {
              return false;
            }
          };

          pane.addEventListener(
            'contextmenu',
            (e) => {
              const target = e.target;
              if (shouldAllowPane(target)) return;
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              return false;
            },
            true
          );

          pane.addEventListener(
            'click',
            (e) => {
              const target = e.target;
              if (shouldAllowPane(target)) return;
              // bloquear específicamente clicks en menú/flecha de cada chat
              const isMenuButton = target && target.closest && target.closest('button[aria-label*="Menú"], button[aria-label*="Menu"], [data-icon="down"], [data-icon="chevron-down"], [data-icon="more"], [data-icon="more-refreshed"]');
              if (!isMenuButton) return;
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              return false;
            },
            true
          );
        } else {
          window.__anaManualChatListBlockerInstalled = false;
        }
      }
      
      // Agregar overlay informativo
      if (!document.getElementById('manual-mode-indicator')) {
        const indicator = document.createElement('div');
        indicator.id = 'manual-mode-indicator';
        indicator.style.cssText = `
          position: fixed;
          top: 70px;
          right: 10px;
          background: rgba(37, 211, 102, 0.95);
          color: white;
          padding: 10px 20px;
          border-radius: 10px;
          font-family: Arial, sans-serif;
          font-size: 14px;
          font-weight: bold;
          z-index: 999998;
          box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        indicator.innerHTML = '💬 Modo Manual - Solo Respuestas';
        document.body.appendChild(indicator);
      }
      
      // Si hay contactos permitidos, agregar lista
      if (numbers.length > 0 && !document.getElementById('allowed-contacts-info')) {
        const info = document.createElement('div');
        info.id = 'allowed-contacts-info';
        info.style.cssText = `
          position: fixed;
          bottom: 10px;
          right: 10px;
          background: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 15px;
          border-radius: 10px;
          font-family: Arial, sans-serif;
          font-size: 12px;
          z-index: 999998;
          max-width: 300px;
          max-height: 200px;
          overflow-y: auto;
        `;
        info.innerHTML = `
          <div style="font-weight: bold; margin-bottom: 5px;">📋 Contactos en automatización:</div>
          <div style="opacity: 0.8;">${numbers.length} contacto(s)</div>
        `;
        document.body.appendChild(info);
      }
    };

    window.applyManualUIRestrictions = () => {
      const now = Date.now();
      if (__anaManualApplyScheduled) return;
      if (now - __anaManualLastApplyAt < 1500) {
        __anaManualApplyScheduled = true;
        setTimeout(() => {
          __anaManualApplyScheduled = false;
          __anaManualLastApplyAt = Date.now();
          try {
            runApplyManualUIRestrictions();
          } catch (_) {}
        }, 1500);
        return;
      }

      __anaManualLastApplyAt = now;
      try {
        runApplyManualUIRestrictions();
      } catch (_) {}
    };

  // Aplicar restricciones cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Esperar un poco más para asegurar que WhatsApp Web esté completamente cargado
      setTimeout(window.applyManualUIRestrictions, 1000);
    });
  } else {
    // Si ya está cargado, aplicar inmediatamente y luego después de un delay
    window.applyManualUIRestrictions();
    setTimeout(window.applyManualUIRestrictions, 1000);
    setTimeout(window.applyManualUIRestrictions, 3000);
  }

  // Aplicar restricciones cada segundo
  if (!window.__anaManualRestrictionsInterval) {
    window.__anaManualRestrictionsInterval = setInterval(window.applyManualUIRestrictions, 5000);
  }

  // Observar cambios en el DOM
  if (!window.__anaManualRestrictionsObserver) {
    window.__anaManualRestrictionsObserver = new MutationObserver(() => {
      window.applyManualUIRestrictions();
    });
    if (document.documentElement) {
      window.__anaManualRestrictionsObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    } else {
      // Si el DOM aún no está listo, esperar
      document.addEventListener('DOMContentLoaded', () => {
        window.__anaManualRestrictionsObserver.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      });
    }
  }
}, allowedNumbers);
}

/**
 * Cierra el navegador manual
 */
export async function closeManualBrowser() {
  if (manualBrowser) {
    console.log('🔒 Cerrando navegador manual...');
    await manualBrowser.close();
  }
}

/**
 * Obtiene la instancia de la página manual
 */
export function getManualPage() {
  return manualPage;
}

/**
 * Inicializa el sistema de respaldo automático de conversaciones
 */
async function initChatBackupSystem(page, agentConfig) {
  if (!agentConfig || !agentConfig.agent_id || !agentConfig.campaign) {
    console.log('⚠️  No hay configuración de agente, sistema de respaldo no disponible');
    return;
  }

  await page.addInitScript((config) => {
    // Función helper para logging que funciona tanto en navegador como en Node.js
    const log = (...args) => {
      if (typeof window.logToNodeConsole === 'function') {
        window.logToNodeConsole(...args);
      } else {
        console.log(...args);
      }
    };
    
    log('[ChatBackup] 🚀 Sistema de respaldo inicializando...', config);
    
    // Guardar config globalmente para que el botón de historial pueda acceder
    window.manualConfig = config;
    
    let currentChatPhone = null;
    let isFirstBackup = true;
    let isBackingUp = false;
    let messageObserver = null;
    let backupCheckInterval = null;
    let backupIntervalActive = false; // Flag para prevenir múltiples intervalos

    let lastPhoneCandidate = null;
    let phoneStableStreak = 0;
    let nullPhoneStreak = 0;
    let lastChatSwitchAt = 0;
    
    // Función para normalizar números de teléfono
    const normalizePhoneForBackend = (rawPhone) => {
      const digits = String(rawPhone || '').replace(/\D/g, '');
      if (!digits) return '';

      let normalized = digits;

      // Si viene sin lada (10 dígitos), asumir México móvil
      if (normalized.length === 10) {
        normalized = '521' + normalized; // México móvil: 521 + 10 dígitos
      }

      // Si ya tiene 521 y 13 dígitos, está correcto
      if (normalized.startsWith('521') && normalized.length === 13) {
        return normalized;
      }

      // Si tiene 52 sin el 1 y 12 dígitos, agregar el 1
      if (normalized.startsWith('52') && !normalized.startsWith('521') && normalized.length === 12) {
        normalized = '521' + normalized.slice(2);
      }

      return normalized;
    };

    // Función para calcular hash simple de mensajes
    const calculateMessagesHash = (messages) => {
      const str = JSON.stringify(messages.map(m => ({
        id: m.id,
        timestamp: m.timestamp,
        body: m.body,
        from: m.from
      })));
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(36);
    };

    // Función para extraer mensajes del chat actual (versión robusta)
    const extractCurrentChatMessages = () => {
      const messages = [];
      const mainContainer = document.querySelector('#main');
      if (!mainContainer) return messages;
      
      // Buscar contenedores de mensajes usando múltiples selectores
      let messageContainers = Array.from(
        mainContainer.querySelectorAll('[data-testid="msg-container-in"], [data-testid="msg-container-out"], [data-testid="msg-container"]')
      );

      // Fallback: usar data-pre-plain-text si no hay msg-container
      if (messageContainers.length === 0) {
        const prePlainNodes = Array.from(mainContainer.querySelectorAll('[data-pre-plain-text]'));
        const uniqueContainers = new Map();
        for (const node of prePlainNodes) {
          const c = node.closest('[data-testid="msg-container-in"], [data-testid="msg-container-out"], [data-id]') || node.closest('div');
          if (!c) continue;
          const key = c.getAttribute('data-id') || c.getAttribute('data-testid') || `${c.tagName}:${c.className}`;
          if (!uniqueContainers.has(key)) uniqueContainers.set(key, c);
        }
        messageContainers = Array.from(uniqueContainers.values());
      }
      
      messageContainers.forEach(container => {
        try {
          const dataId = container.getAttribute('data-id');
          const testId = container.getAttribute('data-testid') || '';
          
          // Determinar si es mensaje saliente o entrante
          const isOutgoing = testId === 'msg-container-out' ||
                            (dataId && dataId.includes('true_')) ||
                            !!container.closest('.message-out') ||
                            !!container.querySelector('.message-out') ||
                            !!container.querySelector('[data-icon="msg-dblcheck"]') ||
                            !!container.querySelector('[data-icon="msg-check"]');
          
          const isIncoming = testId === 'msg-container-in' ||
                            !!container.closest('.message-in') ||
                            !!container.querySelector('.message-in');
          
          // Obtener texto del mensaje con múltiples selectores
          const textElement = container.querySelector('span.selectable-text.copyable-text span') ||
                             container.querySelector('span._ao3e.copyable-text') ||
                             container.querySelector('[data-testid="conversation-text"]') ||
                             container.querySelector('div.copyable-text') ||
                             container.querySelector('[class*="copyable-text"] [class*="selectable-text"]');
          
          const text = textElement ? textElement.textContent : '';
          
          // Obtener timestamp
          const timeElement = container.querySelector('[data-pre-plain-text]') || container.closest('[data-pre-plain-text]');
          let timestamp = Date.now();
          if (timeElement) {
            const prePlainText = timeElement.getAttribute('data-pre-plain-text');
            if (prePlainText) {
              const match = prePlainText.match(/\[([^\]]+)\]/);
              if (match) timestamp = match[1];
            }
          }
          
          if (text && dataId) {
            messages.push({
              id: dataId || `msg_${messages.length}`,
              timestamp: timestamp,
              body: text,
              from: isOutgoing ? 'me' : 'them',
              type: 'text',
              direction: isOutgoing ? 'outgoing' : 'incoming'
            });
          }
        } catch (e) {
          // Ignorar errores en mensajes individuales
        }
      });
      
      return messages;
    };

    // Función para obtener el número del contacto actual (versión robusta)
    const getCurrentContactPhone = () => {
      const extractPhone = (raw) => {
        if (!raw) return null;
        const str = String(raw);
        const digits = str.replace(/\D/g, '');
        if (digits.length < 10) return null;

        // Solo aceptar candidatos que claramente parecen teléfono
        const looksLikePhone = str.includes('+') || digits.startsWith('52');
        if (!looksLikePhone) return null;

        return digits;
      };

      const mainContainer = document.querySelector('#main');
      const header = (mainContainer && mainContainer.querySelector('header')) || document.querySelector('#main header') || document.querySelector('header');
      
      if (header) {
        // Método 1: Del título del header
        const titleElement = header.querySelector('span[dir="auto"][title]');
        if (titleElement) {
          const title = titleElement.getAttribute('title');
          const phone = extractPhone(title);
          if (phone) return phone;
        }

        // Método 2: De spans con números (sin title)
        const dirAutoSpans = Array.from(header.querySelectorAll('span[dir="auto"]')).slice(0, 20);
        for (const s of dirAutoSpans) {
          const txt = (s.textContent || '').trim();
          if (!txt) continue;
          const phone = extractPhone(txt);
          if (phone) return phone;
        }

        // Método 3: De span con título que contiene +
        const phoneSpan = header.querySelector('span[title*="+"]');
        if (phoneSpan) {
          const phoneRaw = phoneSpan.getAttribute('title');
          const phone = extractPhone(phoneRaw);
          if (phone) return phone;
        }
      }

      // Método 4: Del data-id en el contenedor principal
      if (mainContainer) {
        const nodes = Array.from(mainContainer.querySelectorAll('[data-id]')).slice(0, 25);
        for (const n of nodes) {
          const dataId = n.getAttribute('data-id');
          // Ignorar grupos
          if (dataId && String(dataId).includes('@g.us')) continue;
          const phone = extractPhone(dataId);
          if (phone) return phone;
        }
      }

      // Método 5: Del chat seleccionado en el sidebar
      const selectedChat =
        document.querySelector('#pane-side [aria-selected="true"]') ||
        document.querySelector('#pane-side [aria-current="true"]') ||
        document.querySelector('#pane-side [role="row"][aria-selected="true"]') ||
        document.querySelector('#pane-side [role="gridcell"][aria-selected="true"]');

      if (selectedChat) {
        const dataIdCandidates = [];
        const direct = selectedChat.getAttribute('data-id');
        if (direct) dataIdCandidates.push(direct);
        const inner = selectedChat.querySelector('[data-id]');
        if (inner) {
          const innerId = inner.getAttribute('data-id');
          if (innerId) dataIdCandidates.push(innerId);
        }

        for (const candidate of dataIdCandidates) {
          if (String(candidate).includes('@g.us')) continue;
          const phone = extractPhone(candidate);
          if (phone) return phone;
        }
      }

      return null;
    };

    // Función para mostrar overlay de respaldo
    const showBackupOverlay = () => {
      let overlay = document.getElementById('chat-backup-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'chat-backup-overlay';
        overlay.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 30px 40px;
          border-radius: 15px;
          font-family: Arial, sans-serif;
          font-size: 16px;
          z-index: 999999999;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          text-align: center;
          min-width: 300px;
        `;
        overlay.innerHTML = `
          <div style="font-size: 40px; margin-bottom: 15px;">💾</div>
          <div style="font-weight: bold; margin-bottom: 10px;">Respaldando chat...</div>
          <div style="font-size: 14px; opacity: 0.8;">Verificando cambios en la nube</div>
        `;
        document.body.appendChild(overlay);
      }
      return overlay;
    };

    // Función para ocultar overlay de respaldo
    const hideBackupOverlay = () => {
      const overlay = document.getElementById('chat-backup-overlay');
      if (overlay) {
        overlay.remove();
      }
    };

    // Variable para el indicador de countdown
    let countdownIndicator = null;
    let countdownInterval = null;
    let countdownSeconds = 45;

    // Función para crear/actualizar el indicador de countdown
    const updateCountdownIndicator = () => {
      if (!countdownIndicator) {
        log('[ChatBackup] 📊 Creando indicador de countdown');
        countdownIndicator = document.createElement('div');
        countdownIndicator.id = 'backup-countdown-indicator';
        countdownIndicator.style.cssText = `
          position: fixed;
          top: 10px;
          right: 20px;
          background: rgba(0, 0, 0, 0.85);
          color: white;
          padding: 12px 16px;
          border-radius: 12px;
          font-family: Arial, sans-serif;
          font-size: 13px;
          font-weight: bold;
          z-index: 999999998;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          gap: 12px;
        `;
        document.body.appendChild(countdownIndicator);
        log('[ChatBackup] ✅ Indicador agregado al DOM');
      }

      const circumference = 2 * Math.PI * 18;
      const dashLength = (countdownSeconds / 45) * circumference;

      countdownIndicator.innerHTML = `
        <svg width="40" height="40" style="transform: rotate(-90deg);">
          <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
          <circle cx="20" cy="20" r="18" fill="none" stroke="#25D366" stroke-width="3"
                  stroke-dasharray="${dashLength} ${circumference}"
                  stroke-linecap="round"
                  style="transition: stroke-dasharray 1s linear;"/>
          <text x="20" y="25" text-anchor="middle" fill="white" font-size="14" font-weight="bold"
                style="transform: rotate(90deg); transform-origin: 20px 20px;">${countdownSeconds}</text>
        </svg>
        <div>
          <div style="font-size: 12px; opacity: 0.9;">Próximo respaldo</div>
          <div style="font-size: 11px; opacity: 0.7;">${countdownSeconds}s</div>
        </div>
      `;
    };

    // Función para iniciar el countdown
    const startCountdown = () => {
      log('[ChatBackup] 🕐 Iniciando countdown');
      countdownSeconds = 45;
      updateCountdownIndicator();

      if (countdownInterval) {
        clearInterval(countdownInterval);
      }

      countdownInterval = setInterval(() => {
        countdownSeconds--;
        if (countdownSeconds < 0) {
          countdownSeconds = 45;
        }
        updateCountdownIndicator();
      }, 1000);
      
      log('[ChatBackup] ✅ Countdown iniciado, indicador visible');
    };

    // Función para detener el countdown
    const stopCountdown = () => {
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      if (countdownIndicator) {
        countdownIndicator.remove();
        countdownIndicator = null;
      }
    };

    // Función para mostrar toast pequeño (no intrusivo)
    const showBackupToast = (message, type = 'info') => {
      // Eliminar cualquier toast existente para evitar que se encimen
      const existingToast = document.getElementById('backup-toast');
      if (existingToast) {
        existingToast.remove();
      }
      
      const toast = document.createElement('div');
      toast.id = 'backup-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? 'rgba(37, 211, 102, 0.95)' : 
                      type === 'info' ? 'rgba(100, 100, 100, 0.95)' : 
                      'rgba(255, 107, 107, 0.95)'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-size: 13px;
        font-weight: 500;
        z-index: 999999999;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        animation: slideInUp 0.3s ease;
        max-width: 300px;
      `;
      
      const now = new Date();
      const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      
      toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="font-size: 16px;">${type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : '⚠️'}</div>
          <div style="flex: 1;">
            <div>${message}</div>
            <div style="font-size: 10px; opacity: 0.8; margin-top: 2px;">${timeStr}</div>
          </div>
        </div>
      `;
      
      document.body.appendChild(toast);
      
      setTimeout(() => {
        toast.style.animation = 'slideOutDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    };

    // Función para mostrar popup de notificación (solo primer respaldo)
    const showBackupNotification = (message, type = 'info') => {
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${type === 'success' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 
                      type === 'info' ? 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' : 
                      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'};
        color: white;
        padding: 15px 20px;
        border-radius: 12px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        z-index: 999999999;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        animation: slideInRight 0.3s ease;
        max-width: 350px;
      `;
      
      const now = new Date();
      const timestamp = now.toLocaleString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="font-size: 24px;">${type === 'success' ? '✅' : type === 'info' ? '📋' : 'ℹ️'}</div>
          <div style="flex: 1;">
            <div style="margin-bottom: 5px;">${message}</div>
            <div style="font-size: 11px; opacity: 0.9;">${timestamp}</div>
          </div>
        </div>
      `;
      
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
      }, 4000);
    };

    // Función para respaldar la conversación completa
    const backupFullConversation = async (phoneNumber, showUI = true) => {
      if (isBackingUp) {
        log('[ChatBackup] ⏸️ Respaldo en progreso, saltando...');
        return;
      }
      isBackingUp = true;
      
      // Pausar el countdown mientras se ejecuta el respaldo
      stopCountdown();
      
      // Normalizar el número de teléfono (521 -> 52)
      const normalizedPhone = normalizePhoneForBackend(phoneNumber);
      log('[ChatBackup] Número original:', phoneNumber, '-> Normalizado:', normalizedPhone);
      
      try {
        log('[ChatBackup] Respaldando conversación completa para:', normalizedPhone);
        
        // Extraer todos los mensajes
        const messages = extractCurrentChatMessages();
        if (messages.length === 0) {
          log('[ChatBackup] No hay mensajes para respaldar');
          return;
        }
        
        // Calcular hash local
        const localHash = calculateMessagesHash(messages);
        log('[ChatBackup] Hash local:', localHash, 'Total mensajes:', messages.length);
        
        // Obtener backup del backend
        const backupData = await window.getChatBackupFromBackend(
          config.campaign,
          config.agent_id,
          normalizedPhone
        );
        
        let shouldBackup = true;
        
        if (backupData.success && backupData.data && backupData.data.messages) {
          const remoteHash = calculateMessagesHash(backupData.data.messages);
          log('[ChatBackup] Hash remoto:', remoteHash);
          
          if (localHash === remoteHash) {
            log('[ChatBackup] ✅ Hashes coinciden, no es necesario respaldar');
            shouldBackup = false;
            if (showUI) {
              showBackupNotification('No hay cambios en el chat', 'info');
            }
          } else {
            log('[ChatBackup] ⚠️ Hashes diferentes, respaldando...');
          }
        } else {
          log('[ChatBackup] No existe backup previo, creando nuevo...');
        }
        
        if (shouldBackup) {
          const result = await window.saveChatBackupToBackend(
            config.campaign,
            config.agent_id,
            normalizedPhone,
            messages
          );
          
          if (result.success) {
            log('[ChatBackup] ✅ Conversación respaldada:', result.stats);
            if (showUI) {
              showBackupNotification(`Chat respaldado (${result.stats.new_messages} nuevos mensajes)`, 'success');
              isFirstBackup = false;
            }
          } else {
            console.error('[ChatBackup] ❌ Error al respaldar:', result.message);
            if (showUI) {
              showBackupNotification('Error al respaldar chat', 'error');
            }
          }
        }
      } catch (error) {
        console.error('[ChatBackup] Error en backupFullConversation:', error);
      } finally {
        isBackingUp = false;
        // Reanudar el countdown después de completar el respaldo
        startCountdown();
      }
    };

    // Función para respaldar un mensaje individual (sin UI)
    const backupSingleMessage = async (phoneNumber, message) => {
      try {
        const normalizedPhone = normalizePhoneForBackend(phoneNumber);
        log('[ChatBackup] Respaldando mensaje individual para:', normalizedPhone);
        
        const result = await window.saveChatBackupToBackend(
          config.campaign,
          config.agent_id,
          normalizedPhone,
          [message]
        );
        
        if (result.success) {
          log('[ChatBackup] ✅ Mensaje respaldado:', result.stats);
          // No mostrar notificación para mensajes individuales, solo en verificación de 3 segundos
        }
      } catch (error) {
        console.error('[ChatBackup] Error al respaldar mensaje:', error);
      }
    };

    // Observar cambios de chat (polling cada segundo)
    const observeChatChanges = () => {
      const phoneNumberCandidate = getCurrentContactPhone();

      if (phoneNumberCandidate) {
        nullPhoneStreak = 0;
        if (phoneNumberCandidate === lastPhoneCandidate) {
          phoneStableStreak++;
        } else {
          lastPhoneCandidate = phoneNumberCandidate;
          phoneStableStreak = 1;
        }
      } else {
        nullPhoneStreak++;
        phoneStableStreak = 0;
        lastPhoneCandidate = null;
      }

      const phoneNumber = phoneStableStreak >= 2 ? phoneNumberCandidate : null;

      // Detectar cambio de chat
      if (phoneNumber && phoneNumber !== currentChatPhone) {
        const now = Date.now();
        if (now - lastChatSwitchAt < 1500) {
          return;
        }
        lastChatSwitchAt = now;
        log('[ChatBackup] 🔄 Cambio de chat detectado:', phoneNumber);
        currentChatPhone = phoneNumber;
        isFirstBackup = true; // Resetear flag para el nuevo chat
        
        // Limpiar intervalo anterior si existe
        if (backupCheckInterval) {
          log('[ChatBackup] 🧹 Limpiando intervalo anterior');
          clearInterval(backupCheckInterval);
          backupCheckInterval = null;
          backupIntervalActive = false;
        }
        
        // Detener countdown anterior
        stopCountdown();
        
        // Respaldar conversación completa al entrar al chat (con UI)
        setTimeout(() => {
          backupFullConversation(phoneNumber, true);
          // Iniciar countdown después del primer respaldo
          setTimeout(() => {
            startCountdown();
          }, 500);
        }, 500);
        
        // Iniciar observador de mensajes nuevos (DESHABILITADO - solo usar intervalo de 15s)
        // startMessageObserver(phoneNumber);
        
        // Iniciar verificación automática cada 15 segundos (solo si no hay uno activo)
        if (!backupIntervalActive) {
          log('[ChatBackup] ⏰ Iniciando intervalo de respaldo cada 45 segundos');
          backupIntervalActive = true;
          backupCheckInterval = setInterval(() => {
            log('[ChatBackup] ⏰ Ejecutando respaldo programado (45)');
            const currentPhone = getCurrentContactPhone();
            if (currentPhone === phoneNumber) {
              // El respaldo pausará y reanudará el countdown automáticamente
              backupFullConversation(phoneNumber, true);
            } else {
              log('[ChatBackup] ⚠️ Chat cambió, saltando respaldo programado');
            }
          }, 45000);
        } else {
          log('[ChatBackup] ⚠️ Ya hay un intervalo activo, no se crea otro');
        }
      } else if (nullPhoneStreak >= 3 && currentChatPhone) {
        // Se salió del chat
        log('[ChatBackup] 🚪 Salió del chat');
        currentChatPhone = null;
        stopCountdown();
        if (backupCheckInterval) {
          log('[ChatBackup] 🧹 Limpiando intervalo al salir del chat');
          clearInterval(backupCheckInterval);
          backupCheckInterval = null;
          backupIntervalActive = false;
        }
      }
    };

    // Observar mensajes nuevos en tiempo real
    const startMessageObserver = (phoneNumber) => {
      if (messageObserver) {
        messageObserver.disconnect();
      }
      
      const messagesContainer = document.querySelector('[data-testid="conversation-panel-messages"]');
      if (!messagesContainer) {
        log('[ChatBackup] No se encontró contenedor de mensajes');
        return;
      }
      
      let lastMessageCount = 0;
      
      messageObserver = new MutationObserver(() => {
        const messages = extractCurrentChatMessages();
        
        if (messages.length > lastMessageCount) {
          // Hay mensajes nuevos
          const newMessages = messages.slice(lastMessageCount);
          log('[ChatBackup] 📨 Nuevos mensajes detectados:', newMessages.length);
          
          // Respaldar cada mensaje nuevo
          newMessages.forEach(msg => {
            backupSingleMessage(phoneNumber, msg);
          });
        }
        
        lastMessageCount = messages.length;
      });
      
      messageObserver.observe(messagesContainer, {
        childList: true,
        subtree: true
      });
      
      log('[ChatBackup] 👀 Observador de mensajes iniciado para:', phoneNumber);
    };

    // Iniciar sistema con polling cada segundo
    log('[ChatBackup] 🚀 Sistema de respaldo automático inicializado');
    
    // Ejecutar primera verificación después de 2 segundos
    setTimeout(() => {
      observeChatChanges();
      // Luego ejecutar cada segundo
      setInterval(observeChatChanges, 1000);
    }, 2000);
  }, agentConfig);
  
  console.log('[ChatBackup] Script de respaldo inyectado correctamente');
}

function normalizePhoneForBackend(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';

  let normalized = digits;

  // México: WhatsApp a veces usa 521 + 10 dígitos. Backend requiere 52 + 10 dígitos.
  if (normalized.startsWith('521') && normalized.length >= 13) {
    normalized = `52${normalized.slice(3)}`;
  }

  // Si viene sin lada (10 dígitos), asumir México
  if (!normalized.startsWith('52') && normalized.length === 10) {
    normalized = `52${normalized}`;
  }

  if (!normalized.startsWith('52')) return '';
  if (normalized.length < 12) return '';

  return `+${normalized}`;
}

async function fetchResultCodesFromBackend(campaignName) {
  if (cachedResultCodesByCampaign.has(campaignName)) {
    return cachedResultCodesByCampaign.get(campaignName);
  }

  const url = `${INTERACTIONS_API_BASE_URL}/result-codes/${encodeURIComponent(campaignName)}`;
  try {
    const response = await fetch(url);
    const rawText = await response.text().catch(() => '');
    const data = rawText ? JSON.parse(rawText) : {};
    const resultCodes = Array.isArray(data.result_codes) ? data.result_codes : [];
    if (!response.ok || resultCodes.length === 0) {
      console.log('[Gestion][result-codes] url=', url);
      console.log('[Gestion][result-codes] status=', response.status);
      console.log('[Gestion][result-codes] body=', rawText);
    }
    cachedResultCodesByCampaign.set(campaignName, resultCodes);
    return resultCodes;
  } catch (error) {
    console.error('❌ Error al obtener result codes:', error.message);
    return [];
  }
}

async function searchClientInfoByPhone(campaignName, phone) {
  const url = `${INTERACTIONS_API_BASE_URL}/client-info`;
  try {
    const payload = {
      campaign_name: campaignName,
      search_type: 'Telefono',
      search_value: phone,
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text().catch(() => '');
    const data = rawText ? JSON.parse(rawText) : {};
    const result = Array.isArray(data.result) ? data.result : [];
    if (!response.ok || result.length === 0) {
      console.log('[Gestion][client-info] url=', url);
      console.log('[Gestion][client-info] payload=', payload);
      console.log('[Gestion][client-info] status=', response.status);
      console.log('[Gestion][client-info] body=', rawText);
    }
    return result;
  } catch (error) {
    console.error('❌ Error al buscar client-info:', error.message);
    return [];
  }
}

async function injectGestionButton(page) {
  const config = loadAgentConfig();
  if (!config) {
    console.log('⚠️  No hay configuración de agente, botón de gestión no disponible');
    return;
  }

  const rawCampaign = config.campaign || '';
  const campaignName = rawCampaign.includes('-') ? rawCampaign.split('-').slice(1).join('-') : rawCampaign;
  const INTERACTIONS_USER_ID = '6898b89b-ab72-4196-92b1-70d51781f68f';

  await page.exposeFunction('getGestionDataFromBackend', async (phoneDigits) => {
    const phoneE164 = normalizePhoneForBackend(phoneDigits);
    console.log('[Gestion] getGestionDataFromBackend campaign=', campaignName, 'phoneDigits=', phoneDigits, 'phoneE164=', phoneE164);
    const [resultCodes, clientInfo] = await Promise.all([
      fetchResultCodesFromBackend(campaignName),
      searchClientInfoByPhone(campaignName, phoneE164),
    ]);
    console.log('[Gestion] fetched resultCodes=', Array.isArray(resultCodes) ? resultCodes.length : 'n/a', 'clientInfo=', Array.isArray(clientInfo) ? clientInfo.length : 'n/a');
    return { campaignName, phoneE164, resultCodes, clientInfo };
  });

  await page.exposeFunction('submitGestionInteraction', async (payload) => {
    const now = new Date();
    const contact_date = now.toISOString().slice(0, 10);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nextH = String((now.getHours() + 1) % 24).padStart(2, '0');

    const interaction = {
      credit_id: String(payload.credit_id || ''),
      campaign_name: String(campaignName || ''),
      user_id: INTERACTIONS_USER_ID,
      subdictamen: String(payload.subdictamen || ''),
      contact_date,
      contact_time: `${hh}:${mm}`,
      range_time: `${hh}:00 - ${nextH}:00`,
      action_channel: 'whatsapp',
      action: 'whatsapp',
      contactable: payload.contactable === true,
      phone_number: String(payload.phone_number || ''),
      email_address: null,
      template_used: null,
      comments: String(payload.comments || ''),
      promise_date: payload.promise_date || null,
      promise_amount: payload.promise_amount || null,
      promise_payment_plan: payload.promise_payment_plan || null,
      inoutbound: 'inbound',
      payment_made_date: payload.payment_made_date || null,
    };

    return await insertInteractions([interaction]);
  });

  await page.addInitScript(() => {
    const ensureStyles = () => {
      if (document.getElementById('gestion-styles')) return;
      const style = document.createElement('style');
      style.id = 'gestion-styles';
      style.textContent = `
        #gestion-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 99999998; backdrop-filter: blur(2px); }
        #gestion-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); background: #fff; border-radius: 16px; width: 720px; max-width: calc(100vw - 40px); max-height: 85vh; overflow: hidden; z-index: 99999999; font-family: Arial, sans-serif; }
        #gestion-modal header { background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: #fff; padding: 16px 18px; display:flex; align-items:center; justify-content: space-between; }
        #gestion-modal header h2 { margin:0; font-size: 18px; }
        #gestion-modal header button { background: rgba(255,255,255,.2); border:none; color:#fff; width: 32px; height: 32px; border-radius: 50%; font-size: 20px; cursor:pointer; }
        #gestion-body { padding: 16px 18px; overflow:auto; max-height: calc(85vh - 64px); }
        .gestion-card { border: 1px solid #eee; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
        .gestion-label { font-size: 12px; color: #666; margin-bottom: 6px; }
        .gestion-input, .gestion-select { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 10px; }
        .gestion-actions { display:flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
        .gestion-btn { padding: 10px 14px; border-radius: 10px; border: none; cursor: pointer; font-weight: bold; }
        .gestion-btn-primary { background: #25D366; color: #fff; }
        .gestion-btn-secondary { background: #f0f0f0; color: #333; }
        .gestion-small { font-size: 12px; color: #777; }
        .gestion-error { color: #c0392b; font-size: 12px; white-space: pre-wrap; }
      `;
      document.head.appendChild(style);
    };

    const getCurrentContactPhone = () => {
      const debug = {
        headerTitle: null,
        headerPhoneSpan: null,
        mainDataId: null,
        sidebarSelectedDataId: null,
        sidebarSelectedText: null,
      };

      const extractPhone = (raw) => {
        if (!raw) return null;
        const str = String(raw);
        const digits = str.replace(/\D/g, '');
        if (digits.length < 10) return null;

        // Solo aceptar candidatos que claramente parecen teléfono
        const looksLikePhone = str.includes('+') || digits.startsWith('52');
        if (!looksLikePhone) return null;

        // Mantener lada si viene (52 o 521). La normalización final se hace en Node.
        return digits;
      };

      const mainContainer = document.querySelector('#main');
      const header = (mainContainer && mainContainer.querySelector('header')) || document.querySelector('#main header') || document.querySelector('header');
      if (header) {
        const titleElement = header.querySelector('span[dir="auto"][title]');
        if (titleElement) {
          const title = titleElement.getAttribute('title');
          debug.headerTitle = title;
          const phone = extractPhone(title);
          if (phone) return phone;
        }

        // En muchas versiones el número viene como texto (sin title)
        const dirAutoSpans = Array.from(header.querySelectorAll('span[dir="auto"]')).slice(0, 20);
        for (const s of dirAutoSpans) {
          const txt = (s.textContent || '').trim();
          if (!txt) continue;
          if (!debug.headerTitle) debug.headerTitle = txt;
          const phone = extractPhone(txt);
          if (phone) return phone;
        }

        const phoneSpan = header.querySelector('span[title*="+"]');
        if (phoneSpan) {
          const phoneRaw = phoneSpan.getAttribute('title');
          debug.headerPhoneSpan = phoneRaw;
          const phone = extractPhone(phoneRaw);
          if (phone) return phone;
        }
      }

      if (mainContainer) {
        const nodes = Array.from(mainContainer.querySelectorAll('[data-id]')).slice(0, 25);
        for (const n of nodes) {
          const dataId = n.getAttribute('data-id');
          if (!debug.mainDataId && dataId) debug.mainDataId = dataId;
          // ignorar grupos
          if (dataId && String(dataId).includes('@g.us')) continue;
          const phone = extractPhone(dataId);
          if (phone) return phone;
        }
      }

      const selectedChat =
        document.querySelector('#pane-side [aria-selected="true"]') ||
        document.querySelector('#pane-side [aria-current="true"]') ||
        document.querySelector('#pane-side [role="row"][aria-selected="true"]') ||
        document.querySelector('#pane-side [role="gridcell"][aria-selected="true"]');

      if (selectedChat) {
        debug.sidebarSelectedText = (selectedChat.textContent || '').slice(0, 80);
        const dataIdCandidates = [];
        const direct = selectedChat.getAttribute('data-id');
        if (direct) dataIdCandidates.push(direct);
        const inner = selectedChat.querySelector('[data-id]');
        if (inner) {
          const innerId = inner.getAttribute('data-id');
          if (innerId) dataIdCandidates.push(innerId);
        }

        for (const candidate of dataIdCandidates) {
          if (!debug.sidebarSelectedDataId) debug.sidebarSelectedDataId = candidate;
          if (String(candidate).includes('@g.us')) continue;
          const phone = extractPhone(candidate);
          if (phone) return phone;
        }
      }

      if (typeof window.__anaLastChatDetectDebug === 'undefined') {
        window.__anaLastChatDetectDebug = null;
      }
      window.__anaLastChatDetectDebug = debug;

      return null;
    };

    const showNotification = (message, type = 'info') => {
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#ff6b6b' : type === 'success' ? '#25D366' : type === 'warning' ? '#f39c12' : '#3498db'};
        color: white;
        padding: 12px 18px;
        border-radius: 10px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        z-index: 999999999;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
      `;
      notification.textContent = message;
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 3000);
    };

    const closeGestionModal = () => {
      const overlay = document.getElementById('gestion-overlay');
      const modal = document.getElementById('gestion-modal');
      if (overlay) overlay.remove();
      if (modal) modal.remove();
    };

    const openGestionModal = async () => {
      const phoneDigits = getCurrentContactPhone();
      if (!phoneDigits) {
        const dbg = window.__anaLastChatDetectDebug;
        showNotification('⚠️ No pude detectar el chat. Abre un chat y vuelve a intentar.', 'warning');
        try {
          console.log('[ANA Gestion] Debug detección chat:', dbg);
        } catch (_) {}
        return;
      }

      ensureStyles();
      closeGestionModal();

      const overlay = document.createElement('div');
      overlay.id = 'gestion-overlay';
      overlay.onclick = () => closeGestionModal();

      const modal = document.createElement('div');
      modal.id = 'gestion-modal';
      modal.onclick = (e) => e.stopPropagation();
      modal.innerHTML = `
        <header>
          <div>
            <h2>⬆️ Subir gestión</h2>
            <div class="gestion-small" id="gestion-subtitle">Cargando...</div>
          </div>
          <button id="gestion-close">×</button>
        </header>
        <div id="gestion-body">
          <div class="gestion-card">⏳ Cargando catálogo y cliente...</div>
        </div>
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(modal);
      document.getElementById('gestion-close').onclick = () => closeGestionModal();

      const body = document.getElementById('gestion-body');
      const subtitle = document.getElementById('gestion-subtitle');

      try {
        const data = await window.getGestionDataFromBackend(phoneDigits);
        const resultCodes = Array.isArray(data.resultCodes) ? data.resultCodes : [];
        const visibleCodes = resultCodes.filter(rc => rc && rc.is_visible);
        const clientInfo = Array.isArray(data.clientInfo) ? data.clientInfo : [];

        subtitle.textContent = `Campaña: ${data.campaignName} | Tel: ${data.phoneE164}`;

        if (clientInfo.length === 0) {
          body.innerHTML = `<div class="gestion-card"><div class="gestion-error">No se encontró información de cliente para este teléfono.</div></div>`;
          return;
        }

        const creditOptions = clientInfo.map((item, idx) => {
          const clientName = item?.client_info?.full_name || 'Sin nombre';
          const creditId = item?.credit_info?.credit_id || '';
          const productName = item?.credit_info?.product_name || item?.credit_info?.product || '';
          return `
            <label style="display:block; padding:10px; border:1px solid #eee; border-radius:10px; margin-bottom:8px; cursor:pointer;">
              <input type="radio" name="gestion-credit" value="${creditId}" ${idx === 0 ? 'checked' : ''} />
              <strong style="margin-left:8px;">${clientName}</strong>
              <div class="gestion-small" style="margin-left:26px;">Crédito: ${creditId} | ${productName}</div>
            </label>
          `;
        }).join('');

        const subdictamenOptions = visibleCodes
          .map(rc => `<option value="${String(rc.subdictamen || '')}">${String(rc.dictamen || '').toUpperCase()} - ${String(rc.subdictamen || '')}</option>`)
          .join('');

        body.innerHTML = `
          <div class="gestion-card">
            <div class="gestion-label">Selecciona el crédito</div>
            ${creditOptions}
          </div>

          <div class="gestion-card">
            <div class="gestion-label">Selecciona el subdictamen</div>
            <select class="gestion-select" id="gestion-subdictamen">${subdictamenOptions}</select>
            <div style="margin-top:10px;">
              <div class="gestion-label">Comentarios</div>
              <input class="gestion-input" id="gestion-comments" placeholder="Ej: Cliente solicita información" />
            </div>
            <div style="margin-top:10px;">
              <div class="gestion-label">Contactable</div>
              <select class="gestion-select" id="gestion-contactable">
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </div>
            <div class="gestion-actions">
              <button class="gestion-btn gestion-btn-secondary" id="gestion-cancel">Cancelar</button>
              <button class="gestion-btn gestion-btn-primary" id="gestion-submit">Subir</button>
            </div>
            <div id="gestion-status" class="gestion-small" style="margin-top:10px;"></div>
          </div>
        `;

        document.getElementById('gestion-cancel').onclick = () => closeGestionModal();
        document.getElementById('gestion-submit').onclick = async () => {
          const statusEl = document.getElementById('gestion-status');
          statusEl.textContent = '⏳ Subiendo...';

          const creditId = (document.querySelector('input[name="gestion-credit"]:checked') || {}).value || '';
          const subdictamen = (document.getElementById('gestion-subdictamen') || {}).value || '';
          const comments = (document.getElementById('gestion-comments') || {}).value || '';
          const contactable = ((document.getElementById('gestion-contactable') || {}).value || 'true') === 'true';

          const payload = {
            credit_id: creditId,
            subdictamen,
            phone_number: data.phoneE164,
            contactable,
            comments,
          };

          const res = await window.submitGestionInteraction(payload);
          if (res && res.ok) {
            showNotification('✅ Gestión subida', 'success');
            statusEl.textContent = '✅ Gestión subida';
            setTimeout(() => closeGestionModal(), 800);
          } else {
            showNotification('❌ No se pudo subir gestión', 'error');
            statusEl.textContent = `❌ Error: ${res?.status || ''} ${res?.error || ''}`;
          }
        };
      } catch (e) {
        body.innerHTML = `<div class="gestion-card"><div class="gestion-error">${String(e?.message || e)}</div></div>`;
      }
    };

    const createGestionButton = () => {
      const existing = document.getElementById('gestion-btn');
      if (existing) return;

      const btn = document.createElement('button');
      btn.id = 'gestion-btn';
      btn.innerHTML = '⬆️ Subir gestión';
      btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 180px;
        background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
        color: white;
        padding: 12px 24px;
        border: none;
        border-radius: 25px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        z-index: 999998;
        box-shadow: 0 4px 15px rgba(18, 140, 126, 0.35);
        transition: all 0.3s ease;
      `;
      btn.onmouseover = () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.boxShadow = '0 6px 20px rgba(18, 140, 126, 0.55)';
      };
      btn.onmouseout = () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 4px 15px rgba(18, 140, 126, 0.35)';
      };
      btn.onclick = () => openGestionModal();
      document.body.appendChild(btn);
    };

    window.addEventListener('load', () => {
      setTimeout(() => createGestionButton(), 2000);
    });

    setInterval(() => {
      createGestionButton();
    }, 5000);
  });
}

/**
 * Obtiene el historial desde el backend (desde Node.js, no desde el navegador)
 */
async function fetchHistoryFromBackend(agentId, campaign) {
  try {
    const url = `${API_BASE_URL}/backups/latest/${agentId}/${campaign}`;
    console.log('📡 [Node.js] Obteniendo historial desde:', url);
    
    const response = await fetch(url);
    console.log('📡 [Node.js] Response status:', response.status);
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log('📭 [Node.js] No hay historial disponible');
        return { success: false, message: 'No hay historial disponible (últimos 4 días)' };
      }
      console.log('❌ [Node.js] Error en response:', response.statusText);
      return { success: false, message: 'Error al obtener historial' };
    }

    const data = await response.json();
    console.log('✅ [Node.js] Historial obtenido:', data);
    return data;
  } catch (error) {
    console.error('❌ [Node.js] Error fetching history:', error);
    return { success: false, message: 'Error de conexión' };
  }
}

/**
 * Inyecta el botón de historial en la interfaz
 */
async function injectHistoryButton(page) {
  const config = loadAgentConfig();
  if (!config) {
    console.log('⚠️  No hay configuración de agente, botón de historial no disponible');
    return;
  }

  // Exponer función para obtener historial desde Node.js
  console.log('📌 Exponiendo función getHistoryFromBackend para:', config.agent_id, '/', config.campaign);
  await page.exposeFunction('getHistoryFromBackend', async () => {
    console.log('🔔 getHistoryFromBackend llamada desde el navegador');
    return await fetchHistoryFromBackend(config.agent_id, config.campaign);
  });
  console.log('✅ Función getHistoryFromBackend expuesta correctamente');

  await page.addInitScript(() => {
    // Crear botón de historial
    const createHistoryButton = () => {
      // Remover botón existente si hay
      const existing = document.getElementById('history-btn');
      if (existing) existing.remove();

      const btn = document.createElement('button');
      btn.id = 'history-btn';
      btn.innerHTML = '📜 Ver Historial';
      btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 24px;
        border: none;
        border-radius: 25px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        z-index: 999998;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        transition: all 0.3s ease;
      `;

      btn.onmouseover = () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
      };

      btn.onmouseout = () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
      };

      btn.onclick = async () => {
        console.log('[Historial] Botón clickeado');

        // Siempre limpiar UI previa para evitar que se quede visible el historial del chat anterior
        const prevBubble = document.getElementById('history-bubble');
        if (prevBubble) prevBubble.remove();
        const prevOverlay = document.getElementById('history-overlay');
        if (prevOverlay) prevOverlay.remove();
        
        // Obtener número del contacto actual
        const phoneNumber = getCurrentContactPhone();
        console.log('[Historial] Número detectado:', phoneNumber);
        
        if (!phoneNumber) {
          console.log('[Historial] No hay número, mostrando notificación');
          showNotification('⚠️ Selecciona un chat primero', 'warning');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '⏳ Cargando...';

        try {
          console.log('[Historial] Obteniendo backup del chat actual...');
          
          // Verificar si la función existe
          if (typeof window.getChatBackupFromBackend !== 'function') {
            console.error('[Historial] ❌ window.getChatBackupFromBackend no está disponible');
            showNotification('❌ Error: Función no disponible', 'error');
            return;
          }
          
          // Obtener configuración del agente (debe estar disponible globalmente)
          const config = window.manualConfig || { campaign: 'monte_auto_avanza', agent_id: 'erick' };
          
          // Normalizar el número de teléfono antes de buscar el backup
          const normalizePhone = (rawPhone) => {
            const digits = String(rawPhone || '').replace(/\D/g, '');
            if (!digits) return '';
            let normalized = digits;
            if (normalized.length === 10) {
              normalized = '521' + normalized;
            }
            if (normalized.startsWith('521') && normalized.length === 13) {
              return normalized;
            }
            if (normalized.startsWith('52') && !normalized.startsWith('521') && normalized.length === 12) {
              normalized = '521' + normalized.slice(2);
            }
            return normalized;
          };
          
          const normalizedPhone = normalizePhone(phoneNumber);
          console.log('[Historial] Número normalizado:', phoneNumber, '->', normalizedPhone);
          
          // Obtener backup del chat actual usando el mismo endpoint que usa el sistema de respaldo
          const result = await window.getChatBackupFromBackend(
            config.campaign,
            config.agent_id,
            normalizedPhone
          );
          console.log('[Historial] Resultado recibido:', result);
          
          if (!result.success) {
            console.log('[Historial] Sin éxito:', result.message);
            showNotification(result.message || '📭 No hay historial disponible para este chat', 'info');
            return;
          }

          if (!result.data || !result.data.messages) {
            console.log('[Historial] No hay mensajes en el resultado');
            showNotification('📭 No hay mensajes respaldados para este chat', 'info');
            return;
          }

          const messages = result.data.messages;
          
          if (messages.length === 0) {
            console.log('[Historial] No se encontraron mensajes');
            showNotification(`📭 No hay mensajes en el respaldo`, 'info');
            return;
          }

          console.log('[Historial] Mostrando burbuja con', messages.length, 'mensajes');
          // Mostrar burbuja con historial
          showHistoryBubble(messages, phoneNumber, result.data.last_updated);

        } catch (error) {
          console.error('[Historial] Error:', error);
          showNotification('❌ Error al cargar historial', 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '📜 Ver Historial';
        }
      };

      document.body.appendChild(btn);
    };

    // Función para obtener el número del contacto actual
    const getCurrentContactPhone = () => {
      // Buscar el header del chat activo
      const mainContainer = document.querySelector('#main');
      const header = (mainContainer && mainContainer.querySelector('header')) || document.querySelector('#main header') || document.querySelector('header');
      if (!header) {
        console.log('[Historial] No se encontró header');
        return null;
      }

      // Método 1: Intentar obtener del título del header
      const titleElement = header.querySelector('span[dir="auto"][title]');
      if (titleElement) {
        const title = titleElement.getAttribute('title');
        console.log('[Historial] Título encontrado:', title);
        
        // Si el título es un número de teléfono, usarlo
        if (title && title.match(/^\+?\d+/)) {
          const phone = title.replace(/\D/g, '');
          console.log('[Historial] Número detectado del título:', phone);
          return phone;
        }
      }

      // Método 1b: En muchas versiones el número viene como texto (sin title)
      const dirAutoSpans = Array.from(header.querySelectorAll('span[dir="auto"]')).slice(0, 10);
      for (const s of dirAutoSpans) {
        const txt = (s.textContent || '').trim();
        if (!txt) continue;
        const digits = txt.replace(/\D/g, '');
        if (digits.length < 10) continue;
        const looksLikePhone = txt.includes('+') || digits.startsWith('52');
        if (!looksLikePhone) continue;
        const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
        console.log('[Historial] Número detectado de texto:', phone10);
        return phone10;
      }

      // Método 2: Buscar span con número de teléfono
      const phoneSpan = header.querySelector('span[title*="+"]');
      if (phoneSpan) {
        const phone = phoneSpan.getAttribute('title');
        if (phone) {
          const cleanPhone = phone.replace(/\D/g, '');
          console.log('[Historial] Número detectado de span:', cleanPhone);
          return cleanPhone;
        }
      }

      // Método 3: Buscar en el contenedor principal del chat
      if (mainContainer) {
        // Buscar data-id que contenga el número
        const chatHeader = mainContainer.querySelector('[data-id]');
        if (chatHeader) {
          const dataId = chatHeader.getAttribute('data-id');
          console.log('[Historial] data-id encontrado:', dataId);
          
          // Extraer número del data-id (formato: true_521234567890@c.us)
          const match = dataId.match(/(\d{10,15})@/);
          if (match) {
            const phone = match[1];
            console.log('[Historial] Número extraído de data-id:', phone);
            return phone;
          }
        }
      }

      console.log('[Historial] No se pudo detectar el número');
      return null;
    };

    // Función para buscar mensajes de un contacto en el backup
    const findMessagesForContact = (backupData, phoneNumber) => {
      console.log('[Historial] Buscando en backup:', backupData);
      
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      console.log('[Historial] Buscando número limpio:', cleanPhone);
      
      // Detectar tipo de backup
      if (backupData.type === 'chat_backup' && backupData.chats) {
        // Backup de chats (del botón "Respaldar Chats")
        console.log('[Historial] Tipo: chat_backup, Total de chats:', backupData.chats.length);
        
        // Buscar el chat que coincida con el número
        const matchingChat = backupData.chats.find(chat => {
          const chatPhone = chat.phone ? chat.phone.replace(/\D/g, '') : '';
          console.log('[Historial] Comparando chat:', chat.name, 'Phone:', chatPhone);
          return chatPhone.includes(cleanPhone) || cleanPhone.includes(chatPhone);
        });
        
        if (matchingChat) {
          console.log('[Historial] ✅ Chat encontrado:', matchingChat.name, 'con', matchingChat.messages.length, 'mensajes');
          // Retornar los mensajes del chat en formato compatible
          return matchingChat.messages.map(msg => ({
            ...msg,
            name: matchingChat.name,
            phone: matchingChat.phone,
            status: 'sent', // Los mensajes del backup son enviados
            sent_at: msg.timestamp
          }));
        }
        
        console.log('[Historial] No se encontró chat para el número');
        return [];
        
      } else if (backupData.results && Array.isArray(backupData.results)) {
        // Backup de resultados de envío (del proceso automático)
        console.log('[Historial] Tipo: results, Total de resultados:', backupData.results.length);
        
        const matches = backupData.results.filter(result => {
          const resultPhone = result.phone ? result.phone.replace(/\D/g, '') : '';
          console.log('[Historial] Comparando con:', resultPhone);
          
          const match = resultPhone.includes(cleanPhone) || cleanPhone.includes(resultPhone);
          if (match) {
            console.log('[Historial] ✅ Match encontrado:', result);
          }
          return match;
        });
        
        console.log('[Historial] Total de matches encontrados:', matches.length);
        return matches;
      }
      
      console.log('[Historial] Formato de backup no reconocido');
      return [];
    };

    // Función para mostrar la burbuja con el historial
    const showHistoryBubble = (messages, phoneNumber, date) => {
      // Remover burbuja y overlay existentes
      const existingBubble = document.getElementById('history-bubble');
      if (existingBubble) existingBubble.remove();
      
      const existingOverlay = document.getElementById('history-overlay');
      if (existingOverlay) existingOverlay.remove();

      const formatSentAt = (sentAt) => {
        if (sentAt === null || typeof sentAt === 'undefined') return 'Sin fecha';
        try {
          const raw = typeof sentAt === 'string' ? sentAt.trim() : sentAt;
          let d;
          if (typeof raw === 'number') {
            d = new Date(raw < 1e12 ? raw * 1000 : raw);
          } else if (typeof raw === 'string') {
            const asNumber = Number(raw);
            if (!Number.isNaN(asNumber) && raw !== '') {
              d = new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber);
            } else {
              d = new Date(raw);
            }
          } else {
            d = new Date(raw);
          }

          if (!d || Number.isNaN(d.getTime())) return 'Sin fecha';
          return d.toLocaleString('es-MX');
        } catch (_) {
          return 'Sin fecha';
        }
      };

      // Crear overlay oscuro
      const overlay = document.createElement('div');
      overlay.id = 'history-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 99999998;
        backdrop-filter: blur(2px);
      `;

      // Cerrar al hacer clic en el overlay
      overlay.onclick = () => {
        overlay.remove();
        const bubble = document.getElementById('history-bubble');
        if (bubble) bubble.remove();
      };

      const bubble = document.createElement('div');
      bubble.id = 'history-bubble';
      bubble.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 20px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        z-index: 99999999;
        width: 600px;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      `;

      // Prevenir que el clic en la burbuja cierre el overlay
      bubble.onclick = (e) => {
        e.stopPropagation();
      };

      const header = document.createElement('div');
      header.style.cssText = `
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      `;

      header.innerHTML = `
        <div>
          <h2 style="margin: 0; font-size: 20px;">📜 Historial de Mensajes</h2>
          <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.9;">Fecha: ${date} | Total: ${messages.length} mensaje(s)</p>
        </div>
        <button id="close-history-bubble" style="
          background: rgba(255, 255, 255, 0.2);
          border: none;
          color: white;
          font-size: 24px;
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        ">×</button>
      `;

      const content = document.createElement('div');
      content.style.cssText = `
        padding: 20px;
        overflow-y: auto;
        flex: 1;
      `;

      messages.forEach((msg, index) => {
        const msgDiv = document.createElement('div');
        
        // Determinar el tipo de mensaje basado en direction o from
        const isOutgoing = msg.direction === 'outgoing' || msg.from === 'me';
        const messageLabel = isOutgoing ? '📤 Enviado' : '📥 Recibido';
        const bgColor = isOutgoing ? '#e3f2fd' : '#f1f8e9'; // Azul claro para enviados, verde claro para recibidos
        const borderColor = isOutgoing ? '#2196F3' : '#4CAF50'; // Azul para enviados, verde para recibidos
        
        msgDiv.style.cssText = `
          margin-bottom: 15px;
          padding: 15px;
          background: ${bgColor};
          border-left: 4px solid ${borderColor};
          border-radius: 8px;
        `;
        
        msgDiv.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <strong style="color: #333;">${isOutgoing ? '📤 Yo' : '📥 ' + (msg.name || msg.contact_name || phoneNumber)}</strong>
            <span style="color: #666; font-size: 12px;">${msg.timestamp || msg.sent_at || msg.sentAt || 'Sin fecha'}</span>
          </div>
          <div style="color: #333; white-space: pre-wrap; margin-bottom: 8px; font-size: 14px;">
            ${msg.body || msg.message_sent || msg.message || msg.text || 'Sin mensaje'}
          </div>
          <div style="margin-top: 8px; font-size: 11px; color: #999;">
            Tipo: ${msg.type || 'text'}
          </div>
        `;

        content.appendChild(msgDiv);
      });

      bubble.appendChild(header);
      bubble.appendChild(content);
      
      // Agregar overlay primero, luego la burbuja
      document.body.appendChild(overlay);
      document.body.appendChild(bubble);
      
      // Auto-scroll al final para mostrar los mensajes más recientes
      setTimeout(() => {
        content.scrollTop = content.scrollHeight;
      }, 100);

      // Cerrar burbuja y overlay
      document.getElementById('close-history-bubble').onclick = () => {
        bubble.remove();
        overlay.remove();
      };

      // Cerrar con ESC
      const handleEsc = (e) => {
        if (e.key === 'Escape') {
          bubble.remove();
          overlay.remove();
          document.removeEventListener('keydown', handleEsc);
        }
      };
      document.addEventListener('keydown', handleEsc);
    };

    // Función para mostrar notificaciones
    const showNotification = (message, type = 'info') => {
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#ff6b6b' : type === 'warning' ? '#ffa500' : '#667eea'};
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        z-index: 99999999;
        font-family: Arial, sans-serif;
        font-size: 14px;
        animation: slideIn 0.3s ease;
      `;

      notification.textContent = message;
      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
      }, 3000);
    };

    // Esperar a que el DOM esté listo
    const initButton = () => {
      createHistoryButton();
      
      // Recrear botón si se elimina
      const observer = new MutationObserver(() => {
        if (!document.getElementById('history-btn')) {
          createHistoryButton();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    };

    // Esperar a que WhatsApp cargue completamente
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initButton);
    } else {
      // DOM ya está listo, esperar un poco más para que WhatsApp cargue
      setTimeout(initButton, 2000);
    }
  });
}
