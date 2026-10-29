// IMPORTANTE: setup-env.js debe importarse PRIMERO para configurar variables de entorno
import "./setup-env.js";
import fs from "fs";
import path from "path";
import readline from "readline";
const resolveAppDataDir = () => {
  if (process.env.ANA_DATA_DIR) return process.env.ANA_DATA_DIR;
  const appData = process.env.APPDATA;
  if (appData) return path.join(appData, "ANA");
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return path.join(localAppData, "ANA");
  return process.cwd();
};
const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // ignore
  }
};
const safeResetDir = (dir, label) => {
  try {
    if (!dir) return;
    if (!fs.existsSync(dir)) return;
    const parent = path.dirname(dir);
    const base = path.basename(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(parent, `${base}.bak-${stamp}`);
    fs.renameSync(dir, backup);
    console.log(`🧹 Reset ${label}: renombrado a ${backup}`);
  } catch (e) {
    console.error(`❌ No se pudo resetear ${label}:`, e?.message || e);
  }
};
const formatMsAsHms = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};
const ensureStatusWidget = async (page) => {
  if (!page) return;
  try {
    // Toda interacción de UI fuera del envío tiene límite (harden-client-resume).
    await withTimeout(page.evaluate(() => {
      const ID = "ana-status-widget";
      if (document.getElementById(ID)) return;
      const el = document.createElement("div");
      el.id = ID;
      el.style.cssText = [
        "position:fixed",
        "right:18px",
        "bottom:18px",
        "z-index:2147483647",
        "background:rgba(0,0,0,0.75)",
        "color:#fff",
        "padding:10px 12px",
        "border-radius:12px",
        "font-family:Arial, sans-serif",
        "font-size:13px",
        "line-height:1.25",
        "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
        "backdrop-filter:blur(2px)",
        "max-width:280px",
        "white-space:pre-line",
      ].join(";");
      el.textContent = "ANA";
      document.body.appendChild(el);
    }), UI_TIMEOUT_MS, "widget");
  } catch (_) {
    // ignore
  }
};
const setStatusWidgetText = async (page, text) => {
  if (!page) return;
  try {
    await ensureStatusWidget(page);
    await withTimeout(page.evaluate(
      (payload) => {
        const el = document.getElementById("ana-status-widget");
        if (!el) return;
        el.textContent = String(payload?.text || "");
      },
      { text: String(text || "") },
    ), UI_TIMEOUT_MS, "widget");
  } catch (_) {
    // ignore
  }
};
const setPauseBlocker = async (page, enabled) => {
  if (!page) return;
  try {
    await withTimeout(page.evaluate(
      (payload) => {
        const ID = "ana-pause-blocker";
        const existing = document.getElementById(ID);
        if (!payload?.enabled) {
          if (existing) existing.remove();
          return;
        }
        if (existing) return;
        const el = document.createElement("div");
        el.id = ID;
        el.style.cssText = [
          "position:fixed",
          "inset:0",
          "background:rgba(0,0,0,0.25)",
          "z-index:2147483646",
          "pointer-events:auto",
        ].join(";");
        document.body.appendChild(el);
      },
      { enabled: enabled === true },
    ), UI_TIMEOUT_MS, "pause-blocker");
  } catch (_) {
    // ignore
  }
};
const sleepWithCountdown = async (totalMs, label, pages = [], shouldStop = () => false) => {
  const endAt = Date.now() + totalMs;
  let stopped = false;
  // En ambientes no-interactivos, evitar spam: log cada minuto
  const isInteractive = Boolean(process.stdout && process.stdout.isTTY);
  let lastLoggedMinute = null;
  while (true) {
    const remaining = endAt - Date.now();
    if (remaining <= 0) break;
    // Pausa por actualización (add-in-session-updates): la espera se corta.
    if (shouldStop()) {
      stopped = true;
      break;
    }
    const uiText = `${label}: ${formatMsAsHms(remaining)}`;
    const pagesToUpdate = Array.isArray(pages) ? pages.filter(Boolean) : [];
    if (pagesToUpdate.length) {
      await Promise.all(
        pagesToUpdate.map((p) => setStatusWidgetText(p, uiText)),
      );
    }
    if (isInteractive) {
      process.stdout.write(`\r⏳ ${label}: ${formatMsAsHms(remaining)}   `);
    } else {
      const m = Math.floor(remaining / 60000);
      if (m !== lastLoggedMinute) {
        lastLoggedMinute = m;
        console.log(`⏳ ${label}: ${formatMsAsHms(remaining)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (isInteractive) process.stdout.write("\n");
  const pagesToClear = Array.isArray(pages) ? pages.filter(Boolean) : [];
  if (pagesToClear.length) {
    await Promise.all(pagesToClear.map((p) => setStatusWidgetText(p, "")));
  }
  return stopped ? "stopped" : "done";
};
const writeCrashLog = (title, err) => {
  try {
    const dir = resolveAppDataDir();
    ensureDir(dir);
    const logFile = path.join(dir, "ana-crash.log");
    const msg = String(err?.stack || err?.message || err);
    const line = `\n[${new Date().toISOString()}] ${title}\n${msg}\n`;
    fs.appendFileSync(logFile, line, "utf-8");
  } catch (e) {
    // ignore
  }
};
const isPkg = typeof process.pkg !== "undefined";
process.on("uncaughtException", async (err) => {
  writeCrashLog("uncaughtException", err);
  console.error("❌ Error fatal (uncaughtException):", err?.message || err);
  if (isPkg) {
    try {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question("Presiona ENTER para salir...", () => {
        rl.close();
        process.exit(1);
      });
      return;
    } catch (e) {
      // ignore
    }
  }
  process.exit(1);
});
process.on("unhandledRejection", async (reason) => {
  writeCrashLog("unhandledRejection", reason);
  console.error(
    "❌ Error fatal (unhandledRejection):",
    reason?.message || reason,
  );
  if (isPkg) {
    try {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question("Presiona ENTER para salir...", () => {
        rl.close();
        process.exit(1);
      });
      return;
    } catch (e) {
      // ignore
    }
  }
  process.exit(1);
});
if (isPkg) {
  const exeDir = path.dirname(process.execPath);
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(exeDir, "browsers");
  const appData = process.env.APPDATA;
  if (appData) {
    const dataDir = path.join(appData, "ANA");
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
      // ignore
    }
    process.env.ANA_DATA_DIR = dataDir;
  }
}
function waitForEnterIfPkg(message) {
  if (!isPkg) return Promise.resolve();
  return new Promise((resolve) => {
    if (message) console.log(message);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Presiona ENTER para salir...", () => {
      rl.close();
      resolve();
    });
  });
}
import { CONFIG, __dirname_export as DATA_DIR, realtimeConfig } from "./config.js";
import { CONSTANTS } from "./constants.js";
import { saveResults, saveResponses } from "./csv-utils.js";
import {
  initWhatsApp,
  sendMessage,
  closeBrowser,
  getPage,
} from "./whatsapp.js";
import {
  initManualWhatsApp,
  closeManualBrowser,
  getManualPage,
} from "./whatsapp-manual.js";
import {
  initMonitorWhatsApp,
  closeMonitorBrowser,
  getMonitorPage,
} from "./whatsapp-monitor.js";
import {
  fetchAssignedChats,
  updatePendingContacts,
  loadAgentConfig,
  insertInteractions,
} from "./agent-config.js";
import { checkForUpdatesAndApply } from "./self-update.js";
import { spawn as spawnProcess } from "child_process";
import os from "os";
import { cleanVersion, fetchManifest, DEFAULT_MANIFEST_URL } from "./update-manifest.js";
import { downloadVerified } from "./update-download.js";
import { createPauseGate } from "./update-pause.js";
import {
  appendUpdateLog,
  buildHelperScript,
  readPreviousResult,
  resolveInstallLayout,
  spawnHelper,
  writeHelperScript,
  UPDATE_LOG,
  UPDATE_RESULT,
} from "./update-helper.js";
import { bannerView, showUpdateBanner } from "./update-banner.js";
import { createInSessionUpdater } from "./in-session-update.js";
import { remoteSettings, startRemoteSettings, POLL_INTERVAL_MS as SETTINGS_INTERVAL_MS, BACKUP_INTERVAL_MS as SETTINGS_BACKUP_INTERVAL_MS } from "./remote-settings.js";
import { agentSession, backend, sessionStore, getIdToken, CLI_VERSION } from "./agent-runtime.js";
import { createRealtime, wsSocketFactory } from "./realtime.js";
import { createPollWaker, waitForNextPoll, waitLabel, POLL_INTERVAL_MS as POLL_FAST_MS } from "./poll-wait.js";
import { phone } from "./phone-utils.js";
import {
  withTimeout,
  UI_TIMEOUT_MS,
  createResumeDetector,
  createLoopHeartbeat,
  createLoopSupervisor,
  checkPageHealth,
} from "./liveness.js";
import { interactionDateTime } from "./interaction-time.js";
import {
  createJournal,
  loadJournal,
  markInFlight,
  markDone,
  markForReview,
  pendingRows,
  inFlightRows,
  reviewRows,
  removeJournal,
  listOtherJournals,
} from "./assignment-journal.js";

// Canal realtime activo (add-realtime-v3-cli); se cierra con Ctrl+C.
let activeRealtime = null;

const REVIEW_ERROR =
  "Envío interrumpido por cierre del CLI; revisar antes de reenviar";

// Función principal
async function main() {
  // --logout: revoca el refresh token (si hay red), borra .agent-session y termina
  if (process.argv.includes("--logout")) {
    await agentSession.logout();
    console.log("Sesión cerrada");
    return;
  }

  // Resultado de una actualización en sesión anterior (add-in-session-updates D6):
  // si falló, se avisa en consola y, cuando abra, en la ventana manual.
  const previousUpdate = readPreviousResult(DATA_DIR);
  if (previousUpdate && !previousUpdate.ok) {
    console.error(
      `⚠️  No se pudo instalar la versión ${previousUpdate.version} (código ${previousUpdate.exitCode ?? "?"}). Sigues en la versión ${CLI_VERSION}. Detalle en ${path.join(DATA_DIR, UPDATE_LOG)}`,
    );
  } else if (previousUpdate?.ok) {
    console.log(`✅ Actualización a ${previousUpdate.version} instalada (versión actual ${CLI_VERSION}).`);
  }

  // Auto-update (solo EXE/pkg). Se desactiva con --no-self-update
  if (!process.argv.includes("--no-self-update")) {
    try {
      const updated = await checkForUpdatesAndApply();
      if (updated) {
        console.log("⬇️  Actualización aplicada. Reiniciando...");
        return;
      }
    } catch (e) {
      console.error("⚠️  Auto-update falló:", e?.message || e);
    }
  }

  // Flags de utilería para recuperar perfiles corruptos (pantalla de carga infinita)
  if (process.argv.includes("--reset-monitor-session")) {
    safeResetDir(CONFIG.monitorSessionPath, "Monitor Session");
  }
  if (process.argv.includes("--reset-monitor-alt-session")) {
    safeResetDir(`${CONFIG.monitorSessionPath}-alt`, "Monitor Alt Session");
  }
  if (process.argv.includes("--reset-manual-session")) {
    safeResetDir(CONFIG.manualSessionPath, "Manual Session");
  }
  if (process.argv.includes("--reset-auto-session")) {
    safeResetDir(CONFIG.sessionPath, "Auto Session");
  }

  // Cierre ordenado (Ctrl+C)
  let shuttingDown = false;
  process.once("SIGINT", async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n🛑 Cerrando por Ctrl+C...");
    try {
      activeRealtime?.stop();
    } catch (e) {
      // Ignorar
    }
    try {
      await closeBrowser();
    } catch (e) {
      // Ignorar
    }
    try {
      await closeManualBrowser();
    } catch (e) {
      // Ignorar
    }
    try {
      await closeMonitorBrowser();
    } catch (e) {
      // Ignorar
    }
    process.exit(0);
  });

  console.log("╔════════════════════════════════════════╗");
  console.log("║   WhatsApp CLI Mass Sender v2.0       ║");
  console.log("║      Sistema de Dos Ventanas          ║");
  console.log("╚════════════════════════════════════════╝\n");

  try {
    // Sin sesión de Cognito reutilizable, la ventana de automatización (abajo)
    // muestra primero el overlay de login (una sola inicialización del perfil).
    const credentialsExist = fs.existsSync(sessionStore.filePath);
    if (!credentialsExist) {
      console.log("⚠️  No hay credenciales configuradas.");
      console.log(
        "   Se abrirá la ventana para iniciar sesión.\n",
      );
    }

    // Decidir qué ventanas abrir
    const shouldOpenManual = CONFIG.enableManualWindow;
    const shouldOpenMonitor = CONFIG.enableMonitorWindow;

    // Campaña para el CRM: se calcula después del login (la elige el agente)
    let campaignName = "";
    const INTERACTIONS_USER_ID = "6898b89b-ab72-4196-92b1-70d51781f68f";

    console.log(
      `🔓 Ventana manual: ${shouldOpenManual ? "ACTIVADA" : "DESACTIVADA"}`,
    );
    console.log(
      `👀 Ventana monitor: ${shouldOpenMonitor ? "ACTIVADA" : "DESACTIVADA"}`,
    );
    console.log(
      `🔐 Sesión guardada: ${credentialsExist ? "SÍ" : "NO"}\n`,
    );

    // La ventana manual solo se abre si ya hay credenciales configuradas
    // Si no hay credenciales, primero se debe abrir la ventana de automatización para configurarlas
    let manualWindowPromise = null;
    let manualWindowStarted = false;

    let monitorWindowPromise = null;
    let monitorWindowStarted = false;

    // Iniciar WhatsApp para automatización (necesario para polling y envíos)
    {
      // Activar modo media por portapapeles si se pasa el flag en la línea de comandos
      if (process.argv.includes("--clipboard-media")) {
        CONFIG.useClipboardMedia = true;
        console.log("📎 Modo media por portapapeles ACTIVADO");
        console.log(
          "   Asegúrate de tener una imagen/video copiado antes de cada envío.",
        );
        console.log("─────────────────────────────────────\n");
      }

      await initWhatsApp();
      const identity = agentSession.identity();
      if (!identity) {
        console.log("⚠️  No se detectó una sesión de agente.");
        await waitForEnterIfPkg(
          "\nConfigura credenciales y vuelve a ejecutar.",
        );
        return;
      }
      {
        const rawCampaign = identity.campaign || "";
        campaignName = rawCampaign.includes("-")
          ? rawCampaign.split("-").slice(1).join("-")
          : rawCampaign;
      }
      // Configuración remota (add-cli-remote-settings): poller tras el login,
      // autenticado con el ID token de la sesión (nunca se persiste).
      remoteSettings.setTokenProvider(getIdToken);
      startRemoteSettings();

      // Canal realtime (add-realtime-v3-cli): avisa asignaciones publicadas y
      // cambios de configuración; con el canal activo los polls son de respaldo
      // (2 min) y la configuración se lee cada 15 min. Sin URL, con
      // ANA_REALTIME=off o si `ws` falla, todo sigue como antes (30 s / 5 min).
      const waker = createPollWaker();
      const rtCfg = realtimeConfig();
      let realtime = null;
      if (rtCfg.enabled) {
        try {
          const { default: WebSocketImpl } = await import("ws");
          realtime = createRealtime({
            url: rtCfg.url,
            version: CLI_VERSION,
            getToken: () => getIdToken(),
            createSocket: wsSocketFactory(WebSocketImpl),
          });
          realtime.setCampaign(identity.campaign);
          remoteSettings.setIntervalProvider(() =>
            realtime?.isActive() ? SETTINGS_BACKUP_INTERVAL_MS : SETTINGS_INTERVAL_MS,
          );
          realtime.on("assignment", () => waker.wake());
          realtime.on("settings", () => remoteSettings.refreshNow());
          // Conexión confirmada: lectura de configuración y, si está esperando, poll.
          realtime.on("active", () => {
            remoteSettings.intervalChanged();
            remoteSettings.refreshNow();
            waker.wake({ pendingIfIdle: false });
          });
          realtime.on("inactive", () => remoteSettings.intervalChanged());
          // Actualización forzada: revalida la campaña, relee configuración y
          // consulta (al terminar el ciclo si hay uno en curso).
          realtime.on("refresh", () => {
            remoteSettings.refreshNow();
            void backend
              .refreshAccess()
              .then((msg) => {
                if (msg) console.warn(`⚠️  ${msg}`);
              })
              .finally(() => waker.wake());
          });
          realtime.start();
          activeRealtime = realtime;
        } catch (e) {
          console.error("⚠️  Canal realtime no disponible; se sigue con polling:", e?.message || e);
          realtime = null;
        }
      } else {
        console.log(`ℹ️  Canal realtime deshabilitado (${rtCfg.reason})`);
      }

      // Espera entre polls: 30 s (o 2 min con el canal activo), interrumpible por
      // un aviso. `label` fija un texto propio y siempre 30 s (avisos de sesión).
      const sleepUntilNextPoll = async (pages = [], label = null) => {
        const isInteractive = Boolean(process.stdout && process.stdout.isTTY);
        const targets = pages.filter(Boolean);
        let lastLoggedMinute = null;
        const why = await waitForNextPoll({
          isActive: () => (label ? false : Boolean(realtime?.isActive())),
          waker,
          onBeat: () => heartbeat.beat(),
          onTick: async (remaining, active) => {
            const uiText = label ? `${label}: ${formatMsAsHms(remaining)}` : waitLabel(active, remaining);
            if (targets.length) await Promise.all(targets.map((p) => setStatusWidgetText(p, uiText)));
            if (isInteractive) {
              process.stdout.write(`\r⏳ ${uiText}   `);
            } else {
              const m = Math.floor(remaining / 60000);
              if (m !== lastLoggedMinute) {
                lastLoggedMinute = m;
                console.log(`⏳ ${uiText}`);
              }
            }
          },
        });
        if (isInteractive) process.stdout.write("\n");
        if (targets.length) await Promise.all(targets.map((p) => setStatusWidgetText(p, "")));
        if (why === "woken") console.log("🔔 Aviso en vivo: consultando asignaciones...");
      };

      // Después de initWhatsApp, las credenciales ya están configuradas
      // Ahora podemos abrir la ventana manual si está habilitada
      if (shouldOpenManual && !manualWindowStarted) {
        console.log("\n═══════════════════════════════════════");
        console.log("🔓 Iniciando ventana manual...");
        console.log("═══════════════════════════════════════\n");

        manualWindowStarted = true;
        manualWindowPromise = initManualWhatsApp([])
          .then(() => {
            if (previousUpdate && !previousUpdate.ok) {
              void showUpdateBanner(
                getManualPage(),
                bannerView({ phase: "previous-failed", version: previousUpdate.version, exitCode: previousUpdate.exitCode, current: CLI_VERSION }),
              );
              const t = setTimeout(() => void showUpdateBanner(getManualPage(), null), 2 * 60 * 1000);
              t.unref?.();
            }

            console.log("\n💬 Ventana manual lista para responder");
            console.log("⚠️  Esta ventana permanecerá abierta\n");
          })
          .catch((error) => {
            console.error("❌ Error al iniciar ventana manual:", error.message);
            console.error("Stack:", error.stack);
          });
      }

      // Abrir ventana monitor (no leídos) si está habilitada
      if (shouldOpenMonitor && !monitorWindowStarted) {
        console.log("\n═══════════════════════════════════════");
        console.log("👀 Iniciando ventana monitor (No leídos)...");
        console.log("═══════════════════════════════════════\n");

        monitorWindowStarted = true;
        monitorWindowPromise = initMonitorWhatsApp()
          .then(() => {
            console.log("\n👀 Ventana monitor lista (No leídos)");
            console.log("⚠️  Esta ventana permanecerá abierta\n");
          })
          .catch((error) => {
            console.error(
              "❌ Error al iniciar ventana monitor:",
              error.message,
            );
            console.error("Stack:", error.stack);
          });
      }

      const POLL_INTERVAL_MS = POLL_FAST_MS;

      // Vida del ciclo (harden-client-resume). Latido: si el ciclo no avanza
      // (poll o tick de espera) en > 3× 30 s y no está enviando, se abandona la
      // iteración colgada y empieza otra; lo pendiente se reanuda del registro local.
      const supervisor = createLoopSupervisor();
      const heartbeat = createLoopHeartbeat({
        expectedMs: POLL_INTERVAL_MS,
        onStall: ({ elapsedMs }) => {
          const msg = `El ciclo principal no avanzó en ${Math.round(elapsedMs / 1000)} s; se reinicia el ciclo`;
          console.warn(`\n⚠️  ${msg} (lo pendiente se reanuda del registro local).`);
          writeCrashLog("loop stall", msg);
          supervisor.stall();
          waker.wake({ pendingIfIdle: false });
        },
      });

      // Ventanas de WhatsApp tras reanudar: sondeo acotado; si no responde se
      // recarga (la de automatización no se recarga a media asignación).
      const checkWindows = async () => {
        const windows = [
          ["automatización", getPage()],
          ["manual", getManualPage()],
          ["monitor", getMonitorPage()],
        ];
        for (const [name, p] of windows) {
          if (!p) continue;
          const st = await checkPageHealth(p, {
            reload: !(name === "automatización" && heartbeat.busy),
          });
          if (st === "ok") continue;
          if (st === "reloaded") {
            console.log(`🔄 Ventana ${name} de WhatsApp recargada tras la reanudación.`);
          } else {
            console.warn(
              `⚠️  La ventana ${name} de WhatsApp ${st === "closed" ? "está cerrada" : "no responde"}. ANA sigue consultando asignaciones; si no se recupera, cierra ANA y vuelve a abrirlo.`,
            );
          }
        }
      };

      // Suspensión/reanudación del equipo: salto de reloj > 30 s.
      let resumeBusy = false;
      const resumeDetector = createResumeDetector({
        onResume: ({ gapMs }) => {
          console.log(
            `\n💤 Reanudación detectada (${Math.round(gapMs / 1000)} s sin actividad): reconectando y revisando sesión y ventanas...`,
          );
          heartbeat.beat();
          realtime?.reconnectNow("resume");
          remoteSettings.refreshNow();
          waker.wake();
          // Al despertar también se revisa si hay versión nueva (add-in-session-updates).
          void inSessionUpdater?.checkNow("resume");
          if (resumeBusy) return;
          resumeBusy = true;
          void (async () => {
            try {
              // Renovación silenciosa si el ID token vence pronto o ya venció.
              const token = await getIdToken().catch(() => null);
              if (!token) {
                const authMsg = agentSession.authMessage();
                if (authMsg) console.warn(`⚠️  ${authMsg}`);
              }
              await checkWindows();
            } catch (e) {
              console.error("⚠️  Revisión tras reanudación falló:", e?.message || e);
            } finally {
              resumeBusy = false;
            }
          })();
        },
      });
      // Actualización obligatoria en sesión (add-in-session-updates): chequeo cada
      // 30 min, al reanudar y con release.available; pausa ordenada del ciclo
      // (compuerta), descarga verificada, 60 s y ayudante que instala y reabre.
      const updateGate = createPauseGate({ onRequest: () => waker.wake({ pendingIfIdle: false }) });
      let inSessionUpdater = null;
      {
        const layout = resolveInstallLayout({ execPath: process.execPath, isPkg });
        if (process.argv.includes("--no-self-update")) {
          console.log("ℹ️  Actualización en sesión deshabilitada (--no-self-update)");
        } else if (!layout) {
          console.log("ℹ️  Actualización en sesión no disponible (no es la instalación portable de ANA)");
        } else if (!cleanVersion(CLI_VERSION)) {
          console.log("ℹ️  Actualización en sesión no disponible (versión local desconocida)");
        } else {
          let lastView = null;
          const render = () => showUpdateBanner(getManualPage() || getMonitorPage(), lastView);
          // Si la ventana se recarga (F5), el aviso vuelve a dibujarse.
          const refresher = setInterval(() => {
            if (lastView) void render();
          }, 5000);
          refresher.unref?.();
          const manifestUrl = String(process.env.ANA_UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL).trim();
          inSessionUpdater = createInSessionUpdater({
            currentVersion: CLI_VERSION,
            fetchManifest: () => fetchManifest(manifestUrl),
            requestPause: () => updateGate.request(),
            resumeLoop: () => updateGate.resume(),
            download: async (m, onProgress) => {
              const dest = path.join(os.tmpdir(), `ANA-${m.version}.exe`);
              appendUpdateLog(DATA_DIR, `Descargando ${m.version} desde ${m.url}`);
              const r = await downloadVerified({
                url: m.url,
                dest,
                expectedSize: m.size,
                expectedSha256: m.sha256,
                onProgress: ({ pct }) => onProgress(pct),
              });
              appendUpdateLog(DATA_DIR, `Descarga verificada: ${r.size} bytes, sha256 ${r.sha256}`);
              return r.path;
            },
            install: async (file, m) => {
              const script = buildHelperScript({
                pid: process.pid,
                installer: file,
                launcher: layout.launcher,
                appDir: layout.appDir,
                args: process.argv.slice(2),
                logPath: path.join(DATA_DIR, UPDATE_LOG),
                resultPath: path.join(DATA_DIR, UPDATE_RESULT),
                installLogPath: path.join(os.tmpdir(), `ANA-${m.version}-install.log`),
                version: m.version,
                fromVersion: CLI_VERSION,
              });
              // Primero el ayudante: si no arranca, nada se cerró y el ciclo se reanuda.
              await spawnHelper(writeHelperScript(script), { spawn: spawnProcess });
              appendUpdateLog(DATA_DIR, `Ayudante lanzado; se cierra ANA ${CLI_VERSION} para instalar ${m.version}`);
              shuttingDown = true;
              inSessionUpdater?.stop();
              clearInterval(refresher);
              resumeDetector.stop();
              heartbeat.stop();
              activeRealtime?.stop();
              // Cierre ordenado de los perfiles persistentes (sesiones de WhatsApp intactas).
              const close = (fn) => withTimeout(Promise.resolve().then(fn), 20_000, "cerrar navegador").catch(() => {});
              await Promise.all([close(closeBrowser), close(closeManualBrowser), close(closeMonitorBrowser)]);
              process.exit(0);
            },
            onState: (st) => {
              lastView = bannerView(st);
              void render();
            },
          });
          inSessionUpdater.start();
          realtime?.on("release", () => inSessionUpdater?.onRelease());
          console.log("🔄 Actualización en sesión activa: chequeo cada 30 min, al reanudar y con aviso en vivo.");
        }
      }

      heartbeat.start();
      resumeDetector.start();
      const PAUSE_AFTER_MESSAGES = CONSTANTS.PAUSE_AFTER_MESSAGES;
      const PAUSE_DURATION_MS = 30 * 60 * 1000;

      const results = [];
      const page = getPage();
      let sentSinceLastPause = 0;
      let cycle = 0;

      // Escritura del registro local: un fallo de disco no detiene el envío
      const journalStep = (fn, journal, index) => {
        if (!journal) return;
        try {
          fn(journal, index);
        } catch (e) {
          console.error(
            "⚠️  No se pudo actualizar el registro local de la asignación:",
            e?.message || e,
          );
        }
      };

      // Reporte a /contacts/pending: filas originales de los pendientes (o [] al final)
      // y, si hay, los contactos por revisar en `review`
      const reportAssignmentProgress = async (
        journal,
        assignmentContacts,
        final = false,
      ) => {
        const rawOf = (row) => assignmentContacts[row.index]?.__raw || {};
        const pendingRaw = final ? [] : pendingRows(journal).map(rawOf);
        const toReview = reviewRows(journal);
        const review =
          toReview.length > 0
            ? {
                assignment_id: journal.assignment_id,
                contacts: toReview.map(rawOf),
              }
            : undefined;
        const ok = await updatePendingContacts(pendingRaw, review);
        if (!ok) console.error("❌ Error al actualizar contactos pendientes");
        return ok;
      };

      // Registros locales de otro agente/campaña: se conservan sin procesarse
      {
        const cfg = agentSession.identity() || loadAgentConfig() || {};
        const others = listOtherJournals(DATA_DIR, cfg.agent_id, cfg.campaign);
        if (others.length > 0) {
          console.warn(
            `⚠️  Registros de asignación de otros agentes/campañas (no se procesan): ${others.join(", ")}`,
          );
        }
      }

      // Pausa por lote. Se corta si se pide una actualización; en ese caso el
      // contador no se reinicia y la pausa se repite al reanudar.
      const runBatchPause = async (pages) => {
        const [p, m, mon] = pages;
        await Promise.all([setPauseBlocker(p, true), setPauseBlocker(mon, true)]);
        const r = await sleepWithCountdown(PAUSE_DURATION_MS, "Fin de pausa", [p, m, mon], () => updateGate.requested);
        await Promise.all([setPauseBlocker(p, false), setPauseBlocker(mon, false)]);
        if (r === "done") sentSinceLastPause = 0;
        else console.log("⏸️  Pausa por lote interrumpida por la actualización.");
      };

      while (true) {
        const outcome = await supervisor.run(async (gen) => {
        heartbeat.beat();
        // Actualización en curso (add-in-session-updates D3): el ciclo se
        // estaciona aquí (sin consultar ni enviar) hasta que ANA se reinicia o
        // la actualización falla y se reanuda.
        if (updateGate.requested) {
          console.log("⏸️  Envíos automáticos en pausa: actualización de ANA en curso.");
          const pauseText = "Actualización en curso: envíos en pausa";
          await Promise.all([setStatusWidgetText(page, pauseText), setStatusWidgetText(getMonitorPage(), pauseText)]);
          await updateGate.park({ onBeat: () => heartbeat.beat() });
          console.log("▶️  Se reanudan los envíos automáticos.");
          return;
        }
        cycle++;
        const manualPage = getManualPage();
        const monitorPage = getMonitorPage();
        await Promise.all([
          setStatusWidgetText(page, "Poll: consultando servidor..."),
          setStatusWidgetText(manualPage, "Poll: consultando servidor..."),
          setStatusWidgetText(monitorPage, "Poll: consultando servidor..."),
        ]);

        // Sesión rechazada por el backend (401 persistente o 403, design D9): no se
        // consumen ni procesan contactos; se sigue consultando con el intervalo normal.
        const authBlock = await backend.recheckAuthorization();
        if (!supervisor.isCurrent(gen)) return;
        heartbeat.beat();
        if (authBlock) {
          console.warn(`⚠️  ${authBlock}`);
          await sleepUntilNextPoll([page, manualPage, monitorPage], `${authBlock} · reintento`);
          return;
        }

        // Asignación en curso: reanudar el registro local si existe; si no, poll
        const journalCfg = agentSession.identity() || loadAgentConfig() || {};
        let journal = null;
        let assignmentContacts = [];
        let contacts = [];
        const resumed = loadJournal({
          dir: DATA_DIR,
          agentId: journalCfg.agent_id,
          campaign: journalCfg.campaign,
        });
        if (resumed.status === "invalid") {
          console.warn(
            `⚠️  Registro local de la asignación ilegible o inconsistente (${resumed.reason}); se renombró a ${resumed.invalidPath} y no se envía nada de él.`,
          );
        } else if (resumed.status === "ok") {
          journal = resumed.journal;
          assignmentContacts = resumed.contacts;
          // Contactos "en curso" al cerrar: no se reenvían, quedan por revisar
          for (const row of inFlightRows(journal)) {
            journalStep(markForReview, journal, row.index);
            const c = assignmentContacts[row.index] || {};
            console.warn(
              `⚠️  Contacto interrumpido durante el envío (${c.phone}); queda por revisar y no se reenvía.`,
            );
            results.push({
              ...c,
              status: "por_revisar",
              error: REVIEW_ERROR,
              sent_at: new Date().toISOString(),
              response: "",
            });
          }
          contacts = pendingRows(journal).map((r) => assignmentContacts[r.index]);
          console.log(
            `♻️  Reanudando asignación ${journal.assignment_id} con ${contacts.length} contactos pendientes`,
          );
        }

        if (!journal) {
          console.log("📡 Obteniendo contactos del servidor...");
          const fetched = await fetchAssignedChats();
          heartbeat.beat();
          assignmentContacts = fetched?.contacts || [];
          contacts = assignmentContacts;
          if (assignmentContacts.length > 0) {
            try {
              journal = createJournal({
                dir: DATA_DIR,
                agentId: journalCfg.agent_id,
                campaign: journalCfg.campaign,
                csvText: fetched.csvText,
                rows: assignmentContacts.map((c, index) => ({
                  index,
                  phone: c.phone,
                })),
              });
            } catch (e) {
              console.error(
                "⚠️  No se pudo crear el registro local de la asignación; se envía sin reanudación:",
                e?.message || e,
              );
            }
          }
        }
        // Iteración abandonada por el latido: lo recibido queda en el registro
        // local y la iteración vigente lo reanuda; esta no envía nada.
        if (!supervisor.isCurrent(gen)) return;
        console.log(`📊 Contactos para automatización: ${contacts.length}`);

        if (contacts.length === 0 && !journal) {
          const authMsg = agentSession.authMessage();
          if (authMsg) console.warn(`⚠️  ${authMsg}`);
          else console.log("ℹ️  No hay contactos asignados.");
          await sleepUntilNextPoll([page, manualPage, monitorPage], authMsg ? `${authMsg} · reintento` : null);
          return;
        }

        // Envío en curso: el latido no reinicia el ciclo hasta terminar la asignación.
        let pausedForUpdate = false;
        heartbeat.setBusy(true);
        try {

        console.log(`\n╔════════════════════════════════════════╗`);
        console.log(
          `║        CICLO ${cycle}: ${contacts.length} contactos        ║`,
        );
        console.log(`╚════════════════════════════════════════╝\n`);

        for (let i = 0; i < contacts.length; i++) {
          const contact = contacts[i];
          const idx = i + 1;
          // Pausa por lote pendiente (cortada antes por una actualización que falló).
          if (sentSinceLastPause >= PAUSE_AFTER_MESSAGES && !updateGate.requested) {
            console.log(`⏸️  Límite alcanzado (${PAUSE_AFTER_MESSAGES} mensajes). Pausando antes de continuar...`);
            await runBatchPause([page, manualPage, monitorPage]);
          }
          // Actualización pedida: el contacto anterior ya terminó y este no se inicia;
          // queda pendiente en el registro local y se reanuda tras reabrir ANA.
          if (updateGate.requested) {
            pausedForUpdate = true;
            console.log(`⏸️  Actualización pendiente: se detiene antes de ${contact.name}; queda pendiente en el registro local.`);
            break;
          }
          console.log(
            `\n[${idx}/${contacts.length}] Procesando: ${contact.name}`,
          );

          journalStep(markInFlight, journal, contact.__rowIndex);
          const result = await sendMessage(contact, contact.message);
          journalStep(markDone, journal, contact.__rowIndex);
          results.push(result);
          sentSinceLastPause += 1;
          const remainingToPause = Math.max(
            0,
            PAUSE_AFTER_MESSAGES - sentSinceLastPause,
          );
          const counterLine = `📨 Contador pausa: ${sentSinceLastPause}/${PAUSE_AFTER_MESSAGES} (faltan ${remainingToPause})`;
          console.log(counterLine);

          const statusText = `Ciclo ${cycle} | ${idx}/${contacts.length}\n${counterLine}`;
          await Promise.all([
            setStatusWidgetText(page, statusText),
            setStatusWidgetText(manualPage, statusText),
            setStatusWidgetText(monitorPage, statusText),
          ]);

          try {
            console.log("📋 [DEBUG] Objeto contact completo:");
            console.log(JSON.stringify(contact, null, 2));

            // Fecha/hora en America/Mexico_City (interaction-time.js)
            const { contact_date, contact_time, range_time } = interactionDateTime();
            const phone10 = phone.toLast10(contact.phone);
            const subdictamen =
              result?.status === "no_whatsapp"
                ? "No tiene Whatsapp"
                : "Se envía WhatsApp";

            let creditId = "";
            const csvCredit = String(contact.credit || "").trim();
            if (csvCredit) {
              creditId = csvCredit;
              console.log(`💳 Usando credit_id desde CSV: ${creditId}`);
            } else {
              console.log("🔍 Buscando credit_id por teléfono...");
              const { normalizePhoneForBackend, searchClientInfoByPhone } =
                await import("./agent-config.js");
              const phoneE164 = normalizePhoneForBackend(contact.phone);
              const clientInfo = await searchClientInfoByPhone(
                campaignName,
                phoneE164,
              );

              if (clientInfo && clientInfo.length > 0) {
                creditId = String(clientInfo[0]?.credit_info?.credit_id || "");
                console.log(`✅ credit_id encontrado: ${creditId}`);
              } else {
                console.log("⚠️  No se encontró credit_id para este teléfono");
              }
            }

            const interactionRes = await insertInteractions([
              {
                credit_id: creditId,
                campaign_name: String(campaignName || ""),
                user_id: INTERACTIONS_USER_ID,
                subdictamen,
                contact_date,
                contact_time,
                range_time,
                action_channel: "whatsapp",
                action: "whatsapp",
                contactable: result?.status === "sent",
                phone_number: phone10,
                email_address: null,
                template_used: null,
                comments: `product=${contact.product || ""}; discount=${contact.discount || ""}; total_balance=${contact.total_balance || ""}`,
                promise_date: null,
                promise_amount: null,
                promise_payment_plan: null,
                inoutbound: "outbound",
                payment_made_date: null,
              },
            ]);

            if (interactionRes?.ok) {
              console.log(
                `✅ Interacción enviada (${contact.phone}) subdictamen='${subdictamen}'`,
              );
            } else {
              console.error(
                `❌ Interacción NO enviada (${contact.phone}) subdictamen='${subdictamen}'`,
              );
              if (interactionRes?.status)
                console.error(`   Status: ${interactionRes.status}`);
              if (interactionRes?.body)
                console.error(
                  `   Body: ${JSON.stringify(interactionRes.body)}`,
                );
              if (interactionRes?.error)
                console.error(`   Error: ${interactionRes.error}`);
            }

            if (result?.status === "no_whatsapp" && creditId && phone10) {
              try {
                console.log(
                  `📵 Marcando teléfono sin WhatsApp en backend: ${phone10}`,
                );
                const patchRes = await fetch(
                  "https://7uj0qjoby9.execute-api.us-east-2.amazonaws.com/phone",
                  {
                    method: "PATCH",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Api-Key":
                        "6706bb8ef958b3f12759c471855f9aa50b357f78e2d1eee0c533b94daec11a38",
                    },
                    body: JSON.stringify({
                      credit_id: creditId,
                      campaign_name: String(campaignName || ""),
                      current_phone: phone10,
                      phone: {
                        has_whatsapp: false,
                        whatsapp_contactable: false,
                      },
                    }),
                  },
                );
                if (patchRes.ok) {
                  console.log(
                    `✅ Teléfono actualizado sin WhatsApp: ${phone10}`,
                  );
                } else {
                  const patchBody = await patchRes.text();
                  console.error(
                    `❌ Error al actualizar teléfono (${patchRes.status}): ${patchBody}`,
                  );
                }
              } catch (patchErr) {
                console.error(
                  "⚠️  No se pudo actualizar el teléfono en backend:",
                  patchErr.message,
                );
              }
            }
          } catch (e) {
            console.error(
              "⚠️  No se pudo registrar la interacción:",
              e.message,
            );
          }

          // Pendientes reales tras cada contacto (no bloquea el ciclo si falla)
          if (journal) {
            await reportAssignmentProgress(journal, assignmentContacts);
          }

          if (i < contacts.length - 1) {
            const delayMs = CONSTANTS.getRandomDelay();
            const delaySec = Math.round(delayMs / 1000);
            console.log(
              `⏳ Esperando ${delaySec}s antes del siguiente contacto (aleatorio entre 30-120s, pico en 60-80s)...`,
            );
            // Temporizador de Node (no depende de que la ventana responda).
            // Interrumpible por una actualización (add-in-session-updates).
            await updateGate.sleep(delayMs);
          }

          if (sentSinceLastPause >= PAUSE_AFTER_MESSAGES) {
            console.log(
              `\n⏸️  Límite alcanzado (${PAUSE_AFTER_MESSAGES} mensajes). Pausando 20 minutos...`,
            );
            await runBatchPause([page, manualPage, monitorPage]);
          }
        }

        // Pausa por actualización: la asignación NO terminó; el registro local
        // conserva los pendientes y el servidor ya tiene el progreso por contacto.
        if (!pausedForUpdate) {
        console.log(
          `\n☁️  Marcando contactos como procesados en el servidor...`,
        );
        const updated = journal
          ? await reportAssignmentProgress(journal, assignmentContacts, true)
          : await updatePendingContacts([]);
        if (!updated) {
          console.error(
            "❌ Error al actualizar contactos pendientes (limpiar lista).",
          );
        }
        // Asignación terminada: se elimina el registro local antes del siguiente poll
        if (journal) {
          try {
            removeJournal(journal);
          } catch (e) {
            console.error(
              "⚠️  No se pudo eliminar el registro local de la asignación:",
              e?.message || e,
            );
          }
        }
        }

        await saveResults(results);
        await saveResponses(results);
        } finally {
          heartbeat.setBusy(false);
        }
        // La siguiente iteración se estaciona en la compuerta de actualización.
        if (pausedForUpdate) return;

        const sent = results.filter((r) => r.status === "sent").length;
        const errors = results.filter((r) => r.status === "error").length;
        const withResponse = results.filter(
          (r) => r.response && r.response.trim() !== "",
        ).length;

        console.log("\nℹ️  Backup automático desactivado (solo manual).");

        console.log(
          `\n✅ Ciclo ${cycle} completado. Volviendo a hacer poll en ${realtime?.isActive() ? "2 min (en vivo)" : `${POLL_INTERVAL_MS / 1000}s`}...`,
        );
        await sleepUntilNextPoll([page, manualPage, monitorPage]);
        });
        if (outcome === "stalled") console.log("♻️  Ciclo reiniciado.");
      }
    }
  } catch (error) {
    console.error("❌ Error fatal:", error.message);
    console.error(error.stack);
    await waitForEnterIfPkg();
  } finally {
    // Si la ventana manual queda abierta, el cierre se hace via Ctrl+C (SIGINT)
    if (!shuttingDown) {
      await closeBrowser();
      await closeManualBrowser();
      await closeMonitorBrowser();
    }
  }
}

// Ejecutar
main().catch(console.error);
