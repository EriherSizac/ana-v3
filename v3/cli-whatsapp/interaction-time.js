/**
 * Fecha y hora de las interacciones que el CLI registra en el CRM (módulo puro).
 * Siempre en la zona de Ciudad de México, sin depender de la zona del equipo.
 */

export const INTERACTIONS_TIME_ZONE = 'America/Mexico_City';

const formatters = new Map();
let warnedFallback = false;

function getFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
    );
  }
  return formatters.get(timeZone);
}

const pad2 = (n) => String(n).padStart(2, '0');

function localParts(date) {
  return {
    year: String(date.getFullYear()),
    month: pad2(date.getMonth() + 1),
    day: pad2(date.getDate()),
    hour: pad2(date.getHours()),
    minute: pad2(date.getMinutes()),
  };
}

function zonedParts(date, timeZone) {
  try {
    const parts = {};
    for (const p of getFormatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
    // Defensa ante ICU antiguos que devuelven "24" a medianoche
    if (parts.hour === '24') parts.hour = '00';
    return parts;
  } catch (e) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn(`⚠️  Zona horaria ${timeZone} no disponible (${e?.message || e}); usando la hora local del equipo`);
    }
    return localParts(date);
  }
}

/**
 * @param {Date} [date] - Instante (por defecto, ahora)
 * @param {string} [timeZone] - Zona IANA (por defecto America/Mexico_City)
 * @returns {{ contact_date: string, contact_time: string, range_time: string }}
 */
export function interactionDateTime(date = new Date(), timeZone = INTERACTIONS_TIME_ZONE) {
  const { year, month, day, hour, minute } = zonedParts(date, timeZone);
  const h = parseInt(hour, 10);
  const nextH = pad2((h + 1) % 24);
  const hh = pad2(h);
  return {
    contact_date: `${year}-${month}-${day}`,
    contact_time: `${hh}:${minute}`,
    range_time: `${hh}:00 - ${nextH}:00`,
  };
}
