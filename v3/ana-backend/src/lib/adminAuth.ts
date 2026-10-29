import { timingSafeEqual } from 'crypto';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * Guard para rutas de supervisor/administración.
 * Exige el header `X-Admin-Key` igual a env ADMIN_API_KEY.
 * Fail-closed: si ADMIN_API_KEY no está configurada, responde 503 (nunca abre la ruta).
 * Desactivable: con ADMIN_AUTH_ENFORCED distinto de 'true' no se exige la llave
 * (decisión 2026-10-26: integraciones como motor-de-gestion aún no la envían).
 * Devuelve `null` si está autorizado, o la respuesta de error a retornar.
 */
export const requireAdmin = (
  event: Pick<APIGatewayProxyEvent, 'headers'>,
  opts: { always?: boolean } = {},
): APIGatewayProxyResult | null => {
  // `always`: rutas con datos sensibles (credenciales, lecturas de supervisor) exigen
  // la llave aunque ADMIN_AUTH_ENFORCED esté apagado; solo la carga que usa
  // motor-de-gestion-v2 depende del flag.
  if (!opts.always && process.env.ADMIN_AUTH_ENFORCED !== 'true') return null;
  const expected = process.env.ADMIN_API_KEY || '';
  if (!expected) return json(503, { success: false, message: 'Admin key no configurada' });

  const headers = event.headers || {};
  const provided =
    Object.entries(headers).find(([k]) => k.toLowerCase() === 'x-admin-key')?.[1] || '';

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json(401, { success: false, message: 'No autorizado' });
  }
  return null;
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
