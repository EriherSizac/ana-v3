// setup-env.js
// Este archivo DEBE importarse ANTES que cualquier módulo de Playwright
// Configura las variables de entorno necesarias para usar navegadores empaquetados

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detectar si estamos en un entorno empaquetado (instalador portable)
const isPackaged = () => {
  // Verificar si existe la carpeta "browsers" en el directorio padre
  const parentDir = path.dirname(__dirname);
  const browsersPath = path.join(parentDir, 'browsers');
  
  if (fs.existsSync(browsersPath)) {
    return browsersPath;
  }
  
  // Verificar en el mismo directorio (para desarrollo)
  const localBrowsersPath = path.join(__dirname, 'browsers');
  if (fs.existsSync(localBrowsersPath)) {
    return localBrowsersPath;
  }
  
  return null;
};

// Configurar PLAYWRIGHT_BROWSERS_PATH si estamos empaquetados
const packagedBrowsersPath = isPackaged();

if (packagedBrowsersPath) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = packagedBrowsersPath;
  console.log(`✓ Usando navegadores empaquetados: ${packagedBrowsersPath}`);
} else {
  console.log('ℹ Usando navegadores del sistema (modo desarrollo)');
}

// Exportar información útil
export const BROWSERS_PATH = packagedBrowsersPath || process.env.PLAYWRIGHT_BROWSERS_PATH;
export const IS_PACKAGED = !!packagedBrowsersPath;
