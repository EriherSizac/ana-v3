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
export const API_BASE_URL = process.env.ANA_API_URL || 'https://your-api-url.execute-api.us-east-1.amazonaws.com';

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

  try {
    const response = await fetch(`${API_BASE_URL}/backups`, {
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
      console.error('❌ Error al enviar backup:', response.statusText);
      return false;
    }
  } catch (error) {
    console.error('❌ Error al enviar backup:', error.message);
    return false;
  }
}

/**
 * Obtiene chats asignados desde el servidor
 * @returns {Promise<Object|null>} Datos de chats o null si falla
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
      const data = await response.json();
      console.log('📥 Chats asignados obtenidos del servidor');
      return data;
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
 * Sube media al servidor S3
 * @param {string} phoneNumber - Número de teléfono del contacto
 * @param {string} filename - Nombre del archivo
 * @param {string} base64Data - Datos en base64
 * @param {string} contentType - Tipo MIME del archivo
 * @returns {Promise<string|null>} URL del archivo subido o null si falla
 */
export async function uploadMedia(phoneNumber, filename, base64Data, contentType) {
  const config = loadAgentConfig();
  if (!config) {
    console.error('❌ No hay configuración de agente para subir media');
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaign: config.campaign,
        agent_id: config.agent_id,
        phone_number: phoneNumber,
        filename: filename,
        content_type: contentType,
        data: base64Data,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      return result.url;
    } else {
      console.error('❌ Error al subir media:', response.statusText);
      return null;
    }
  } catch (error) {
    console.error('❌ Error al subir media:', error.message);
    return null;
  }
}
