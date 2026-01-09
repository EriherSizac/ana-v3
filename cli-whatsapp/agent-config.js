import fs from 'fs';
import path from 'path';

const resolveBaseDir = () => {
  if (process.env.ANA_DATA_DIR) return process.env.ANA_DATA_DIR;

  const appData = process.env.APPDATA;
  if (appData) return path.join(appData, 'ANA');

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return path.join(localAppData, 'ANA');

  return process.cwd();
};

const baseDir = resolveBaseDir();
try {
  fs.mkdirSync(baseDir, { recursive: true });
} catch (e) {
  // ignore
}

export function normalizePhoneForBackend(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 11 && digits.startsWith('52')) return `+${digits}`;
  if (digits.startsWith('521') && digits.length >= 13) return `+52${digits.slice(3)}`;
  if (digits.startsWith('52')) return `+${digits}`;

  return digits.startsWith('+') ? digits : `+${digits}`;
}

export async function searchClientInfoByPhone(campaignName, phoneE164) {
  const url = `${INTERACTIONS_API_BASE_URL}/client-info`;
  try {
    const payload = {
      campaign_name: String(campaignName || ''),
      phone_number: String(phoneE164 || ''),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text().catch(() => '');
    const data = rawText ? JSON.parse(rawText) : {};
    const result = Array.isArray(data.result) ? data.result : [];
    if (!response.ok) return [];
    return result;
  } catch (error) {
    console.error('❌ Error al buscar client-info:', error.message);
    return [];
  }
}

const CONFIG_FILE = path.join(baseDir, '.agent-config.json');

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

export async function insertInteractions(interactions) {
  const url = `${INTERACTIONS_API_BASE_URL}/interactions`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ interactions }),
    });

    const text = await response.text().catch(() => '');
    let parsed = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        parsed = { raw: text };
      }
    }

    if (!response.ok) {
      console.error(`❌ insertInteractions failed: ${response.status} ${response.statusText}`);
      if (text) console.error(`   Body: ${text}`);
      return { ok: false, status: response.status, body: parsed };
    }

    return { ok: true, status: response.status, body: parsed };
  } catch (error) {
    console.error('❌ Error al insertar interacción:', error.message);
    console.error('   URL:', url);
    return { ok: false, status: 0, body: null, error: error.message };
  }
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
export const INTERACTIONS_API_BASE_URL = process.env.ANA_INTERACTIONS_API_URL || 'https://7uj0qjoby9.execute-api.us-east-2.amazonaws.com';

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
 * Parsea CSV a array de objetos (maneja campos con comillas dobles y comas)
 * @param {string} csvText - Texto CSV
 * @returns {Array} Array de objetos con los datos del CSV
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  // Función para parsear una línea CSV respetando comillas dobles
  const parseCSVLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Comilla doble escapada ""
          current += '"';
          i++; // Saltar la siguiente comilla
        } else {
          // Toggle estado de comillas
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Coma fuera de comillas = separador de campo
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Agregar el último campo
    values.push(current.trim());
    
    return values;
  };
  
  const headers = parseCSVLine(lines[0]);
  const contacts = [];
  
  // Mapeo de nombres de columnas del servidor a nombres esperados por el cliente
  const fieldMapping = {
    'phone_number': 'phone',
    'contact_phone': 'phone',
    'contact_pho': 'phone',
    'phone': 'phone',
    'contact_name': 'name',
    'first_name': 'first_name',
    'last_name': 'last_name',
    'name': 'name',
    'message': 'message',
    'credit': 'credit',
    'credit_id': 'credit',
    'discount': 'discount',
    'total_balance': 'total_balance',
    'product': 'product',
  };
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
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
    const agentId = encodeURIComponent(String(config.agent_id || ''));
    const campaignId = encodeURIComponent(String(config.campaign || ''));
    const url = `${API_BASE_URL}/get/chats/${agentId}/${campaignId}`;
    console.log(`📡 Consultando contactos en: ${url}`);
    
    const response = await fetch(url);

    if (response.ok) {
      const csvText = await response.text();
      console.log(`📥 CSV recibido (${csvText.length} caracteres)`);
      console.log(csvText);
      const contacts = parseCSV(csvText);
      console.log(`✅ ${contacts.length} contactos parseados del servidor`);
      return contacts;
    } else if (response.status === 404) {
      console.log('ℹ️  No hay contactos asignados aún para este agente/campaña');
      return null;
    } else {
      console.error(`❌ Error al obtener contactos: ${response.status} ${response.statusText}`);
      const errorText = await response.text().catch(() => 'No response body');
      console.error(`   Respuesta: ${errorText}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Error al obtener contactos:', error.message);
    console.error('   Stack:', error.stack);
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
