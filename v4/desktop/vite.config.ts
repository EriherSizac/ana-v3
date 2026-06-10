// File: vite.config
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Renderer (React) en src/. El main de Electron se compila aparte con tsc.
export default defineConfig({
  root: 'src',
  base: './',
  // root es src/, pero el .env vive en desktop/ → léelo de ahí.
  envDir: resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: { port: 5173 },
});
