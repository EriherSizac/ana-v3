/**
 * Sanitiza el parámetro `next` del login: solo rutas relativas internas
 * (empiezan con un único `/`, sin esquema, sin `//` ni `\`). Cualquier otra
 * cosa → `/`.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/';
  let value: string;
  try {
    value = decodeURIComponent(raw).trim();
  } catch {
    return '/';
  }
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.startsWith('/\\') || value.includes('\\')) return '/';
  // Sin caracteres de control (p. ej. `/\t/ejemplo.com`).
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'http://internal.invalid');
    if (url.origin !== 'http://internal.invalid') return '/';
    if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

/** `/login?next=<ruta actual>` */
export function loginUrl(currentPath: string): string {
  return `/login?next=${encodeURIComponent(currentPath || '/')}`;
}
