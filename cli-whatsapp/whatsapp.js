import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { replaceVariables } from './message-utils.js';

let autoBrowser = null;
let autoPage = null;

/**
 * Inicializa WhatsApp Web para automatización y espera a que esté conectado
 */
export async function initWhatsApp() {
  console.log('🤖 Iniciando WhatsApp Web (Automatización)...');
  
  autoBrowser = await chromium.launchPersistentContext(CONFIG.sessionPath, {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled', // Ocultar que es automatizado
      '--app=https://web.whatsapp.com', // Modo app (sin barra de navegación)
      '--disable-dev-tools', // Desactivar DevTools
      '--disable-extensions', // Desactivar extensiones
    ],
    viewport: { width: 1280, height: 720 },
    devtools: false, // Desactivar DevTools
  });

  autoPage = autoBrowser.pages()[0] || await autoBrowser.newPage();
  
  // Inyectar restricciones UI ANTES de cargar WhatsApp
  await applyAutomationUIRestrictions();
  
  // Inyectar protecciones ANTES de cargar WhatsApp
  await autoPage.addInitScript(() => {
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
  
  // Inyectar overlay ANTES de cargar WhatsApp (si está habilitado)
  if (CONFIG.showOverlay) {
    console.log('🛡️  Preparando overlay de protección...');
    await autoPage.addInitScript(() => {
      // Función para crear/recrear el overlay
      window.createAutomationOverlay = () => {
        // Remover overlay existente si hay
        const existing = document.getElementById('automation-overlay');
        if (existing) existing.remove();
        
        // Crear overlay con pointer-events: none para que Playwright pueda hacer clics
        const overlay = document.createElement('div');
        overlay.id = 'automation-overlay';
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.85);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: Arial, sans-serif;
          color: white;
          pointer-events: none;
        `;
        
        overlay.innerHTML = `
          <div style="text-align: center; padding: 40px; background: rgba(0, 0, 0, 0.9); border-radius: 20px; border: 2px solid #25D366;">
            <div style="font-size: 60px; margin-bottom: 20px;">🤖</div>
            <h1 style="margin: 0 0 10px 0; font-size: 32px; color: #25D366;">Automatización en Proceso</h1>
            <p style="margin: 0; font-size: 18px; opacity: 0.9;">No interactúes con esta ventana</p>
            <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.7;">El proceso se está ejecutando automáticamente</p>
          </div>
        `;
        
        document.body.appendChild(overlay);
      };
      
      // Crear overlay cuando el DOM esté listo
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.createAutomationOverlay);
      } else {
        window.createAutomationOverlay();
      }
      
      // Recrear overlay cada vez que cambie el DOM (por si se navega)
      setInterval(() => {
        if (!document.getElementById('automation-overlay')) {
          window.createAutomationOverlay();
        }
      }, 1000);
    });
  }
  
  await autoPage.goto('https://web.whatsapp.com', { waitUntil: 'networkidle' });

  console.log('⏳ Esperando a que WhatsApp Web (Automatización) cargue...');
  console.log('📱 Si ves un código QR, escanéalo con tu teléfono');
  
  // Esperar a que aparezca el panel de chats (señal de que está conectado)
  await autoPage.waitForSelector('#side', { timeout: 300000 });
  
  console.log('✅ WhatsApp Web (Automatización) conectado!');
  
  // Activar overlay inmediatamente después de conectar
  if (CONFIG.showOverlay) {
    await autoPage.evaluate(() => {
      if (window.createAutomationOverlay) {
        window.createAutomationOverlay();
      }
    });
    console.log('✅ Overlay activado - La ventana está protegida');
  }
  
  // Aplicar restricciones de UI inmediatamente
  await autoPage.evaluate(() => {
    if (window.applyUIRestrictions) {
      window.applyUIRestrictions();
    }
  });
  console.log('🔒 Restricciones UI aplicadas a la ventana automatizada');
  
  await autoPage.waitForTimeout(2000);
}

/**
 * Aplica restricciones de UI a la ventana automatizada
 */
async function applyAutomationUIRestrictions() {
  if (!autoPage) return;
  
  await autoPage.addInitScript(() => {
    // Función global para aplicar restricciones
    window.applyUIRestrictions = () => {
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
      hideElements('button[data-tab="2"]');
      
      // Ocultar botón de menú (3 puntos)
      hideElements('[data-icon="more-refreshed"]');
      hideElements('[aria-label="Menu"]');
      hideElements('[aria-label="Menú"]');
      hideElements('button[aria-label*="Menu"]');
      hideElements('button[aria-label*="Menú"]');
      
      // Ocultar botones de navegación inferior
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
      hideElements('button[data-navbar-item-index="1"]');
      hideElements('button[data-navbar-item-index="2"]');
      hideElements('button[data-navbar-item-index="3"]');
      hideElements('button[data-navbar-item-index="4"]');
      hideElements('button[data-navbar-item-index="5"]');
      hideElements('button[data-navbar-item-index="6"]');
      
      // Bloquear interacción con el header completo del chat
      const chatHeaders = document.querySelectorAll('header');
      chatHeaders.forEach(header => {
        if (header.querySelector('[data-tab="6"]') || 
            header.querySelector('[aria-label*="Detalles"]') ||
            header.querySelector('img[alt=""]')) {
          header.style.pointerEvents = 'none';
          header.style.opacity = '0.6';
          header.style.cursor = 'not-allowed';
        }
      });
      
      hideElements('[title="Detalles del perfil"]');
      hideElements('[role="button"][title*="Detalles"]');
      
      const headerClickables = document.querySelectorAll('header [role="button"]');
      headerClickables.forEach(el => {
        if (!el.querySelector('[data-icon="search-refreshed"]')) {
          el.style.pointerEvents = 'none';
          el.style.opacity = '0.6';
        }
      });
      
      // Bloquear el cuadro de búsqueda
      const searchBox = document.querySelector('[role="textbox"][title*="Buscar"]');
      if (searchBox) {
        searchBox.setAttribute('readonly', 'true');
        searchBox.style.pointerEvents = 'none';
        searchBox.style.opacity = '0.5';
      }
      
      // Ocultar botones por SVG
      const buttons = document.querySelectorAll('button');
      buttons.forEach(btn => {
        const svg = btn.querySelector('svg[viewBox="0 0 24 24"]');
        if (svg) {
          const title = svg.querySelector('title');
          if (title && (title.textContent === 'new-chat-outline' || 
                       title.textContent === 'more-refreshed')) {
            btn.style.display = 'none';
            btn.style.visibility = 'hidden';
            btn.style.pointerEvents = 'none';
          }
        }
      });
    };
    
    // Aplicar restricciones cuando el DOM esté listo
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', window.applyUIRestrictions);
    } else {
      window.applyUIRestrictions();
    }
    
    // Aplicar restricciones cada segundo (más frecuente)
    setInterval(window.applyUIRestrictions, 1000);
    
    // Observar cambios en el DOM y aplicar restricciones
    const observer = new MutationObserver(window.applyUIRestrictions);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  });
}

/**
 * Muestra el overlay de advertencia
 */
async function showOverlay() {
  if (!autoPage) return;
  
  try {
    await autoPage.evaluate(() => {
      const overlay = document.getElementById('automation-overlay');
      if (overlay) {
        overlay.style.display = 'flex';
      }
    });
  } catch (e) {
    // Ignorar errores si el overlay no existe
  }
}

/**
 * Oculta el overlay de advertencia (útil para escanear QR)
 */
async function hideOverlay() {
  if (!autoPage) return;
  
  try {
    await autoPage.evaluate(() => {
      const overlay = document.getElementById('automation-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
    });
  } catch (e) {
    // Ignorar errores si el overlay no existe
  }
}

/**
 * Cierra el navegador de automatización
 */
export async function closeBrowser() {
  if (autoBrowser) {
    console.log('🔒 Cerrando navegador de automatización...');
    await autoBrowser.close();
  }
}

/**
 * Obtiene la instancia de la página de automatización
 */
export function getPage() {
  return autoPage;
}

/**
 * Verifica si un número tiene WhatsApp
 * @param {string} invalidNumberTextSelector - Selector del texto de error
 * @returns {Promise<boolean>} true si el número es inválido
 */
async function checkInvalidNumber(invalidNumberTextSelector) {
  try {
    const invalidNumber = await autoPage.waitForSelector(invalidNumberTextSelector, { timeout: 8000 });
    return !!invalidNumber;
  } catch (_) {
    return false;
  }
}

/**
 * Pega media desde el portapapeles y la envía
 * @param {string} messageBoxSelector - Selector del cuadro de mensaje
 * @param {string} invalidNumberTextSelector - Selector del texto de error
 * @param {string} phone - Teléfono del contacto
 * @returns {Promise<Object|null>} Objeto de error si falla, null si tiene éxito
 */
async function pasteAndSendMedia(messageBoxSelector, invalidNumberTextSelector, phone) {
  try {
    await autoPage.waitForSelector(messageBoxSelector, { timeout: 30000 });
    await autoPage.click(messageBoxSelector);
    await autoPage.waitForTimeout(500);

    // Ctrl+V (Windows) para pegar lo que haya en el portapapeles
    await autoPage.keyboard.down('Control');
    await autoPage.keyboard.press('v');
    await autoPage.keyboard.up('Control');

    // Esperar a que se cargue la previsualización y enviar con Enter
    await autoPage.waitForTimeout(1500);
    await autoPage.keyboard.press('Enter');
    await autoPage.waitForTimeout(2000);

    console.log('📎 Media pegada desde portapapeles y enviada');
    return null;
  } catch (e) {
    // Si no encontramos el cuadro de mensaje, puede ser porque el número es inválido
    const maybeInvalid = await autoPage.$('text="El número de teléfono compartido a través de la dirección URL no es válido."');
    if (maybeInvalid) {
      console.log(`❌ Número inválido (no tiene WhatsApp) detectado durante pegado de media: ${phone}`);
      return {
        status: 'no_whatsapp',
        error: 'No tiene WhatsApp',
      };
    }

    console.log(`⚠️  No se pudo pegar media desde portapapeles para ${phone}: ${e.message}`);
    return null;
  }
}

/**
 * Escribe un mensaje de golpe simulando un paste (sin usar clipboard)
 * @param {string} message - Mensaje a escribir
 */
async function typeMessage(message) {
  // Usar autoPage.evaluate para insertar el texto directamente en el DOM
  // Esto simula un paste sin usar el clipboard real
  await autoPage.evaluate((text) => {
    // Intentar varios selectores por si el idioma cambia
    let messageBox = document.querySelector('div[contenteditable="true"][data-tab][aria-placeholder="Escribe un mensaje"]');
    if (!messageBox) {
      messageBox = document.querySelector('div[contenteditable="true"][data-tab][aria-placeholder="Type a message"]');
    }
    if (!messageBox) {
      messageBox = document.querySelector('div[contenteditable="true"][data-tab]');
    }
    
    if (messageBox) {
      // Enfocar el elemento
      messageBox.focus();
      messageBox.click();
      
      // Limpiar contenido previo
      messageBox.innerHTML = '';
      
      // Método 1: Insertar usando textContent (más simple)
      const lines = text.split('\n');
      
      lines.forEach((line, index) => {
        // Crear nodo de texto
        const textNode = document.createTextNode(line);
        messageBox.appendChild(textNode);
        
        // Agregar salto de línea si no es la última línea
        if (index < lines.length - 1) {
          messageBox.appendChild(document.createElement('br'));
        }
      });
      
      // Mover el cursor al final
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(messageBox);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      
      // Disparar múltiples eventos para asegurar que WhatsApp detecte el cambio
      messageBox.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
      
      messageBox.dispatchEvent(new Event('change', { bubbles: true }));
      
      messageBox.dispatchEvent(new KeyboardEvent('keyup', { 
        bubbles: true, 
        cancelable: true,
        key: 'Enter'
      }));
      
      // Forzar actualización del estado de WhatsApp
      messageBox.dispatchEvent(new Event('blur', { bubbles: true }));
      messageBox.focus();
    }
  }, message);
  
  await autoPage.waitForTimeout(1000);
}

/**
 * Intenta capturar la última respuesta del chat
 * @returns {Promise<string>} Texto de la respuesta o cadena vacía
 */
async function captureResponse() {
  let response = '';
  
  try {
    // Esperar un poco más para que llegue la respuesta
    await autoPage.waitForTimeout(2000);
    
    // Buscar todos los mensajes en el chat
    const allMessages = await autoPage.$$('div.message-in, div.message-out');
    
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
      const incomingBubbles = await autoPage.$$('div[data-pre-plain-text]');
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
  
  return response;
}

/**
 * Envía un mensaje a un contacto
 * @param {Object} contact - Objeto con los datos del contacto
 * @param {string} messageTemplate - Plantilla del mensaje
 * @returns {Promise<Object>} Resultado del envío
 */
export async function sendMessage(contact, messageTemplate) {
  try {
    const cleanPhone = contact.phone.replace(/\D/g, '');
    const personalizedMessage = replaceVariables(messageTemplate, contact);
    
    console.log(`\n📤 Enviando a ${contact.name} (${contact.phone})...`);
    
    // Abrir chat
    const chatUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
    await autoPage.goto(chatUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await autoPage.waitForTimeout(3000);

    // Verificar si el número es válido usando el modal de error (sin WhatsApp)
    const invalidNumberTextSelector = 'text="El número de teléfono compartido a través de la dirección URL no es válido."';
    
    const isInvalid = await checkInvalidNumber(invalidNumberTextSelector);
    if (isInvalid) {
      console.log(`❌ Número inválido (no tiene WhatsApp): ${contact.phone}`);
      return {
        ...contact,
        status: 'no_whatsapp',
        error: 'No tiene WhatsApp',
        sent_at: new Date().toISOString(),
        response: '',
      };
    }

    // Si está activado el modo de media por portapapeles, pegar y enviar antes del texto
    if (CONFIG.useClipboardMedia) {
      const messageBoxSelector = 'div[contenteditable="true"][data-tab][aria-placeholder="Escribe un mensaje"]';
      const mediaError = await pasteAndSendMedia(messageBoxSelector, invalidNumberTextSelector, contact.phone);
      
      if (mediaError) {
        return {
          ...contact,
          ...mediaError,
          sent_at: new Date().toISOString(),
          response: '',
        };
      }
    }

    // Buscar el campo de mensaje del chat (no el buscador), usando el placeholder "Escribe un mensaje"
    const messageBoxSelector = 'div[contenteditable="true"][data-tab][aria-placeholder="Escribe un mensaje"]';
    try {
      await autoPage.waitForSelector(messageBoxSelector, { timeout: 30000 });
    } catch (e) {
      // Antes de marcar error genérico, revisamos si apareció el texto de número inválido
      const maybeInvalid = await autoPage.$(invalidNumberTextSelector);
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

    // Hacer clic en el campo para enfocarlo (el overlay con pointer-events:none no interfiere)
    try {
      await autoPage.click(messageBoxSelector);
    } catch (e) {
      // Si al hacer clic el popup de número inválido intercepta el click, lo tratamos como no_whatsapp
      const maybeInvalid = await autoPage.$(invalidNumberTextSelector);
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
    await autoPage.waitForTimeout(1000);

    // Escribir mensaje de golpe (simulando paste)
    console.log('✍️  Escribiendo mensaje...');
    await typeMessage(personalizedMessage);
    
    // Verificar que el mensaje se haya escrito
    const messageWritten = await autoPage.evaluate(() => {
      let messageBox = document.querySelector('div[contenteditable="true"][data-tab][aria-placeholder="Escribe un mensaje"]');
      if (!messageBox) {
        messageBox = document.querySelector('div[contenteditable="true"][data-tab][aria-placeholder="Type a message"]');
      }
      if (!messageBox) {
        messageBox = document.querySelector('div[contenteditable="true"][data-tab]');
      }
      return messageBox ? messageBox.textContent.trim().length > 0 : false;
    });
    
    if (!messageWritten) {
      console.log('⚠️  El mensaje no se escribió correctamente, reintentando...');
      await autoPage.waitForTimeout(1000);
      await typeMessage(personalizedMessage);
    }
    
    console.log('📨 Enviando mensaje con Enter...');
    await autoPage.waitForTimeout(500);

    // Método 1: Buscar y hacer clic en el botón de enviar
    const sendButtonClicked = await autoPage.evaluate(() => {
      // Buscar el botón de enviar por su aria-label o data-icon
      const sendButton = document.querySelector('button[aria-label="Enviar"]') || 
                        document.querySelector('button[aria-label="Send"]') ||
                        document.querySelector('span[data-icon="send"]')?.closest('button');
      
      if (sendButton) {
        sendButton.click();
        return true;
      }
      return false;
    });
    
    if (sendButtonClicked) {
      console.log('✅ Botón de enviar clickeado');
    } else {
      // Método 2: Disparar Enter en el cuadro de mensaje
      console.log('⚠️  Botón no encontrado, usando Enter...');
      await autoPage.evaluate(() => {
        let messageBox = document.querySelector('div[contenteditable="true"][data-tab][aria-placeholder="Escribe un mensaje"]');
        if (!messageBox) {
          messageBox = document.querySelector('div[contenteditable="true"][data-tab][aria-placeholder="Type a message"]');
        }
        if (!messageBox) {
          messageBox = document.querySelector('div[contenteditable="true"][data-tab]');
        }
        
        if (messageBox) {
          messageBox.focus();
          
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          messageBox.dispatchEvent(enterEvent);
        }
      });
      
      // También presionar Enter con Playwright
      await autoPage.keyboard.press('Enter');
    }
    
    await autoPage.waitForTimeout(2000);

    console.log(`✅ Mensaje enviado a ${contact.name}`);

    // Esperar posible respuesta solo si está configurado
    let response = '';
    if (CONFIG.waitForResponse > 0) {
      console.log(`⏳ Esperando respuesta (${CONFIG.waitForResponse / 1000}s)...`);
      await autoPage.waitForTimeout(CONFIG.waitForResponse);
      
      // Intentar capturar última respuesta
      response = await captureResponse();
    } else {
      console.log('⏭️  Sin espera de respuesta, continuando...');
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
