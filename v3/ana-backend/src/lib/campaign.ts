/**
 * Normalización única de segmentos de llave S3 (campaña y agente).
 * Regla: quitar espacios laterales y convertir a minúsculas con `toLowerCase()`
 * plano (igual que el CLI). Devuelve '' si el valor no es string o queda vacío;
 * los handlers tratan '' como campo ausente.
 */
export const normalizeKeySegment = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().toLowerCase() : '';

export const normalizeCampaign = normalizeKeySegment;
export const normalizeAgent = normalizeKeySegment;

/**
 * Igual que normalizeKeySegment, para parámetros de ruta: decodifica primero
 * escapes de URL (`%20`, `%C3%B1`) por si API Gateway los entrega sin decodificar;
 * si la secuencia es inválida se usa el valor tal cual.
 */
export const normalizePathSegment = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // secuencia % inválida: se conserva el valor original
  }
  return normalizeKeySegment(value);
};

/** Llave del CSV de credenciales; recibe la campaña ya normalizada. */
export const credentialsKey = (campaign: string): string =>
  `agents/${campaign}/credentials.csv`;
