// File: vite.config
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { buildCsp } from './src/lib/csp';

const DEV_SERVER = 'http://localhost:5173';

/**
 * Inyecta la Content-Security-Policy como <meta http-equiv> (funciona con
 * file:// en el build instalado). El origen de la API sale de VITE_API_BASE;
 * en `vite` (serve) se agregan el servidor de dev y su websocket.
 */
function cspPlugin(apiBase: string | undefined, isDev: boolean): Plugin {
  const csp = buildCsp({ apiBase, devServer: isDev ? DEV_SERVER : null });
  return {
    name: 'ana-csp',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

// Renderer (React) en src/. El main de Electron se compila aparte con tsc.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, resolve(__dirname), 'VITE_');
  return {
    root: 'src',
    base: './',
    // root es src/, pero el .env vive en desktop/ → léelo de ahí.
    envDir: resolve(__dirname),
    plugins: [react(), cspPlugin(env.VITE_API_BASE, command === 'serve')],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
    },
    server: { port: 5173 },
  };
});
