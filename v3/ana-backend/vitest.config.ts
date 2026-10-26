import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Las pruebas validan el guard de X-Admin-Key con la llave exigida.
    env: { ADMIN_AUTH_ENFORCED: 'true' },
  },
});
