import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { startBackupMonitor } from './chat-backup.js';
import { loadAgentConfig, API_BASE_URL } from './agent-config.js';

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
  
  // Inyectar botón de historial ANTES de cargar la página
  try {
    await injectHistoryButton(manualPage);
  } catch (error) {
    console.error('⚠️  Error al preparar botón de historial:', error.message);
  }
  
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

/**
 * Obtiene el historial desde el backend (desde Node.js, no desde el navegador)
 */
async function fetchHistoryFromBackend(agentId, campaign) {
  try {
    const url = `${API_BASE_URL}/backups/latest/${agentId}/${campaign}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, message: 'No hay historial disponible (últimos 4 días)' };
      }
      return { success: false, message: 'Error al obtener historial' };
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching history:', error);
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
  await page.exposeFunction('getHistoryFromBackend', async () => {
    return await fetchHistoryFromBackend(config.agent_id, config.campaign);
  });

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
        // Obtener número del contacto actual
        const phoneNumber = getCurrentContactPhone();
        
        if (!phoneNumber) {
          showNotification('⚠️ Selecciona un chat primero', 'warning');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '⏳ Cargando...';

        try {
          // Obtener historial del backend usando la función expuesta de Node.js
          const result = await window.getHistoryFromBackend();
          
          if (!result.success) {
            showNotification(result.message || '📭 No hay historial disponible', 'info');
            return;
          }

          if (!result.data) {
            showNotification('📭 No hay datos de historial', 'info');
            return;
          }

          // Buscar mensajes del contacto actual
          const messages = findMessagesForContact(result.data, phoneNumber);
          
          if (messages.length === 0) {
            showNotification(`📭 No hay historial para este contacto`, 'info');
            return;
          }

          // Mostrar burbuja con historial
          showHistoryBubble(messages, phoneNumber, result.date);

        } catch (error) {
          console.error('Error fetching history:', error);
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
      if (!backupData.results || !Array.isArray(backupData.results)) {
        return [];
      }

      const cleanPhone = phoneNumber.replace(/\D/g, '');
      
      return backupData.results.filter(result => {
        const resultPhone = result.phone ? result.phone.replace(/\D/g, '') : '';
        return resultPhone.includes(cleanPhone) || cleanPhone.includes(resultPhone);
      });
    };

    // Función para mostrar la burbuja con el historial
    const showHistoryBubble = (messages, phoneNumber, date) => {
      // Remover burbuja existente
      const existing = document.getElementById('history-bubble');
      if (existing) existing.remove();

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
        z-index: 9999999;
        width: 600px;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      `;

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
            <strong style="color: #333;">${msg.name || phoneNumber}</strong>
            <span style="color: #666; font-size: 12px;">${msg.timestamp || 'Sin fecha'}</span>
          </div>
          <div style="color: #555; white-space: pre-wrap;">${msg.message || msg.text || 'Sin mensaje'}</div>
          ${msg.response ? `
            <div style="margin-top: 10px; padding: 10px; background: #fff; border-radius: 5px; border-left: 3px solid #25D366;">
              <strong style="color: #25D366; font-size: 12px;">RESPUESTA:</strong>
              <div style="color: #555; margin-top: 5px;">${msg.response}</div>
            </div>
          ` : ''}
          <div style="margin-top: 8px; font-size: 12px; color: #999;">
            Estado: <span style="color: ${msg.status === 'sent' ? '#25D366' : '#ff6b6b'};">${msg.status === 'sent' ? '✅ Enviado' : '❌ Error'}</span>
          </div>
        `;

        content.appendChild(msgDiv);
      });

      bubble.appendChild(header);
      bubble.appendChild(content);
      document.body.appendChild(bubble);

      // Cerrar burbuja
      document.getElementById('close-history-bubble').onclick = () => {
        bubble.remove();
      };

      // Cerrar con ESC
      const handleEsc = (e) => {
        if (e.key === 'Escape') {
          bubble.remove();
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
