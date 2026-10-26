// File: Construye la Content-Security-Policy del renderer (puro; lo usa vite.config).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/** Origen (`https://host[:port]`) de una URL, o null si no es http(s) válida. */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * CSP del renderer: scripts y fuentes solo del paquete; conexiones a la API
 * configurada, Cognito y S3/AWS; imágenes propias, data:, blob: y S3; sin
 * objetos embebidos. En desarrollo agrega el servidor de Vite y su websocket
 * (HMR) y `'unsafe-eval'`/inline que usa el cliente de Vite/React refresh.
 */
export function buildCsp(opts: { apiBase?: string; devServer?: string | null }): string {
  const api = originOf(opts.apiBase);
  const dev = originOf(opts.devServer ?? null);
  const devWs = dev ? dev.replace(/^http/, 'ws') : null;
  const list = (...xs: (string | null | false | undefined)[]) => xs.filter(Boolean).join(' ');
  const directives: [string, string][] = [
    ['default-src', "'self'"],
    ['script-src', list("'self'", dev && "'unsafe-inline'", dev && "'unsafe-eval'", dev)],
    ['style-src', "'self' 'unsafe-inline'"],
    ['img-src', "'self' data: blob: https://*.amazonaws.com"],
    ['font-src', list("'self'", 'data:')],
    [
      'connect-src',
      list(
        "'self'",
        api,
        'https://cognito-idp.us-east-2.amazonaws.com',
        'https://*.amazonaws.com',
        dev,
        devWs,
      ),
    ],
    ['media-src', "'self' data: blob: https://*.amazonaws.com"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'none'"],
  ];
  return directives.map(([k, v]) => `${k} ${v}`).join('; ');
}
