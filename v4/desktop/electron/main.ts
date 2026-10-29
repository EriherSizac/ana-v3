// File: main
// Created: 2026-06-09
// Updated: 2026-10-29
// Author: Erick Hernández Silva

import { app, BrowserWindow, ipcMain, Menu, Notification, powerMonitor, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { WaClient } from './whatsapp/client';
import { interpolate } from './whatsapp/template';
import { Backend } from './backend';
import { JobPoller, type SendJob } from './jobs/poller';
import { outcomeForResolve } from './jobs/outcome';
import {
  setupUpdater,
  retryUpdate,
  markUpdateBypassed,
  lastUpdateStatus,
  checkUpdateNow,
  checkUpdateSoon,
} from './updater';
import { TokenBroker, createAuthFetch } from './auth/tokenBroker';
import { decideSetToken, shouldHeartbeat, type SetTokenReason } from './auth/session';
import { decideReply, type MainAccess } from './auth/replyGate';
import { RemoteSettings, paceOf } from './settings/remoteSettings';
import { BypassGuard, type AttemptState } from './update/bypass';
import { RealtimeClient, type WsLike } from './realtime/client';
import { createRealtimeWiring, realtimeConfig } from './realtime/wiring';
import {
  WA_PROBE_TIMEOUT_MS,
  createClockJumpDetector,
  createResumeCoordinator,
  decideWaAction,
} from './power/resume';
import {
  createGuard,
  isAppUrl,
  isJid,
  noArgs,
  shouldBlockKey,
  vBool,
  vCampaign,
  vIdList,
  vMedia,
  vTemplates,
  vText,
  vToken,
  type ArgsValidator,
  type IpcEventLike,
} from './ipc/guard';

// El proceso main no lee .env (eso es del renderer vía Vite). Default = backend
// prod desplegado; override con ANA_API_BASE en el entorno si hace falta.
const API_BASE =
  process.env.ANA_API_BASE ?? 'https://njpfef2qna.execute-api.us-east-2.amazonaws.com';

let mainWindow: BrowserWindow | null = null;
let agentCampaign: string | null = null; // campaña del agente (heartbeat)
// Operador con sesión activa en el main (null tras logout o expiración).
let activeOperator: string | null = null;
const HEARTBEAT_MS = 5 * 60 * 1000;

// ID token del operador: lo entrega el renderer (dueño de la renovación con
// Amplify). Si al token le quedan < 2 min o el backend responde 401, el broker
// pide uno nuevo al renderer (`auth:token-request`) y espera hasta 10 s.
const broker = new TokenBroker({ request: () => send('auth:token-request', {}) });
const authFetch = createAuthFetch(broker);
const hasSession = () => broker.getToken() !== null;

const wa = new WaClient();
const backend = new Backend(API_BASE, hasSession, authFetch);

// Acceso del operador (GET /me) para el permiso de respuesta manual
// (v4-enforce-permissions D5). Se lee al fijar o renovar el token.
let mainAccess: MainAccess | null = null;
async function refreshAccess(): Promise<void> {
  const a = await backend.getAccess();
  if (a) mainAccess = a;
}
/** Envío manual permitido? Si aún no se conoce el acceso, intenta leerlo una vez. */
async function replyGate() {
  if (!mainAccess) await refreshAccess();
  return decideReply(mainAccess);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload);
}

// Endurecimiento solo en producción: sin DevTools, sin menú, sin clic derecho.
// En dev se dejan para depurar.
const LOCKED = app.isPackaged;

// DevTools habilitadas para depurar (F12 / Ctrl+Shift+I) aun en el build
// instalado. Para re-bloquear, poner DEVTOOLS = false.
const DEVTOOLS = false;

// Origen de la app para validar navegación y emisores IPC.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const SENDER_CTX = { packaged: app.isPackaged, devOrigin: new URL(DEV_SERVER_URL).origin };

/** Solo el frame principal de la ventana de la app, con su URL esperada. */
function isTrustedSender(event: IpcEventLike): boolean {
  const frame = event.senderFrame;
  if (!frame || !mainWindow || mainWindow.isDestroyed()) return false;
  const main = mainWindow.webContents.mainFrame;
  const f = frame as unknown as { processId?: number; routingId?: number };
  if (f.processId !== main.processId || f.routingId !== main.routingId) return false;
  return isAppUrl(frame.url, SENDER_CTX);
}
const guard = createGuard(isTrustedSender);
/** `ipcMain.handle` con validación de emisor y argumentos (ipc/guard.ts). */
function handle<A extends unknown[], R>(
  channel: string,
  validate: ArgsValidator<A>,
  handler: (...args: A) => R,
) {
  ipcMain.handle(channel, guard(channel, validate, handler) as (e: unknown, ...a: unknown[]) => unknown);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !LOCKED || DEVTOOLS,
    },
  });

  // Sin barra de menú (File/Edit/View…).
  if (LOCKED) Menu.setApplicationMenu(null);

  const wc = mainWindow.webContents;
  // Navegación: solo dentro de la app. Ventanas nuevas: nunca; https → navegador del sistema.
  const blockForeign = (e: { preventDefault: () => void }, url: string) => {
    if (!isAppUrl(url, SENDER_CTX)) e.preventDefault();
  };
  wc.on('will-navigate', blockForeign);
  wc.on('will-redirect', blockForeign);
  wc.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === 'https:') void shell.openExternal(url);
    } catch {
      /* URL inválida: se ignora */
    }
    return { action: 'deny' };
  });

  if (LOCKED && !DEVTOOLS) {
    wc.on('context-menu', (e) => e.preventDefault());
    wc.on('devtools-opened', () => wc.closeDevTools());
    // F12 siempre; atajos de DevTools solo sin Alt (AltGr = Ctrl+Alt debe escribir).
    wc.on('before-input-event', (event, input) => {
      if (shouldBlockKey(input)) event.preventDefault();
    });
  } else if (DEVTOOLS) {
    // F12 abre/cierra DevTools (el menú está oculto).
    wc.on('before-input-event', (_event, input) => {
      const k = (input.key || '').toLowerCase();
      if (k === 'f12') {
        if (wc.isDevToolsOpened()) wc.closeDevTools();
        else wc.openDevTools({ mode: 'detach' });
      }
    });
  }

  // Empaquetado → carga el build; dev → servidor de Vite.
  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    void mainWindow.loadURL(DEV_SERVER_URL);
  }
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));
}

// ---- WhatsApp events → renderer + backend ----
wa.on('qr', (dataUrl) => send('wa:event', { type: 'qr', qr: dataUrl }));
wa.on('status', (status) => {
  send('wa:event', { type: 'status', status });
  // Al conectar, el agente se anuncia activo en su campaña.
  if (status === 'connected') heartbeatIfConnected();
});
wa.on('error', (error) => send('wa:event', { type: 'error', error }));
// Progreso del arranque (obteniendo/restaurando sesión, cargando chats).
wa.on('loading', (message) => send('wa:event', { type: 'loading', message }));
// Sesión desplazada por otro equipo → notificación del sistema + aviso a la UI.
wa.on('conflict', (message) => {
  send('wa:event', { type: 'conflict', error: message });
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'ana — WhatsApp', body: message });
      n.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      n.show();
    }
  } catch (e) {
    console.error('[wa] notificación de conflicto falló:', e);
  }
});
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
async function runJob(
  job: SendJob,
): Promise<{ success: boolean; error?: string; noWhatsapp?: boolean }> {
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
    const resolved = await wa.resolveJid(job.phone, job.countryCode);
    // Teléfono inválido → error (nunca "sin WhatsApp": no se marca en el CRM).
    const early = outcomeForResolve(resolved);
    if (early || resolved.kind !== 'ok') {
      const o = early!;
      send('wa:sent', { success: false, phone: job.phone, error: o.error });
      report(o.report);
      return { success: false, error: o.error, noWhatsapp: o.noWhatsapp };
    }
    const jid = resolved.jid;
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

// Canal realtime (add-realtime-v4-desktop): con el canal activo el poll de jobs
// es de respaldo (2 min) y la configuración cada 15 min; sin canal, 5 s y 5 min.
const realtimeWiring = createRealtimeWiring({
  pollNow: () => poller.pollNow(),
  pollIntervalChanged: () => poller.intervalChanged(),
  settingsRefreshNow: () => remoteSettings.refreshNow(),
  settingsIntervalChanged: () => remoteSettings.intervalChanged(),
  refreshAccess: () => refreshAccess(),
  notifyRenderer: (reason) => send('access:refresh', { reason }),
  // Versión del desktop publicada (add-in-session-updates): chequeo tras 0–30 s.
  releaseAvailable: () => checkUpdateSoon(),
  log: (m) => console.log(m),
});

// Configuración remota del desktop (v4-add-desktop-remote-settings): tras el
// login y cada 5 min (15 min con canal realtime); defaults mientras nunca se haya leído.
const remoteSettings = new RemoteSettings({
  apiBase: API_BASE,
  hasSession,
  authFetch,
  onChange: (s) => send('settings:changed', s),
  intervalMs: realtimeWiring.settingsIntervalMs,
});

const poller = new JobPoller({
  apiBase: API_BASE,
  hasSession,
  authFetch,
  runJob,
  // Ritmo vigente en cada cálculo de espera.
  pace: () => paceOf(remoteSettings.get()),
  // 5 s sin canal realtime, 2 min con el canal activo.
  intervalMs: realtimeWiring.pollIntervalMs,
  onProgress: (p) => send('wa:progress', p),
  // Asignación pendiente del agente → vista "Mi asignación" en el renderer.
  onAssignment: (jobs, info) => {
    send('jobs:assignment', jobs);
    // Totales del poll (aviso "Mostrando N de M pendientes").
    send('jobs:assignment-info', info);
  },
});

// URL: ANA_REALTIME_URL o la embebida al compilar (build-config.json); sin URL
// o con ANA_REALTIME=off no hay conexión y el polling queda como antes.
const realtimeCfg = realtimeConfig(process.env, readBuildConfig());
const realtime = realtimeCfg.enabled
  ? new RealtimeClient({
      url: realtimeCfg.url!,
      client: 'desktop',
      version: app.getVersion(),
      getToken: () => broker.getFreshToken(),
      // Node 22 de Electron: WebSocket global con subprotocolos.
      createSocket: (url, protocols) => new WebSocket(url, protocols) as unknown as WsLike,
      onState: (s) => realtimeWiring.onState(s),
      onConfirmed: () => realtimeWiring.onConfirmed(),
      onEvent: (e) => realtimeWiring.onEvent(e),
      onRefresh: (r) => realtimeWiring.onRefresh(r),
    })
  : null;
console.log(`[realtime] ${realtime ? 'habilitado' : `deshabilitado (${realtimeCfg.reason})`}`);

// ---- IPC desde el renderer ----
// El agente aprueba qué enviar (y con qué plantilla) desde "Mi asignación".
// templates: plantilla aprobada por archivo (clave srcKey o campaignId).
handle(
  'jobs:approve',
  ([ids, tpls]) => {
    const jobIds = vIdList(ids);
    const templates = vTemplates(tpls);
    return jobIds && templates ? ([jobIds, templates] as [string[], Record<string, string>]) : undefined;
  },
  (jobIds, templates) => poller.approve(jobIds, templates),
);
// Hidrata la vista al montarse (sin esperar al próximo poll).
handle('jobs:get-assignment', noArgs, () => poller.getAssignment());
handle('jobs:get-assignment-info', noArgs, () => poller.getAssignmentInfo());
// Configuración remota vigente (el renderer la usa para openChatInteraction).
handle('settings:get', noArgs, () => remoteSettings.get());
// Recuerda el último operador que usó WhatsApp en esta máquina (persiste entre
// reinicios) → al entrar OTRO usuario se bota el auth local del anterior.
const LAST_OP_FILE = path.join(app.getPath('userData'), '.ana-last-operator');
const readLastOperator = (): string | null => {
  try {
    return fs.readFileSync(LAST_OP_FILE, 'utf-8').trim() || null;
  } catch {
    return null;
  }
};
const writeLastOperator = (op: string) => {
  try {
    fs.writeFileSync(LAST_OP_FILE, op);
  } catch (e) {
    console.error('[wa] no se pudo guardar last-operator:', e);
  }
};

handle(
  'auth:set-token',
  ([t, o]) => {
    const token = vToken(t);
    if (token === undefined) return undefined;
    if (o === undefined || o === null) return [token, undefined] as [string | null, undefined];
    if (typeof o === 'object' && (o as { reason?: unknown }).reason === 'expired')
      return [token, { reason: 'expired' as const }] as [string | null, { reason?: SetTokenReason }];
    return undefined;
  },
  async (token: string | null, opts?: { reason?: SetTokenReason }) => {
    const action = decideSetToken({
      token,
      reason: opts?.reason,
      activeOperator,
      lastOperator: readLastOperator(),
    });
    switch (action.kind) {
      case 'refresh':
        // Mismo operador (renovación): solo reemplaza el token; no reinicia
        // poller ni WhatsApp.
        broker.setToken(token);
        void refreshAccess();
        // Token nuevo → reconexión planeada del canal (make-before-break).
        void realtime?.renew();
        break;
      case 'login':
        broker.setToken(token);
        // Usuario distinto al de la sesión guardada → bota el auth local previo.
        if (action.wipeLocal) {
          console.log('[wa] usuario distinto → borrando sesión local previa');
          await wa.logoutLocal();
        }
        writeLastOperator(action.operator);
        activeOperator = action.operator;
        mainAccess = null;
        void refreshAccess();
        // Configura el respaldo de sesión a S3 (RemoteAuth) con el operador del JWT.
        wa.configure(API_BASE, { hasSession, authFetch }, action.operator);
        poller.start();
        remoteSettings.start();
        realtime?.start();
        // Reconecta WhatsApp restaurando la sesión (sin pedir QR si existe).
        if (!wa.isReady()) void wa.start();
        break;
      case 'expired':
        // Sesión no renovable: detén poller y heartbeat pero CONSERVA la sesión
        // local de WhatsApp (el mismo operador vuelve a entrar sin QR).
        broker.setToken(null);
        activeOperator = null;
        mainAccess = null;
        poller.stop();
        realtime?.stop();
        agentCampaign = null;
        send('auth:expired', {});
        break;
      case 'logout':
        // Logout (cambio de usuario): detén el poller y BORRA la sesión local de
        // WhatsApp para que el siguiente usuario no entre al WhatsApp del anterior.
        broker.setToken(null);
        activeOperator = null;
        mainAccess = null;
        poller.stop();
        realtime?.stop();
        agentCampaign = null;
        await wa.logoutLocal();
        send('wa:event', { type: 'status', status: 'disconnected' });
        break;
    }
    return { ok: true };
  },
);
// Respuesta del renderer a `auth:token-request` (null = no pudo renovar ahora).
handle(
  'auth:provide-token',
  ([t]) => {
    const token = vToken(t);
    return token === undefined ? undefined : ([token] as [string | null]);
  },
  (token) => {
    broker.provide(token);
    return { ok: true };
  },
);

// El renderer dispara el check cuando ya tiene el listener montado (UpdateGate)
// → evita la carrera de perder el evento 'none'/'available'. Idempotente: una
// recarga solo recibe la última fase (sin listeners ni intervalos nuevos).
handle('update:check', noArgs, () => {
  if (mainWindow)
    setupUpdater(mainWindow, {
      // Al terminar la descarga: no iniciar jobs nuevos, esperar el job en curso
      // (máx 3 min) y cerrar WhatsApp/Chromium para que el instalador no se cuelgue.
      pauseNewJobs: () => poller.pauseNewJobs(),
      hasJobInFlight: () => poller.hasJobInFlight(),
      waitIdle: (ms) => poller.waitIdle(ms),
      beforeInstall: () => wa.stop(),
      // Actualización a media sesión fallida: se vuelve a tomar jobs.
      resumeJobs: () => poller.resumeNewJobs(),
    });
  return { ok: true };
});
handle('update:retry', noArgs, () => {
  retryUpdate();
  return { ok: true };
});

// ---- Acceso de emergencia de Sistemas (gate de actualización) ----
// El hash scrypt de la contraseña maestra se inyecta al compilar
// (ANA_UPDATE_BYPASS_HASH → dist-electron/build-config.json). Sin hash, no hay bypass.
function readBuildConfig(): { updateBypassHash?: string; realtimeUrl?: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-config.json'), 'utf-8'));
  } catch {
    return {};
  }
}
const BYPASS_STATE_FILE = path.join(app.getPath('userData'), '.ana-update-bypass.json');
const bypassGuard = new BypassGuard(readBuildConfig().updateBypassHash, {
  load: (): AttemptState | null => {
    try {
      return JSON.parse(fs.readFileSync(BYPASS_STATE_FILE, 'utf-8'));
    } catch {
      return null;
    }
  },
  save: (s) => {
    try {
      fs.writeFileSync(BYPASS_STATE_FILE, JSON.stringify(s));
    } catch (e) {
      console.error('[update] no se pudo guardar intentos de bypass:', e);
    }
  },
});
/** Solo aplica cuando el chequeo terminó en error (no 404) en el build instalado. */
const bypassApplies = () => app.isPackaged && lastUpdateStatus()?.phase === 'error';

handle('update:bypass-status', noArgs, () => {
  const st = bypassGuard.status();
  return { ...st, available: st.available && bypassApplies() };
});
handle(
  'update:bypass',
  ([p]) => {
    const password = vText(p, 256);
    return password === undefined ? undefined : ([password] as [string]);
  },
  (password) => {
  if (!bypassApplies()) return { ok: false, reason: 'unavailable', ...bypassGuard.status() };
  const r = bypassGuard.verify(password);
  if (r.ok) {
    // Registro del evento. No hay ruta de backend para auditoría y aún no hay
    // sesión (el gate va antes del login): consola + archivo local.
    const entry = {
      event: 'update-bypass',
      at: new Date().toISOString(),
      appVersion: app.getVersion(),
      operator: readLastOperator(),
      updateError: lastUpdateStatus()?.message ?? null,
    };
    console.warn('[update] acceso de emergencia usado', entry);
    try {
      fs.appendFileSync(path.join(app.getPath('userData'), 'update-bypass.log'), JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error('[update] no se pudo escribir update-bypass.log:', e);
    }
    markUpdateBypassed();
  }
  return r;
  },
);

/** Heartbeat solo con campaña registrada y WhatsApp `connected` (no en QR). */
function heartbeatIfConnected() {
  if (agentCampaign && shouldHeartbeat(wa.getState(), agentCampaign))
    void backend.heartbeat(agentCampaign);
}

handle(
  'agent:register',
  ([c]) => {
    const campaign = vCampaign(c);
    return campaign === undefined ? undefined : ([campaign] as [string | null]);
  },
  (campaign) => {
    agentCampaign = campaign;
    heartbeatIfConnected();
    return { ok: true };
  },
);

// Heartbeat periódico mientras haya campaña + WhatsApp conectado.
setInterval(heartbeatIfConnected, HEARTBEAT_MS);
handle('wa:start', noArgs, async () => {
  await wa.start();
  return { ok: true };
});
// Estado actual (para que el renderer lo recupere tras refresh).
handle('wa:get-state', noArgs, () => wa.getState());
handle('wa:stop', noArgs, async () => {
  await wa.stop();
  return { ok: true };
});
handle('wa:reset', noArgs, async () => {
  await wa.clearSession(); // borra sesión muerta
  await wa.start(); // arranca limpio → debe salir QR
  return { ok: true };
});
handle(
  'wa:send-reply',
  ([j, b]) => {
    const body = vText(b);
    return isJid(j) && body !== undefined ? ([j, body] as [string, string]) : undefined;
  },
  async (jid, body) => {
  const gate = await replyGate();
  if (!gate.ok) return gate;
  try {
    // Manual: el typing ya se mostró en vivo mientras escribías → sin delay extra.
    const msg = await wa.sendText(jid, body, false);
    await backend.putMessage(msg);
    return { ok: true, message: msg };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
  },
);
handle(
  'wa:typing',
  ([j, o]) => {
    const on = vBool(o);
    return isJid(j) && on !== undefined ? ([j, on] as [string, boolean]) : undefined;
  },
  async (jid, on) => {
    await wa.setTyping(jid, on);
    return { ok: true };
  },
);
handle(
  'wa:send-media',
  ([j, media]) => {
    const m = vMedia(media);
    return isJid(j) && m ? ([j, m] as [string, NonNullable<ReturnType<typeof vMedia>>]) : undefined;
  },
  async (jid, m) => {
    const gate = await replyGate();
    if (!gate.ok) return gate;
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

// ---- Suspensión / reanudación del equipo (harden-client-resume) ----
// Al despertar: token, canal realtime nuevo, poll y configuración inmediatos,
// WhatsApp revisado (reinicializa conservando la sesión si no está CONNECTED)
// y heartbeat. `resume`, `unlock-screen` y el salto de reloj se agrupan.
const resumeCoordinator = createResumeCoordinator({
  hasSession: () => activeOperator !== null && hasSession(),
  refreshToken: () => broker.getFreshToken(),
  reconnectRealtime: () => realtime?.reconnectNow(),
  pollNow: () => poller.pollNow(),
  settingsRefreshNow: () => remoteSettings.refreshNow(),
  checkWhatsapp: async () => {
    const probe = await wa.probe(WA_PROBE_TIMEOUT_MS);
    const action = decideWaAction({ hasSession: hasSession(), lastStatus: wa.getState().status, probe });
    console.log(`[resume] WhatsApp: estado ${probe} → ${action}`);
    if (action !== 'restart') return;
    // No cortar un envío en curso: espera a que termine (máx 60 s).
    await poller.waitIdle(60_000);
    await wa.restartKeepSession();
  },
  heartbeat: () => heartbeatIfConnected(),
  checkUpdates: () => void checkUpdateNow(),
  log: (m) => console.log(m),
});
// Respaldo de powerMonitor: un hueco > 30 s entre ticks de 5 s = reanudación.
const clockJump = createClockJumpDetector({
  onJump: (gap) => {
    console.log(`[resume] salto de reloj de ${Math.round(gap / 1000)} s`);
    void resumeCoordinator.signal('clock-jump');
  },
});

app.whenReady().then(() => {
  createWindow();
  powerMonitor.on('suspend', () => resumeCoordinator.onSuspend());
  powerMonitor.on('resume', () => void resumeCoordinator.signal('resume'));
  powerMonitor.on('unlock-screen', () => void resumeCoordinator.signal('unlock-screen'));
  clockJump.start();
  // La reconexión de WhatsApp ocurre tras el login (auth:set-token): la sesión
  // se restaura desde S3 con el token del operador, no antes.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', async () => {
  clockJump.stop();
  poller.stop();
  realtime?.stop();
  await wa.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
process.on('unhandledRejection', (r) => console.error('UnhandledRejection:', r));
