import fs from 'fs';
import path from 'path';
import { parseAssignmentCsv } from './assignment-csv.js';
import { phone } from './phone-utils.js';

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

/**
 * Teléfono para búsqueda en el CRM (/client-info): +52 + 10 dígitos; no MX: + dígitos.
 * Alias de phone.toCrmSearchPhone (phone-utils.js).
 */
export function normalizePhoneForBackend(rawPhone) {
  return phone.toCrmSearchPhone(rawPhone);
}

export async function searchClientInfoByPhone(campaignName, phoneE164) {
  const url = `${INTERACTIONS_API_BASE_URL}/client-info`;
  try {
    const post = async (searchValue, label) => {
      const payload = {
        campaign_name: String(campaignName || ''),
        search_type: 'Telefono',
        search_value: String(searchValue || ''),
      };

      console.log('[searchClientInfoByPhone] Request:', { url, payload, label: label || null });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          "X-Api-Key": "6706bb8ef958b3f12759c471855f9aa50b357f78e2d1eee0c533b94daec11a38"
        },
        body: JSON.stringify(payload),
      });

      const rawText = await response.text().catch(() => '');
      const data = rawText ? JSON.parse(rawText) : {};
      const result = Array.isArray(data.result) ? data.result : [];

      console.log('[searchClientInfoByPhone] Response:', {
        status: response.status,
        ok: response.ok,
        resultLength: result.length,
        label: label || null,
      });

      return { response, result };
    };

    const primary = await post(phoneE164, 'primary');
    if (primary.response.ok) return primary.result;

    // Fallback: si el backend responde 404 con teléfono en formato +52..., intentar sin el prefijo +52
    const searchValueStr = String(phoneE164 || '');
    if (primary.response.status === 404 && searchValueStr.startsWith('+52')) {
      const fallbackValue = searchValueStr.slice(3);
      console.log('[searchClientInfoByPhone] 404 con +52. Reintentando sin prefijo +52...', { from: searchValueStr, to: fallbackValue });
      const secondary = await post(fallbackValue, 'retry_without_+52');
      if (secondary.response.ok) return secondary.result;
    }

    return [];
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
    const post = async (payloadToSend, label) => {
      console.log(`📤 [insertInteractions] Payload enviado${label ? ` (${label})` : ''}:`);
      console.log(JSON.stringify(payloadToSend, null, 2));

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          "X-Api-Key": "6706bb8ef958b3f12759c471855f9aa50b357f78e2d1eee0c533b94daec11a38"
        },
        body: JSON.stringify(payloadToSend),
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

      console.log(`📥 [insertInteractions] Respuesta del backend (${response.status})${label ? ` (${label})` : ''}:`);
      console.log(JSON.stringify(parsed, null, 2));

      return { response, text, parsed };
    };

    const payload = { interactions };
    const first = await post(payload, 'primary');

    // Retry: si el backend responde 404 con teléfono en formato +52..., intentar sin el prefijo +52
    if (first.response.status === 404) {
      const stripPlus52 = (v) => {
        const s = String(v || '');
        return s.startsWith('+52') ? s.slice(3) : s;
      };

      const phoneKeys = ['phone_number', 'contact_phone', 'phone'];
      const needsRetry = Array.isArray(interactions) && interactions.some((it) =>
        phoneKeys.some((k) => typeof it?.[k] === 'string' && it[k].startsWith('+52'))
      );

      if (needsRetry) {
        const interactionsRetry = interactions.map((it) => {
          const next = { ...(it || {}) };
          phoneKeys.forEach((k) => {
            if (typeof next[k] === 'string') next[k] = stripPlus52(next[k]);
          });
          return next;
        });
        const retryPayload = { interactions: interactionsRetry };
        console.log('🔁 [insertInteractions] 404 con +52. Reintentando sin prefijo +52...');
        const second = await post(retryPayload, 'retry_without_+52');

        if (!second.response.ok) {
          console.error(`❌ insertInteractions failed: ${second.response.status} ${second.response.statusText}`);
          if (second.text) console.error(`   Body: ${second.text}`);
          return { ok: false, status: second.response.status, body: second.parsed };
        }

        return { ok: true, status: second.response.status, body: second.parsed };
      }
    }

    if (!first.response.ok) {
      console.error(`❌ insertInteractions failed: ${first.response.status} ${first.response.statusText}`);
      if (first.text) console.error(`   Body: ${first.text}`);
      return { ok: false, status: first.response.status, body: first.parsed };
    }

    return { ok: true, status: first.response.status, body: first.parsed };
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
    const safe = { ...(config || {}) };
    delete safe.dailyPassword;
    delete safe.daily_password;
    delete safe.daily_password_word;
    delete safe.palabraDelDia;
    delete safe.palabra_del_dia;
    delete safe.dailyWord;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(safe, null, 2));
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
 * Obtiene chats asignados desde el servidor
 * @returns {Promise<{ csvText: string, contacts: Array }|null>} CSV crudo recibido y
 *   contactos parseados, o null si no hay asignación o falla
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
      const contacts = parseAssignmentCsv(csvText);
      console.log(`✅ ${contacts.length} contactos parseados del servidor`);
      return { csvText, contacts };
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
 * @param {Array} contacts - Filas originales de los contactos restantes
 * @param {{ assignment_id: string, contacts: Array }} [review] - Contactos por revisar
 *   de la asignación (solo se envía si viene)
 * @returns {Promise<boolean>} true si la actualización fue exitosa
 */
export async function updatePendingContacts(contacts, review) {
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
        ...(review ? { review } : {}),
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
