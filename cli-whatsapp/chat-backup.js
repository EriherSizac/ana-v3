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
    if (!mainContainer) {
      console.log('[Backup] No se encontró #main');
      return messages;
    }
    
    // Debug: verificar si hay elementos con data-id
    const allDataIds = mainContainer.querySelectorAll('[data-id]');
    console.log(`[Backup] Total elementos con data-id: ${allDataIds.length}`);
    
    // Buscar todos los contenedores de mensajes con data-id que empiecen con "true_" o "false_"
    // Estos son los IDs de mensajes reales de WhatsApp
    const messageContainers = Array.from(allDataIds).filter(el => {
      const dataId = el.getAttribute('data-id');
      return dataId && (dataId.startsWith('true_') || dataId.startsWith('false_'));
    });
    
    console.log(`[Backup] Mensajes filtrados (true_/false_): ${messageContainers.length}`);
    
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
 * @returns {Promise<Array>} Mensajes con URLs de media actualizadas
 */
async function processAndUploadMedia(page, messages) {
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
  try {
    // Ocultar overlay temporalmente para permitir clics
    await page.evaluate(() => {
      const overlay = document.getElementById('backup-progress-overlay');
      if (overlay) overlay.style.pointerEvents = 'none';
    });
    
    // Usar Playwright locator para hacer clic de forma más confiable
    const chatRows = page.locator('#pane-side [role="row"]');
    const count = await chatRows.count();
    
    if (index < count) {
      await chatRows.nth(index).click({ timeout: 3000 });
    } else {
      console.log(`⚠️ Índice ${index} fuera de rango (total: ${count})`);
    }
    
    // Restaurar overlay
    await page.evaluate(() => {
      const overlay = document.getElementById('backup-progress-overlay');
      if (overlay) overlay.style.pointerEvents = 'auto';
    });
  } catch (e) {
    console.log(`⚠️ Error al hacer clic en chat ${index}: ${e.message}`);
  }
  
  // Esperar a que cargue el chat
  await page.waitForTimeout(1000);
}

/**
 * Hace scroll en la lista de contactos para asegurar que el chat en el índice dado esté visible
 * @param {Object} page - Instancia de Playwright page
 * @param {number} targetIndex - Índice del chat que queremos que esté visible
 */
async function scrollToChat(page, targetIndex) {
  await page.evaluate((idx) => {
    const paneSize = document.querySelector('#pane-side');
    if (!paneSize) return;
    
    const chatRows = paneSize.querySelectorAll('[role="row"]');
    if (chatRows[idx]) {
      // Hacer scroll para que el elemento esté visible
      chatRows[idx].scrollIntoView({ behavior: 'instant', block: 'center' });
    } else {
      // Si no existe, hacer scroll hacia abajo para cargar más
      paneSize.scrollTop = paneSize.scrollHeight;
    }
  }, targetIndex);
  await page.waitForTimeout(300);
}

/**
 * Obtiene el chat en un índice específico (con scroll si es necesario)
 * @param {Object} page - Instancia de Playwright page
 * @param {number} index - Índice del chat
 * @returns {Promise<Object|null>} Info del chat o null
 */
async function getChatAtIndex(page, index) {
  // Primero hacer scroll para asegurar que el chat esté en el DOM
  await scrollToChat(page, index);
  
  return await page.evaluate((idx) => {
    const paneSize = document.querySelector('#pane-side');
    if (!paneSize) return null;
    
    const chatRows = paneSize.querySelectorAll('[role="row"]');
    const chat = chatRows[idx];
    
    if (!chat) return null;
    
    try {
      const titleEl = chat.querySelector('span[dir="auto"][title]');
      const title = titleEl ? titleEl.getAttribute('title') : `Chat ${idx + 1}`;
      
      const lastMsgEl = chat.querySelector('span[dir="ltr"]');
      const lastMessage = lastMsgEl ? lastMsgEl.textContent : '';
      
      return {
        index: idx,
        title,
        lastMessage,
      };
    } catch (e) {
      return null;
    }
  }, index);
}

/**
 * Cuenta el total de chats haciendo scroll completo
 * @param {Object} page - Instancia de Playwright page
 * @returns {Promise<number>} Total de chats
 */
async function countTotalChats(page) {
  console.log('📜 Contando chats disponibles...');
  
  let maxCount = 0;
  let lastCount = -1;
  let noChangeCount = 0;
  
  // Hacer scroll hasta que no aparezcan más chats
  while (noChangeCount < 3) {
    const currentCount = await page.evaluate(() => {
      const paneSize = document.querySelector('#pane-side');
      if (!paneSize) return 0;
      return paneSize.querySelectorAll('[role="row"]').length;
    });
    
    if (currentCount > maxCount) {
      maxCount = currentCount;
    }
    
    if (currentCount === lastCount) {
      noChangeCount++;
    } else {
      noChangeCount = 0;
    }
    lastCount = currentCount;
    
    // Scroll hacia abajo
    await page.evaluate(() => {
      const paneSize = document.querySelector('#pane-side');
      if (paneSize) {
        paneSize.scrollTop = paneSize.scrollHeight;
      }
    });
    await page.waitForTimeout(400);
  }
  
  // Volver al inicio
  await page.evaluate(() => {
    const paneSize = document.querySelector('#pane-side');
    if (paneSize) {
      paneSize.scrollTop = 0;
    }
  });
  await page.waitForTimeout(300);
  
  console.log(`✅ Total de chats encontrados: ${maxCount}`);
  return maxCount;
}

/**
 * Hace scroll hacia arriba en el chat para cargar más mensajes
 * @param {Object} page - Instancia de Playwright page
 * @param {number} times - Número de veces a hacer scroll
 */
async function scrollUpChat(page, times = 10) {
  let lastMessageCount = 0;
  let noChangeCount = 0;
  
  for (let i = 0; i < times; i++) {
    // Contar mensajes actuales
    const currentCount = await page.evaluate(() => {
      const mainContainer = document.querySelector('#main');
      if (!mainContainer) return 0;
      const allDataIds = mainContainer.querySelectorAll('[data-id]');
      return Array.from(allDataIds).filter(el => {
        const dataId = el.getAttribute('data-id');
        return dataId && (dataId.startsWith('true_') || dataId.startsWith('false_'));
      }).length;
    });
    
    // Si no hay cambios en 3 intentos consecutivos, detener
    if (currentCount === lastMessageCount) {
      noChangeCount++;
      if (noChangeCount >= 3) {
        console.log(`📊 Scroll detenido: ${currentCount} mensajes cargados (sin cambios en 3 intentos)`);
        break;
      }
    } else {
      noChangeCount = 0;
      console.log(`📊 Mensajes cargados: ${currentCount}`);
    }
    lastMessageCount = currentCount;
    
    await page.evaluate(() => {
      // Buscar el contenedor de mensajes con varios selectores
      const messageList = document.querySelector('[data-testid="conversation-panel-messages"]') ||
                         document.querySelector('#main [role="application"]') ||
                         document.querySelector('#main .copyable-area > div:nth-child(2)');
      if (messageList) {
        // Scroll hacia arriba de forma más agresiva
        messageList.scrollTop = 0;
        // También intentar con scrollBy para simular scroll de usuario
        messageList.scrollBy(0, -1500);
      }
    });
    // Esperar más tiempo a que se carguen los mensajes (aumentado de 500ms a 800ms)
    await page.waitForTimeout(800);
  }
  
  // Scroll final hacia abajo para asegurar que todos los mensajes están en el DOM
  await page.evaluate(() => {
    const messageList = document.querySelector('[data-testid="conversation-panel-messages"]') ||
                       document.querySelector('#main [role="application"]') ||
                       document.querySelector('#main .copyable-area > div:nth-child(2)');
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  });
  await page.waitForTimeout(500);
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
    onProgress({ status: 'starting', message: 'Contando chats disponibles...' });
    
    // Contar total de chats haciendo scroll completo
    const totalChats = await countTotalChats(page);
    
    onProgress({ status: 'found', message: `Encontrados ${totalChats} chats`, total: totalChats });
    
    for (let i = 0; i < totalChats; i++) {
      // Obtener info del chat en este índice (con scroll progresivo)
      const chat = await getChatAtIndex(page, i);
      
      if (!chat) {
        console.log(`⚠️ No se pudo obtener chat en índice ${i}, saltando...`);
        continue;
      }
      
      onProgress({ 
        status: 'processing', 
        message: `Procesando: ${chat.title}`, 
        current: i + 1, 
        total: totalChats 
      });
      
      // Hacer clic en el chat (con scroll previo para asegurarnos que está visible)
      await scrollToChat(page, i);
      await clickChat(page, i);
      
      // Esperar a que el contenedor de mensajes aparezca
      try {
        await page.waitForSelector('#main', { timeout: 10000 });
        // Esperar a que los mensajes se carguen
        await page.waitForSelector('#main [data-id]', { timeout: 8000 });
      } catch (e) {
        // Intentar una vez más con espera adicional
        await page.waitForTimeout(2000);
        const mainExists = await page.$('#main');
        if (!mainExists) {
          console.log(`⚠️ Chat ${chat.title}: No se pudo cargar contenedor de mensajes`);
          continue; // Saltar este chat si no se puede cargar
        }
      }
      
      // Esperar más tiempo para que los mensajes iniciales se rendericen
      await page.waitForTimeout(1500);
      
      // Hacer scroll para cargar más mensajes (más scrolls = más mensajes cargados)
      await scrollUpChat(page, 20);
      
      // Esperar después del scroll para que todos los mensajes se carguen
      await page.waitForTimeout(2000);
      
      // Obtener info del chat
      const chatInfo = await getChatInfo(page);
      
      // Extraer mensajes
      const rawMessages = await extractMessagesFromChat(page);
      console.log(`📝 Chat ${chat.title}: ${rawMessages.length} mensajes extraídos, ${rawMessages.filter(m => m.hasMedia).length} con media`);
      
      // Procesar y subir media al S3
      onProgress({ 
        status: 'uploading_media', 
        message: `Subiendo media de: ${chat.title}`, 
        current: i + 1, 
        total: totalChats 
      });
      
      const messages = await processAndUploadMedia(page, rawMessages);
      
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
        background: rgba(0, 0, 0, 0.3);
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
