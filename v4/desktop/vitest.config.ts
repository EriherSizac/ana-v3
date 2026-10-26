// File: vitest.config
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { defineConfig } from 'vitest/config';

// Solo módulos puros (sin Electron ni DOM): main process y helpers del renderer.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'src/lib/**/*.test.ts'],
  },
});
