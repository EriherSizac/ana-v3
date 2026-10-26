import type { APIGatewayProxyResultV2 } from 'aws-lambda';

/** Evento HTTP API (payload 2.0) con authorizer JWT, en la forma que usan las rutas /admin/*. */
export interface AdminEvent {
  headers?: Record<string, string | undefined> | null;
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
    requestId?: string;
  };
}

export type AdminResult = APIGatewayProxyResultV2 & { statusCode: number; body: string };

/** Respuesta JSON de /admin/* (`{success,...}`), sin cache. */
export const adminJson = (statusCode: number, body: unknown): AdminResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const adminOk = (data: unknown): AdminResult => adminJson(200, { success: true, data });

export const adminError = (statusCode: number, message: string, data?: unknown): AdminResult =>
  adminJson(statusCode, data === undefined ? { success: false, message } : { success: false, message, data });

/** Error interno genérico: el detalle va solo al log, nunca el header Authorization. */
export const adminInternal = (context: string, err: unknown): AdminResult => {
  const e = err as { name?: string; message?: string } | null;
  console.error(JSON.stringify({ evt: 'admin_error', context, name: e?.name ?? 'Error', message: e?.message ?? '' }));
  return adminError(500, 'Error interno del servidor');
};

/** Lee el header sin distinguir mayúsculas. */
export const header = (event: AdminEvent, name: string): string | undefined => {
  const h = event.headers || {};
  const lower = name.toLowerCase();
  return Object.entries(h).find(([k]) => k.toLowerCase() === lower)?.[1];
};

/** Parsea el body JSON. `undefined` si no es JSON válido. */
export const parseJsonBody = (event: AdminEvent): unknown => {
  if (event.body == null || event.body === '') return undefined;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};
