import fs from 'fs';
import path from 'path';

const resolveBaseDir = () => {
  if (process.env.ANA_DATA_DIR) return process.env.ANA_DATA_DIR;

  const appData = process.env.APPDATA;
  if (appData) return path.join(appData, 'ANA');

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return path.join(localAppData, 'ANA');

  return process.cwd();
};

const baseDir = resolveBaseDir();
try {
  fs.mkdirSync(baseDir, { recursive: true });
} catch (e) {
  // ignore
}

export const CONFIG = {
  apiBaseUrl: 'https://ow24p7ablb.execute-api.us-east-1.amazonaws.com', // URL del backend
  inputCsv: path.join(baseDir, 'contactos.csv'),
  outputCsv: path.join(baseDir, 'resultados.csv'),
  responsesCsv: path.join(baseDir, 'respuestas.csv'),
  sessionPath: path.join(baseDir, 'whatsapp-session'),
  manualSessionPath: path.join(baseDir, 'whatsapp-session-manual'), // Sesión para ventana manual
  delayBetweenMessages: 5000, // 5 segundos entre mensajes
  waitForResponse: 0, // 0 segundos = no esperar respuesta, ir directo al siguiente
  useClipboardMedia: false, // Si es true, intentará pegar media desde el portapapeles antes del texto
  showOverlay: true, // Si es true, muestra un overlay para evitar interacción del usuario
  enableManualWindow: true, // Si es true, abre ventana para respuestas manuales
};

export const __dirname_export = baseDir;
