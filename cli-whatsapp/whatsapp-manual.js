import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { startBackupMonitor } from './chat-backup.js';

let manualBrowser = null;
let manualPage = null;
let backupMonitorInterval = null;

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
    ],
    viewport: { width: 1280, height: 720 },
    devtools: false,
  });

  manualPage = manualBrowser.pages()[0] || await manualBrowser.newPage();
  
  // Inyectar restricciones ANTES de cargar WhatsApp
  await applyUIRestrictions(allowedContacts);
  
  await manualPage.goto('https://web.whatsapp.com', { waitUntil: 'networkidle' });

  console.log('⏳ Esperando a que WhatsApp Web (Manual) cargue...');
  console.log('📱 Escanea el código QR con OTRO teléfono/cuenta');
  
  // Esperar a que aparezca el panel de chats
  await manualPage.waitForSelector('#side', { timeout: 300000 });
  
  console.log('✅ WhatsApp Web (Manual) conectado!');
  
  // Aplicar restricciones inmediatamente
  await manualPage.evaluate(() => {
    if (window.applyManualUIRestrictions) {
      window.applyManualUIRestrictions();
    }
  });
  
  await manualPage.waitForTimeout(2000);
  
  console.log('🔒 Restricciones aplicadas a la ventana manual');
  
  // Iniciar monitor de backup (agrega botón "Respaldar Chats")
  backupMonitorInterval = await startBackupMonitor(manualPage);
  console.log('☁️  Botón de respaldo de chats activado');
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
    
    // Función global para aplicar restricciones
    window.applyManualUIRestrictions = () => {
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
    document.addEventListener('DOMContentLoaded', window.applyManualUIRestrictions);
  } else {
    window.applyManualUIRestrictions();
  }

  // Aplicar restricciones cada segundo
  setInterval(window.applyManualUIRestrictions, 1000);

  // Observar cambios en el DOM
  const observer = new MutationObserver(window.applyManualUIRestrictions);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });
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
