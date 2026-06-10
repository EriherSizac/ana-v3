// File: main
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { WaClient } from './whatsapp/client';
import { interpolate } from './whatsapp/template';
import { Backend } from './backend';
import { JobPoller, type SendJob } from './jobs/poller';
import { setupUpdater } from './updater';

// El proceso main no lee .env (eso es del renderer vía Vite). Default = backend
// prod desplegado; override con ANA_API_BASE en el entorno si hace falta.
const API_BASE =
  process.env.ANA_API_BASE ?? 'https://njpfef2qna.execute-api.us-east-2.amazonaws.com';

let mainWindow: BrowserWindow | null = null;
let authToken: string | null = null; // lo setea el renderer tras login
let agentCampaign: string | null = null; // campaña del agente (heartbeat)
const HEARTBEAT_MS = 5 * 60 * 1000;

const wa = new WaClient();
const backend = new Backend(API_BASE, () => authToken);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  // Empaquetado → carga el build; dev → servidor de Vite.
  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173');
  }
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));
}

// ---- WhatsApp events → renderer + backend ----
wa.on('qr', (dataUrl) => send('wa:event', { type: 'qr', qr: dataUrl }));
wa.on('status', (status) => {
  send('wa:event', { type: 'status', status });
  // Al conectar, el agente se anuncia activo en su campaña.
  if (status === 'connected' && agentCampaign) void backend.heartbeat(agentCampaign);
});
wa.on('error', (error) => send('wa:event', { type: 'error', error }));
wa.on('message', async (msg) => {
  // Media entrante → backup a S3, guarda solo el puntero (no los bytes).
  if (msg._media) {
    const ext = (msg._media.mimetype.split('/')[1] || 'bin').split(';')[0];
    const filename = msg._media.filename || `${msg.id}.${ext}`;
    const up = await backend.uploadMedia(
      filename,
      msg._media.mimetype,
      Buffer.from(msg._media.dataBase64, 'base64'),
    );
    if (up) {
      msg.mediaKey = up.key;
      msg.filename = filename;
    }
    delete msg._media; // nunca persistir los bytes en Dynamo
  }
  send('wa:message', msg);
  await backend.putMessage(msg);
});

// ---- Ejecuta UN job (el poller controla orden, rate limit y progreso) ----
async function runJob(job: SendJob): Promise<{ success: boolean; error?: string }> {
  // El resultado se registra en el CRM vía backend (interacción outbound +
  // marcado de teléfonos sin WhatsApp), sin bloquear el ritmo de envío.
  const report = (status: 'sent' | 'no_whatsapp' | 'error') =>
    void backend.reportInteraction({
      jobId: job.jobId,
      campaign: job.campaign,
      phone: job.phone,
      status,
      row: job.row,
    });
  try {
    const jid = await wa.resolveJid(job.phone, job.countryCode);
    if (!jid) {
      send('wa:sent', { success: false, phone: job.phone, error: 'No tiene WhatsApp' });
      report('no_whatsapp');
      return { success: false, error: 'No tiene WhatsApp' };
    }
    const body = interpolate(job.template, job.row);
    const msg = await wa.sendText(jid, body); // simula escritura antes de enviar
    await backend.putMessage(msg);
    // Guarda los datos del contacto en la conversación (CRM al abrir chat).
    await backend.putConversationMeta(jid, job.campaign, job.row);
    send('wa:sent', { success: true, phone: jid, campaignId: job.campaignId });
    report('sent');
    return { success: true };
  } catch (e: any) {
    const error = e?.message ?? String(e);
    send('wa:sent', { success: false, phone: job.phone, error });
    report('error');
    return { success: false, error };
  }
}

const poller = new JobPoller({
  apiBase: API_BASE,
  getToken: () => authToken,
  runJob,
  onProgress: (p) => send('wa:progress', p),
  // Asignación pendiente del agente → vista "Mi asignación" en el renderer.
  onAssignment: (jobs) => send('jobs:assignment', jobs),
});

// ---- IPC desde el renderer ----
// El agente aprueba qué enviar (y con qué plantilla) desde "Mi asignación".
ipcMain.handle('jobs:approve', (_e, jobIds: string[], template?: string) =>
  poller.approve(jobIds, template),
);
// Hidrata la vista al montarse (sin esperar al próximo poll).
ipcMain.handle('jobs:get-assignment', () => poller.getAssignment());
ipcMain.handle('auth:set-token', (_e, token: string | null) => {
  authToken = token;
  if (token) poller.start();
  return { ok: true };
});
// El renderer dispara el check cuando ya tiene el listener montado (UpdateGate)
// → evita la carrera de perder el evento 'none'/'available'.
ipcMain.handle('update:check', () => {
  if (mainWindow) setupUpdater(mainWindow);
  return { ok: true };
});
ipcMain.handle('agent:register', (_e, campaign: string | null) => {
  agentCampaign = campaign;
  if (campaign && wa.isReady()) void backend.heartbeat(campaign);
  return { ok: true };
});

// Heartbeat periódico mientras haya campaña + sesión WA viva.
setInterval(() => {
  if (agentCampaign && wa.isReady()) void backend.heartbeat(agentCampaign);
}, HEARTBEAT_MS);
ipcMain.handle('wa:start', async () => {
  await wa.start();
  return { ok: true };
});
// Estado actual (para que el renderer lo recupere tras refresh).
ipcMain.handle('wa:get-state', () => wa.getState());
ipcMain.handle('wa:stop', async () => {
  await wa.stop();
  return { ok: true };
});
ipcMain.handle('wa:reset', async () => {
  await wa.clearSession(); // borra sesión muerta
  await wa.start(); // arranca limpio → debe salir QR
  return { ok: true };
});
ipcMain.handle('wa:send-reply', async (_e, jid: string, body: string) => {
  try {
    // Manual: el typing ya se mostró en vivo mientras escribías → sin delay extra.
    const msg = await wa.sendText(jid, body, false);
    await backend.putMessage(msg);
    return { ok: true, message: msg };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
});
ipcMain.handle('wa:typing', async (_e, jid: string, on: boolean) => {
  await wa.setTyping(jid, on);
  return { ok: true };
});
ipcMain.handle(
  'wa:send-media',
  async (
    _e,
    jid: string,
    m: { dataBase64: string; mimetype: string; filename: string; caption?: string },
  ) => {
    try {
      const msg = await wa.sendMediaData(jid, m);
      // Respaldo a S3 + puntero, igual que la media entrante.
      const up = await backend.uploadMedia(m.filename, m.mimetype, Buffer.from(m.dataBase64, 'base64'));
      if (up) msg.mediaKey = up.key;
      await backend.putMessage(msg);
      return { ok: true, message: msg };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  },
);

app.whenReady().then(() => {
  createWindow();
  // Si hay sesión WhatsApp guardada, reconecta solo (sin pedir QR de nuevo).
  if (wa.hasSavedSession()) {
    console.log('[wa] sesión guardada → auto-reconectando');
    void wa.start();
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', async () => {
  poller.stop();
  await wa.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
process.on('unhandledRejection', (r) => console.error('UnhandledRejection:', r));
