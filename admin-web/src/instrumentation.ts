// Next.js ejecuta register() al arrancar el servidor: si falta una variable de
// servidor, el proceso falla en el arranque y no a mitad de una solicitud.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./server/env');
    validateEnv();
  }
}
