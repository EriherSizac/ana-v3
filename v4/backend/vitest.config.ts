import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    // Los módulos leen process.env al cargar: valores de prueba (sin AWS real).
    env: {
      AGENTS_TABLE: 'agents-test',
      ROLEPERMS_TABLE: 'roleperms-test',
      ACCESS_CACHE_TABLE: 'accesscache-test',
      UPLOADS_TABLE: 'uploads-test',
      // Canal realtime: sin REALTIME_BUS no se publica (las pruebas lo fijan cuando lo necesitan).
      REALTIME_TABLE: 'realtime-test',
      STAGE: 'test',
      CSV_BUCKET: 'csv-test',
      MEDIA_BUCKET: 'media-test',
      JOBS_TABLE: 'jobs-test',
      CONVERSATIONS_TABLE: 'conv-test',
      MESSAGES_TABLE: 'msg-test',
      V3_BUCKET: 'ana-backend-storage-test',
      V3_BUCKET_REGION: 'us-east-1',
      ROLES_API_BASE: 'https://roles.test.invalid',
      ROLES_API_KEY: 'fake-roles-key',
      DASHBOARD_BASE_PATH: 'https://dash.test.invalid',
      DASHBOARD_API_KEY: 'fake-dash-key',
      AWS_REGION: 'us-east-2',
      AWS_ACCESS_KEY_ID: 'AKIAFAKE',
      AWS_SECRET_ACCESS_KEY: 'fake',
    },
  },
});
