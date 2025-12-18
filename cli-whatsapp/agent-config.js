import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '.agent-config.json');

/**
 * Carga la configuración del agente desde el archivo
 * @returns {Object|null} Configuración del agente o null si no existe
 */
export function loadAgentConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error al cargar configuración del agente:', error.message);
  }
  return null;
}

/**
 * Guarda la configuración del agente en el archivo
 * @param {Object} config - Configuración a guardar
 */
export function saveAgentConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('✅ Configuración del agente guardada');
  } catch (error) {
    console.error('Error al guardar configuración del agente:', error.message);
  }
}

/**
 * Verifica si existe configuración del agente
 * @returns {boolean}
 */
export function hasAgentConfig() {
  return fs.existsSync(CONFIG_FILE);
}

/**
 * Elimina la configuración del agente
 */
export function clearAgentConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      console.log('🗑️  Configuración del agente eliminada');
    }
  } catch (error) {
    console.error('Error al eliminar configuración del agente:', error.message);
  }
}

/**
 * URL base del API backend
 */
export const API_BASE_URL = process.env.ANA_API_URL || 'https://ow24p7ablb.execute-api.us-east-1.amazonaws.com';

/**
 * Envía backup al servidor
 * @param {Object} data - Datos a respaldar
 * @returns {Promise<boolean>} true si el backup fue exitoso
 */
export async function sendBackup(data) {
  const config = loadAgentConfig();
  if (!config) {
    console.error('❌ No hay configuración de agente para enviar backup');
    return false;
  }

  const url = `${API_BASE_URL}/backups`;
  console.log(`📤 Enviando backup a: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaign: config.campaign,
        agent_id: config.agent_id,
        data: data,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`☁️  Backup enviado: ${result.path}`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ Error al enviar backup: ${response.status} ${response.statusText}`);
      console.error(`   Respuesta: ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Error al enviar backup:', error.message);
    console.error('   URL:', url);
    console.error('   Stack:', error.stack);
    if (error.cause) {
      console.error('   Causa:', error.cause.message || error.cause);
      console.error('   Causa code:', error.cause.code);
    }
    return false;
  }
}

/**
 * Parsea CSV a array de objetos
 * @param {string} csvText - Texto CSV
 * @returns {Array} Array de objetos con los datos del CSV
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const contacts = [];
  
  // Mapeo de nombres de columnas del servidor a nombres esperados por el cliente
  const fieldMapping = {
    'contact_phone': 'phone',
    'contact_name': 'name',
  };
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length >= headers.length) {
      const contact = {};
      headers.forEach((header, idx) => {
        // Usar el nombre mapeado si existe, sino usar el original
        const fieldName = fieldMapping[header] || header;
        contact[fieldName] = values[idx] || '';
      });
      contacts.push(contact);
    }
  }
  
  return contacts;
}

/**
 * Obtiene chats asignados desde el servidor
 * @returns {Promise<Array|null>} Array de contactos o null si falla
 */
export async function fetchAssignedChats() {
  const config = loadAgentConfig();
  if (!config) {
    console.error('❌ No hay configuración de agente para obtener chats');
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/get/chats/${config.agent_id}-${config.campaign}`);

    if (response.ok) {
      const csvText = await response.text();
      const contacts = parseCSV(csvText);
      console.log('📥 Chats asignados obtenidos del servidor');
      return contacts;
    } else if (response.status === 404) {
      console.log('ℹ️  No hay chats asignados aún');
      return null;
    } else {
      console.error('❌ Error al obtener chats:', response.statusText);
      return null;
    }
  } catch (error) {
    console.error('❌ Error al obtener chats:', error.message);
    return null;
  }
}

/**
 * Actualiza los contactos pendientes en el servidor
 * @param {Array} contacts - Array de contactos restantes
 * @returns {Promise<boolean>} true si la actualización fue exitosa
 */
export async function updatePendingContacts(contacts) {
  const config = loadAgentConfig();
  if (!config) {
    console.error('❌ No hay configuración de agente para actualizar contactos');
    return false;
  }

  const url = `${API_BASE_URL}/contacts/pending`;
  console.log(`📤 Actualizando contactos pendientes en: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaign: config.campaign,
        agent_id: config.agent_id,
        contacts: contacts,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Contactos pendientes actualizados: ${result.remainingContacts} restantes`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ Error al actualizar contactos: ${response.status} ${response.statusText}`);
      console.error(`   Respuesta: ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Error al actualizar contactos:', error.message);
    return false;
  }
}

/**
 * Sube media al servidor S3
 * @param {string} filename - Nombre del archivo
 * @param {string} base64Data - Datos en base64
 * @param {string} contentType - Tipo MIME del archivo
 * @returns {Promise<string|null>} URL del archivo subido o null si falla
 */
export async function uploadMedia(filename, base64Data, contentType) {
  const config = loadAgentConfig();
  if (!config) {
    console.error('❌ No hay configuración de agente para subir media');
    return null;
  }

  const safeFilename = filename || `media_${Date.now()}`;
  
  if (!base64Data) {
    console.error('❌ No hay datos de media para subir');
    return null;
  }

  const url = `${API_BASE_URL}/media`;
  console.log(`📤 Subiendo media a: ${url}`);
  console.log(`   Campaign: ${config.campaign}, Agent: ${config.agent_id}`);
  console.log(`   Archivo: ${safeFilename}, Tamaño: ${Math.round(base64Data.length / 1024)}KB`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaign: config.campaign,
        agent_id: config.agent_id,
        filename: safeFilename,
        content_type: contentType || 'application/octet-stream',
        data: base64Data,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Media subida: ${result.url}`);
      return result.url;
    } else {
      const errorText = await response.text();
      console.error(`❌ Error al subir media: ${response.status} ${response.statusText}`);
      console.error(`   Respuesta: ${errorText}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Error al subir media:', error.message);
    console.error('   URL:', url);
    console.error('   Stack:', error.stack);
    if (error.cause) {
      console.error('   Causa:', error.cause.message || error.cause);
      console.error('   Causa code:', error.cause.code);
    }
    return null;
  }
}
