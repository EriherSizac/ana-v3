import { loadAgentConfig, sendBackup, uploadMedia } from './agent-config.js';

/**
 * Extrae todos los mensajes de un chat abierto
 * @param {Object} page - Instancia de Playwright page
 * @returns {Promise<Array>} Array de mensajes
 */
async function extractMessagesFromChat(page) {
  return await page.evaluate(() => {
    const messages = [];
    
    // Buscar el contenedor principal de mensajes (#main)
    const mainContainer = document.querySelector('#main');
    if (!mainContainer) return messages;
    
    // Buscar todos los contenedores de mensajes con data-id
    const messageContainers = mainContainer.querySelectorAll('[data-id]');
    
    messageContainers.forEach(container => {
      try {
        const dataId = container.getAttribute('data-id');
        if (!dataId) return;
        
        // Determinar si es mensaje entrante o saliente
        const isOutgoing = dataId.includes('true_') ||
                          container.querySelector('.message-out') ||
                          container.querySelector('[data-icon="msg-dblcheck"]') ||
                          container.querySelector('[data-icon="msg-check"]');
        
        // Obtener el texto del mensaje
        const textElement = container.querySelector('span.selectable-text.copyable-text span') ||
                           container.querySelector('span._ao3e.copyable-text');
        const text = textElement ? textElement.textContent : '';
        
        // Obtener timestamp del atributo data-pre-plain-text
        const timeElement = container.querySelector('[data-pre-plain-text]');
        let timestamp = '';
        if (timeElement) {
          const prePlainText = timeElement.getAttribute('data-pre-plain-text');
          if (prePlainText) {
            // Formato: "[HH:MM, DD/MM/YYYY] Nombre: "
            const match = prePlainText.match(/\[([^\]]+)\]/);
            if (match) timestamp = match[1];
          }
        }
        
        // Verificar si tiene media y obtener URL
        const imageEl = container.querySelector('img[src*="blob:"]');
        const videoEl = container.querySelector('video');
        const audioEl = container.querySelector('audio');
        const documentEl = container.querySelector('[data-icon="audio-file"]') || 
                          container.querySelector('[data-icon="document"]');
        
        const hasImage = !!imageEl;
        const hasVideo = !!videoEl;
        const hasAudio = !!audioEl;
        const hasDocument = !!documentEl;
        
        // Obtener URL de media si existe
        let mediaBlobUrl = null;
        if (hasImage && imageEl) {
          mediaBlobUrl = imageEl.src;
        } else if (hasVideo && videoEl) {
          mediaBlobUrl = videoEl.src;
        } else if (hasAudio && audioEl) {
          mediaBlobUrl = audioEl.src;
        }
        
        if (text || hasImage || hasVideo || hasAudio || hasDocument) {
          messages.push({
            id: dataId,
            type: isOutgoing ? 'outgoing' : 'incoming',
            text: text || '',
            timestamp: timestamp,
            hasMedia: hasImage || hasVideo || hasAudio || hasDocument,
            mediaType: hasImage ? 'image' : hasVideo ? 'video' : hasAudio ? 'audio' : hasDocument ? 'document' : null,
            mediaBlobUrl: mediaBlobUrl,
          });
        }
      } catch (e) {
        // Ignorar errores de mensajes individuales
      }
    });
    
    return messages;
  });
}

/**
 * Descarga un blob URL y lo convierte a base64
 * @param {Object} page - Instancia de Playwright page
 * @param {string} blobUrl - URL del blob
 * @returns {Promise<Object>} Objeto con base64 y contentType
 */
async function downloadBlobAsBase64(page, blobUrl) {
  return await page.evaluate(async (url) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          resolve({
            base64: base64,
            contentType: blob.type,
            size: blob.size,
          });
        };
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }, blobUrl);
}

/**
 * Procesa y sube media de los mensajes al S3
 * @param {Object} page - Instancia de Playwright page
 * @param {Array} messages - Array de mensajes
 * @param {string} phoneNumber - Número de teléfono del contacto
 * @returns {Promise<Array>} Mensajes con URLs de media actualizadas
 */
async function processAndUploadMedia(page, messages, phoneNumber) {
  const processedMessages = [];
  
  for (const msg of messages) {
    if (msg.hasMedia && msg.mediaBlobUrl) {
      try {
        const blobData = await downloadBlobAsBase64(page, msg.mediaBlobUrl);
        
        if (blobData && blobData.base64) {
          // Generar nombre de archivo único
          const ext = blobData.contentType.split('/')[1] || 'bin';
          const filename = `${msg.id.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
          
          // Subir al S3
          const mediaUrl = await uploadMedia(
            phoneNumber,
            filename,
            blobData.base64,
            blobData.contentType
          );
          
          if (mediaUrl) {
            msg.mediaUrl = mediaUrl;
          }
        }
      } catch (e) {
        console.error(`Error procesando media: ${e.message}`);
      }
    }
    
    // Eliminar el blob URL del mensaje final (no es útil fuera del navegador)
    delete msg.mediaBlobUrl;
    processedMessages.push(msg);
  }
  
  return processedMessages;
}

/**
 * Obtiene información del chat actual (nombre/número del contacto)
 * @param {Object} page - Instancia de Playwright page
 * @returns {Promise<Object>} Info del chat
 */
async function getChatInfo(page) {
  return await page.evaluate(() => {
    // Buscar el nombre del contacto en el header
    const headerTitle = document.querySelector('header span[dir="auto"][title]');
    const name = headerTitle ? headerTitle.getAttribute('title') : 'Unknown';
    
    // Intentar obtener el número de teléfono
    const phoneElement = document.querySelector('header span[title*="+"]');
    const phone = phoneElement ? phoneElement.getAttribute('title') : '';
    
    return { name, phone };
  });
}

/**
 * Obtiene la lista de todos los chats visibles
 * @param {Object} page - Instancia de Playwright page
 * @returns {Promise<Array>} Lista de chats
 */
async function getChatList(page) {
  return await page.evaluate(() => {
    const chats = [];
    
    // Buscar todos los elementos de chat en la lista lateral usando el contenedor #pane-side
    // Los chats están en elementos con role="row" dentro del grid
    const paneSize = document.querySelector('#pane-side');
    if (!paneSize) return chats;
    
    const chatElements = paneSize.querySelectorAll('[role="row"]');
    
    chatElements.forEach((chat, index) => {
      try {
        // El título está en un span con dir="auto" y atributo title
        const titleEl = chat.querySelector('span[dir="auto"][title]');
        const title = titleEl ? titleEl.getAttribute('title') : `Chat ${index + 1}`;
        
        // Obtener último mensaje si existe
        const lastMsgEl = chat.querySelector('span[dir="ltr"]');
        const lastMessage = lastMsgEl ? lastMsgEl.textContent : '';
        
        if (title && title !== `Chat ${index + 1}`) {
          chats.push({
            index,
            title,
            lastMessage,
          });
        }
      } catch (e) {
        // Ignorar errores
      }
    });
    
    return chats;
  });
}

/**
 * Hace clic en un chat específico por índice
 * @param {Object} page - Instancia de Playwright page
 * @param {number} index - Índice del chat
 */
async function clickChat(page, index) {
  await page.evaluate((idx) => {
    const paneSize = document.querySelector('#pane-side');
    if (!paneSize) return;
    
    const chatElements = paneSize.querySelectorAll('[role="row"]');
    if (chatElements[idx]) {
      // Hacer clic en el elemento clickeable dentro del row
      const clickable = chatElements[idx].querySelector('[tabindex="-1"]') || chatElements[idx];
      clickable.click();
    }
  }, index);
  
  // Esperar a que cargue el chat
  await page.waitForTimeout(1500);
}

/**
 * Hace scroll hacia arriba en el chat para cargar más mensajes
 * @param {Object} page - Instancia de Playwright page
 * @param {number} times - Número de veces a hacer scroll
 */
async function scrollUpChat(page, times = 5) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => {
      const messageList = document.querySelector('[data-testid="conversation-panel-messages"]') ||
                         document.querySelector('[role="application"]');
      if (messageList) {
        messageList.scrollTop = 0;
      }
    });
    await page.waitForTimeout(800);
  }
}

/**
 * Ejecuta el proceso completo de backup de todos los chats
 * @param {Object} page - Instancia de Playwright page
 * @param {Function} onProgress - Callback para reportar progreso
 * @returns {Promise<Object>} Resultado del backup
 */
export async function runChatBackup(page, onProgress = () => {}) {
  const config = loadAgentConfig();
  if (!config) {
    throw new Error('No hay configuración de agente');
  }
  
  const allChats = [];
  
  try {
    onProgress({ status: 'starting', message: 'Obteniendo lista de chats...' });
    
    // Obtener lista de chats
    const chatList = await getChatList(page);
    const totalChats = chatList.length;
    
    onProgress({ status: 'found', message: `Encontrados ${totalChats} chats`, total: totalChats });
    
    for (let i = 0; i < totalChats; i++) {
      const chat = chatList[i];
      
      onProgress({ 
        status: 'processing', 
        message: `Procesando: ${chat.title}`, 
        current: i + 1, 
        total: totalChats 
      });
      
      // Hacer clic en el chat
      await clickChat(page, i);
      
      // Hacer scroll para cargar más mensajes
      await scrollUpChat(page, 3);
      
      // Obtener info del chat
      const chatInfo = await getChatInfo(page);
      
      // Extraer mensajes
      const rawMessages = await extractMessagesFromChat(page);
      
      // Obtener número de teléfono para la ruta de media
      const phoneNumber = (chatInfo.phone || chat.title || 'unknown').replace(/[^0-9]/g, '');
      
      // Procesar y subir media al S3
      onProgress({ 
        status: 'uploading_media', 
        message: `Subiendo media de: ${chat.title}`, 
        current: i + 1, 
        total: totalChats 
      });
      
      const messages = await processAndUploadMedia(page, rawMessages, phoneNumber);
      
      allChats.push({
        chatIndex: i,
        name: chatInfo.name || chat.title,
        phone: chatInfo.phone,
        messageCount: messages.length,
        messages: messages,
        extractedAt: new Date().toISOString(),
      });
      
      onProgress({ 
        status: 'extracted', 
        message: `${chat.title}: ${messages.length} mensajes`, 
        current: i + 1, 
        total: totalChats 
      });
      
      // Pequeña pausa entre chats
      await page.waitForTimeout(500);
    }
    
    onProgress({ status: 'uploading', message: 'Subiendo backup al servidor...' });
    
    // Preparar datos para backup
    const backupData = {
      type: 'chat_backup',
      totalChats: allChats.length,
      totalMessages: allChats.reduce((sum, c) => sum + c.messageCount, 0),
      chats: allChats,
      extractedAt: new Date().toISOString(),
    };
    
    // Enviar al servidor
    const success = await sendBackup(backupData);
    
    if (success) {
      onProgress({ status: 'complete', message: 'Backup completado exitosamente' });
    } else {
      onProgress({ status: 'error', message: 'Error al subir backup al servidor' });
    }
    
    return {
      success,
      totalChats: allChats.length,
      totalMessages: backupData.totalMessages,
      data: backupData,
    };
    
  } catch (error) {
    onProgress({ status: 'error', message: `Error: ${error.message}` });
    throw error;
  }
}

/**
 * Inyecta el botón de backup en la UI
 * @param {Object} page - Instancia de Playwright page
 */
export async function injectBackupButton(page) {
  await page.evaluate(() => {
    // Verificar si ya existe
    if (document.getElementById('backup-chats-btn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'backup-chats-btn';
    btn.innerHTML = '☁️ Respaldar Chats';
    btn.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 24px;
      border: none;
      border-radius: 25px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      z-index: 999999;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      transition: all 0.3s ease;
    `;
    
    btn.onmouseover = () => {
      btn.style.transform = 'translateX(-50%) scale(1.05)';
      btn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
    };
    
    btn.onmouseout = () => {
      btn.style.transform = 'translateX(-50%) scale(1)';
      btn.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
    };
    
    btn.onclick = () => {
      window.__startChatBackup = true;
    };
    
    document.body.appendChild(btn);
  });
}

/**
 * Muestra el overlay de progreso del backup
 * @param {Object} page - Instancia de Playwright page
 * @param {Object} progress - Estado del progreso
 */
export async function updateBackupProgress(page, progress) {
  await page.evaluate((prog) => {
    let overlay = document.getElementById('backup-progress-overlay');
    
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'backup-progress-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        color: white;
      `;
      document.body.appendChild(overlay);
    }
    
    const percentage = prog.total ? Math.round((prog.current / prog.total) * 100) : 0;
    
    let statusIcon = '⏳';
    let statusColor = '#667eea';
    
    if (prog.status === 'complete') {
      statusIcon = '✅';
      statusColor = '#25D366';
    } else if (prog.status === 'error') {
      statusIcon = '❌';
      statusColor = '#ff6b6b';
    } else if (prog.status === 'uploading') {
      statusIcon = '☁️';
      statusColor = '#667eea';
    }
    
    overlay.innerHTML = `
      <div style="text-align: center; padding: 40px; background: rgba(30, 30, 30, 0.95); border-radius: 20px; border: 2px solid ${statusColor}; min-width: 400px;">
        <div style="font-size: 60px; margin-bottom: 20px;">${statusIcon}</div>
        <h1 style="margin: 0 0 10px 0; font-size: 24px; color: ${statusColor};">Respaldando Chats</h1>
        <p style="margin: 0 0 20px 0; font-size: 16px; opacity: 0.9;">${prog.message}</p>
        ${prog.total ? `
          <div style="background: #333; border-radius: 10px; height: 20px; margin: 20px 0; overflow: hidden;">
            <div style="background: linear-gradient(90deg, #667eea, #764ba2); height: 100%; width: ${percentage}%; transition: width 0.3s;"></div>
          </div>
          <p style="margin: 0; font-size: 14px; opacity: 0.7;">${prog.current || 0} / ${prog.total} chats (${percentage}%)</p>
        ` : ''}
        ${prog.status === 'complete' || prog.status === 'error' ? `
          <button id="close-backup-overlay" style="
            margin-top: 20px;
            padding: 12px 30px;
            background: ${statusColor};
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            cursor: pointer;
          ">Cerrar</button>
        ` : ''}
      </div>
    `;
    
    // Agregar listener al botón de cerrar
    const closeBtn = document.getElementById('close-backup-overlay');
    if (closeBtn) {
      closeBtn.onclick = () => {
        overlay.remove();
        window.__backupComplete = true;
      };
    }
  }, progress);
}

/**
 * Remueve el overlay de progreso
 * @param {Object} page - Instancia de Playwright page
 */
export async function removeBackupProgress(page) {
  await page.evaluate(() => {
    const overlay = document.getElementById('backup-progress-overlay');
    if (overlay) overlay.remove();
  });
}

/**
 * Verifica si el usuario solicitó iniciar backup
 * @param {Object} page - Instancia de Playwright page
 * @returns {Promise<boolean>}
 */
export async function checkBackupRequested(page) {
  return await page.evaluate(() => {
    if (window.__startChatBackup) {
      window.__startChatBackup = false;
      return true;
    }
    return false;
  });
}

/**
 * Inicia el loop de monitoreo para el botón de backup
 * @param {Object} page - Instancia de Playwright page
 */
export async function startBackupMonitor(page) {
  // Inyectar botón
  await injectBackupButton(page);
  
  // Loop de monitoreo
  const checkInterval = setInterval(async () => {
    try {
      const requested = await checkBackupRequested(page);
      
      if (requested) {
        console.log('☁️  Iniciando respaldo de chats...');
        
        try {
          await runChatBackup(page, async (progress) => {
            console.log(`[Backup] ${progress.status}: ${progress.message}`);
            await updateBackupProgress(page, progress);
          });
        } catch (error) {
          console.error('Error en backup:', error.message);
          await updateBackupProgress(page, { 
            status: 'error', 
            message: error.message 
          });
        }
      }
      
      // Re-inyectar botón si fue removido
      await injectBackupButton(page);
      
    } catch (e) {
      // Página cerrada o error, detener monitoreo
      clearInterval(checkInterval);
    }
  }, 1000);
  
  return checkInterval;
}
