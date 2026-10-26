import 'server-only';

export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_request'
  | 'payload_too_large'
  | 'access_unavailable'
  | 'upstream_unavailable'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_request: 400,
  payload_too_large: 413,
  access_unavailable: 503,
  upstream_unavailable: 503,
  internal: 500,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  unauthenticated: 'Sesión inválida',
  forbidden: 'No tienes permiso para esta acción',
  not_found: 'No encontrado',
  conflict: 'Conflicto con el estado actual. Recarga e intenta de nuevo.',
  invalid_request: 'Solicitud inválida',
  payload_too_large: 'El archivo es demasiado grande',
  access_unavailable: 'No se pudo verificar tu acceso. Intenta de nuevo.',
  upstream_unavailable: 'El servicio no está disponible. Intenta de nuevo.',
  internal: 'Error interno. Intenta de nuevo.',
};

/** Error de negocio del BFF que se traduce a `{error:{code,message}}`. */
export class HttpError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'HttpError';
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export function errorResponse(code: ErrorCode, message?: string, details?: Record<string, unknown>): Response {
  return Response.json(
    { error: { code, message: message ?? DEFAULT_MESSAGE[code], ...(details ? { details } : {}) } },
    { status: STATUS[code], headers: { 'cache-control': 'no-store' } },
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** Código uniforme para un status HTTP de backend (4xx). */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    default:
      return status >= 500 ? 'upstream_unavailable' : 'invalid_request';
  }
}

/**
 * Convierte cualquier excepción en respuesta uniforme. Los detalles técnicos
 * solo van al log del servidor (sin cuerpos de backends ni datos de contactos).
 */
export function toErrorResponse(err: unknown, context = 'bff'): Response {
  if (err instanceof HttpError) return errorResponse(err.code, err.message, err.details);
  console.error(`[${context}] error interno`, err instanceof Error ? err.message : 'desconocido');
  return errorResponse('internal');
}
