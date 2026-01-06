import path from 'path';

const baseDir = process.env.ANA_DATA_DIR || process.cwd();

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
