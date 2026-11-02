/**
 * URLs del login central de Pernexium (login.pernexium.com.mx). El formulario,
 * el MFA y la contraseña vencida viven allá; aquí solo se manda con la URL de
 * vuelta. El login central valida `redirect` contra su allowlist
 * (*.pernexium.com.mx por https; localhost solo en desarrollo).
 */

/** Base del login central: `NEXT_PUBLIC_LOGIN_URL` o el valor por entorno. */
export function loginBaseUrl(
  override: string | undefined = process.env.NEXT_PUBLIC_LOGIN_URL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const base = override?.trim() || (nodeEnv === 'production' ? 'https://login.pernexium.com.mx' : 'http://localhost:3100');
  return base.replace(/\/+$/, '');
}

/** Inicia sesión en el login central y vuelve a `redirect` (URL absoluta). */
export function centralLoginUrl(redirect: string, base: string = loginBaseUrl()): string {
  return `${base}/?redirect=${encodeURIComponent(redirect)}`;
}

/** Cierra la sesión compartida y vuelve al formulario conservando `redirect`. */
export function centralLogoutUrl(redirect: string, base: string = loginBaseUrl()): string {
  return `${base}/logout?redirect=${encodeURIComponent(redirect)}`;
}
