import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { startBackupMonitor } from './chat-backup.js';
import { loadAgentConfig, saveAgentConfig, API_BASE_URL } from './agent-config.js';

let manualBrowser = null;
let manualPage = null;
let backupMonitorInterval = null;

/**
 * Muestra el overlay de login en la ventana manual
 * @param {boolean} requireAll - Si es true, pide usuario, campaña y palabra. Si es false, solo palabra
 * @returns {Promise<Object>} Configuración del agente
 */
async function showManualLoginOverlay(requireAll = true) {
  return new Promise(async (resolve) => {
    const savedConfig = requireAll ? null : loadAgentConfig();
    
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
          <input type="text" id="manual-login-user" placeholder="ej: erick" style="
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
          <input type="text" id="manual-login-campaign" placeholder="ej: prueba" style="
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

/**
 * Inicializa la ventana manual de WhatsApp para respuestas
 * @param {Array} allowedContacts - Lista de contactos permitidos (números de teléfono)
 */
export async function initManualWhatsApp(allowedContacts = []) {
  console.log('🔓 Iniciando ventana manual de WhatsApp...');
  
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
  });

  manualPage = manualBrowser.pages()[0] || await manualBrowser.newPage();
  
  // Inyectar protecciones ANTES de cargar WhatsApp (EXACTO como en whatsapp.js)
  await manualPage.addInitScript(() => {
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
  });
  
  // Inyectar restricciones ANTES de cargar WhatsApp
  await applyUIRestrictions(allowedContacts);
  
  // Inyectar botón de historial ANTES de cargar la página
  try {
    await injectHistoryButton(manualPage);
  } catch (error) {
    console.error('⚠️  Error al preparar botón de historial:', error.message);
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
  
  // IMPORTANTE: Pedir credenciales ANTES de esperar la conexión
  console.log('🔐 Validación de credenciales requerida (Manual)...');
  console.log('📝 Ingresa usuario, campaña y palabra del día');
  
  // Siempre pedir todos los campos (usuario, campaña y palabra del día)
  let manualConfig = await showManualLoginOverlay(true);
  saveAgentConfig(manualConfig);
  console.log(`✅ Credenciales verificadas (Manual): ${manualConfig.agent_id} | Campaña: ${manualConfig.campaign}`);

  console.log('📱 Escanea el código QR con OTRO teléfono/cuenta');
  
  console.log('⏳ Esperando conexión de WhatsApp Web (Manual)...');
  
  // Ahora sí, esperar a que WhatsApp se conecte
  await manualPage.waitForSelector('#side', { timeout: 300000 });
  
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
    window.applyManualUIRestrictions = () => {
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
      
      // Agregar overlay informativo
      if (!document.getElementById('manual-mode-indicator')) {
        const indicator = document.createElement('div');
        indicator.id = 'manual-mode-indicator';
        indicator.style.cssText = `
          position: fixed;
          top: 10px;
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
  setInterval(window.applyManualUIRestrictions, 1000);

  // Observar cambios en el DOM
  const observer = new MutationObserver(window.applyManualUIRestrictions);
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  } else {
    // Si el DOM aún no está listo, esperar
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    });
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
          console.log('[Historial] Llamando a window.getHistoryFromBackend...');
          
          // Verificar si la función existe
          if (typeof window.getHistoryFromBackend !== 'function') {
            console.error('[Historial] ❌ window.getHistoryFromBackend no está disponible');
            showNotification('❌ Error: Función no disponible', 'error');
            return;
          }
          
          // Obtener historial del backend usando la función expuesta de Node.js
          const result = await window.getHistoryFromBackend();
          console.log('[Historial] Resultado recibido:', result);
          
          if (!result.success) {
            console.log('[Historial] Sin éxito:', result.message);
            showNotification(result.message || '📭 No hay historial disponible', 'info');
            return;
          }

          if (!result.data) {
            console.log('[Historial] No hay data en el resultado');
            showNotification('📭 No hay datos de historial', 'info');
            return;
          }

          // Buscar mensajes del contacto actual
          console.log('[Historial] Buscando mensajes para:', phoneNumber);
          const messages = findMessagesForContact(result.data, phoneNumber);
          
          if (messages.length === 0) {
            console.log('[Historial] No se encontraron mensajes');
            showNotification(`📭 No hay historial para este contacto`, 'info');
            return;
          }

          console.log('[Historial] Mostrando burbuja con', messages.length, 'mensajes');
          // Mostrar burbuja con historial
          showHistoryBubble(messages, phoneNumber, result.date);

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
      const header = document.querySelector('header');
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
      const mainContainer = document.querySelector('#main');
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
        msgDiv.style.cssText = `
          margin-bottom: 15px;
          padding: 15px;
          background: ${msg.status === 'sent' ? '#e7f3ff' : '#f5f5f5'};
          border-left: 4px solid ${msg.status === 'sent' ? '#667eea' : '#ccc'};
          border-radius: 8px;
        `;

        msgDiv.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <strong style="color: #333;">${msg.name || msg.contact_name || phoneNumber}</strong>
            <span style="color: #666; font-size: 12px;">${msg.sent_at ? new Date(msg.sent_at).toLocaleString('es-MX') : 'Sin fecha'}</span>
          </div>
          <div style="color: #555; white-space: pre-wrap; margin-bottom: 8px;">
            <strong style="font-size: 11px; color: #999;">MENSAJE ENVIADO:</strong><br>
            ${msg.message_sent || msg.message || msg.text || 'Sin mensaje'}
          </div>
          ${msg.response ? `
            <div style="margin-top: 10px; padding: 10px; background: #fff; border-radius: 5px; border-left: 3px solid #25D366;">
              <strong style="color: #25D366; font-size: 12px;">RESPUESTA RECIBIDA:</strong>
              <div style="color: #555; margin-top: 5px;">${msg.response}</div>
            </div>
          ` : '<div style="color: #999; font-size: 12px; font-style: italic;">Sin respuesta</div>'}
          <div style="margin-top: 8px; font-size: 12px; color: #999;">
            Estado: <span style="color: ${msg.status === 'sent' ? '#25D366' : '#ff6b6b'};">${msg.status === 'sent' ? '✅ Enviado' : '❌ Error'}</span>
            ${msg.error ? `<br><span style="color: #ff6b6b;">Error: ${msg.error}</span>` : ''}
          </div>
        `;

        content.appendChild(msgDiv);
      });

      bubble.appendChild(header);
      bubble.appendChild(content);
      
      // Agregar overlay primero, luego la burbuja
      document.body.appendChild(overlay);
      document.body.appendChild(bubble);

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
