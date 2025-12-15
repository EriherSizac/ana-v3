import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFIG = {
  inputCsv: path.join(__dirname, 'contactos.csv'),
  outputCsv: path.join(__dirname, 'resultados.csv'),
  responsesCsv: path.join(__dirname, 'respuestas.csv'),
  sessionPath: path.join(__dirname, 'whatsapp-session'),
  manualSessionPath: path.join(__dirname, 'whatsapp-session-manual'), // Sesión para ventana manual
  delayBetweenMessages: 5000, // 5 segundos entre mensajes
  waitForResponse: 0, // 0 segundos = no esperar respuesta, ir directo al siguiente
  useClipboardMedia: false, // Si es true, intentará pegar media desde el portapapeles antes del texto
  showOverlay: true, // Si es true, muestra un overlay para evitar interacción del usuario
  enableManualWindow: true, // Si es true, abre ventana para respuestas manuales
};

export const __dirname_export = __dirname;
