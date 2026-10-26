/**
 * Lógica pura del modal "Números sin WhatsApp" (sin importar config.js, que crea
 * directorios al importarse): lectura de resultados.csv, almacén local de consultas
 * registradas y armado de interacciones "Consulta No Whatsapp".
 */
import fs from 'fs';
import { Readable } from 'stream';
import csvParser from 'csv-parser';
import { phone } from './phone-utils.js';
import { interactionDateTime } from './interaction-time.js';

export const MAX_INTERACTIONS_PER_BATCH = 200;
export const REGISTRY_RETENTION_DAYS = 7;
export const REGISTRY_FILE_NAME = 'no-whatsapp-consultas.json';

/**
 * Teléfonos (últimos 10 dígitos, únicos, en orden de aparición) con status `no_whatsapp`.
 * @param {string} csvText - Contenido de resultados.csv
 * @returns {Promise<string[]>}
 */
export function parseNoWhatsappPhones(csvText) {
  const text = String(csvText || '');
  if (!text.trim()) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    const phones = [];
    const seen = new Set();
    let headersOk = false;
    Readable.from([text])
      .pipe(
        csvParser({
          mapHeaders: ({ header }) => String(header || '').replace(/^﻿/, '').trim().toLowerCase(),
        })
      )
      .on('headers', (headers) => {
        headersOk = headers.includes('phone') && headers.includes('status');
      })
      .on('data', (row) => {
        if (!headersOk) return;
        if (String(row.status || '').trim() !== 'no_whatsapp') return;
        const last10 = phone.toLast10(row.phone);
        if (!last10 || seen.has(last10)) return;
        seen.add(last10);
        phones.push(last10);
      })
      .on('end', () => resolve(headersOk ? phones : []))
      .on('error', reject);
  });
}

/**
 * Día del agente (America/Mexico_City, igual que contact_date de las interacciones).
 * @param {Date} [date]
 * @returns {string} YYYY-MM-DD
 */
export function localDateKey(date = new Date()) {
  return interactionDateTime(date).contact_date;
}

export function registryKey(agentId, campaign, date = new Date()) {
  return `${String(agentId || '')}|${String(campaign || '')}|${localDateKey(date)}`;
}

const emptyRegistry = () => ({ version: 1, entries: {} });

/**
 * @param {string} filePath
 * @returns {{ version: number, entries: Record<string, string[]> }}
 */
export function loadRegistry(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return emptyRegistry();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
      return emptyRegistry();
    }
    const entries = {};
    for (const [key, list] of Object.entries(parsed.entries)) {
      if (Array.isArray(list)) entries[key] = list.map(String);
    }
    return { version: 1, entries };
  } catch (_) {
    return emptyRegistry();
  }
}

function pruneEntries(entries, now) {
  const cutoff = new Date(now.getTime() - REGISTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffKey = localDateKey(cutoff);
  const kept = {};
  for (const [key, list] of Object.entries(entries || {})) {
    const datePart = key.split('|').pop();
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart >= cutoffKey) kept[key] = list;
  }
  return kept;
}

/**
 * Guarda el registro (poda entradas de más de 7 días; escritura atómica *.tmp + rename).
 */
export function saveRegistry(filePath, registry, now = new Date()) {
  const data = { version: 1, entries: pruneEntries(registry && registry.entries, now) };
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
  return data;
}

export function pendingPhones(registry, key, phones) {
  const done = new Set(((registry && registry.entries && registry.entries[key]) || []).map(String));
  return (phones || []).filter((p) => !done.has(String(p)));
}

export function markRegistered(registry, key, phones) {
  const reg = registry && registry.entries ? registry : emptyRegistry();
  const current = reg.entries[key] || [];
  const set = new Set(current.map(String));
  for (const p of phones || []) set.add(String(p));
  reg.entries[key] = Array.from(set);
  return reg;
}

/** Solo `true` estricto habilita el registro. */
export function registrationEnabledFrom(value) {
  return value === true;
}

/**
 * Interacciones "Consulta No Whatsapp" (máximo 200).
 */
export function buildConsultaInteractions({ phones10, campaignName, userId, now = new Date() }) {
  const { contact_date, contact_time, range_time } = interactionDateTime(now);
  return (phones10 || []).slice(0, MAX_INTERACTIONS_PER_BATCH).map((phone10) => ({
    credit_id: '',
    campaign_name: String(campaignName || ''),
    user_id: userId,
    subdictamen: 'Consulta No Whatsapp',
    contact_date,
    contact_time,
    range_time,
    action_channel: 'whatsapp',
    action: 'whatsapp',
    contactable: false,
    phone_number: String(phone10 || ''),
    email_address: null,
    template_used: null,
    comments: 'no_whatsapp_info_registered',
    promise_date: null,
    promise_amount: null,
    promise_payment_plan: null,
    inoutbound: 'inbound',
    payment_made_date: null,
  }));
}

/**
 * Lee el ajuste con `getter` y lo normaliza; cualquier excepción ⇒ false.
 * @param {() => unknown} getter
 */
export function readRegistrationSetting(getter) {
  try {
    return registrationEnabledFrom(typeof getter === 'function' ? getter() : undefined);
  } catch (_) {
    return false;
  }
}
