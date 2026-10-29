/**
 * Actualización obligatoria durante la sesión (add-in-session-updates D1/D2).
 *
 * Chequeo del manifiesto cada 30 min, al reanudar (`checkNow('resume')`) y con
 * el aviso realtime `release.available` (`onRelease`, espera aleatoria 0–30 s).
 * Con una versión estrictamente mayor:
 *   pausing     → pide la pausa del ciclo (termina el contacto en curso; tope 10 min)
 *   downloading → descarga verificada con porcentaje
 *   restarting  → cuenta regresiva de 60 s (sin cancelar)
 *   installing  → `install()` lanza el ayudante, cierra navegadores y sale
 * Un error en cualquier paso reanuda el ciclo, muestra el error y espera al
 * siguiente chequeo. Sin "Más tarde": no hay forma de posponer.
 * Todo (manifiesto, descarga, instalación, UI, reloj) es inyectable.
 */

import { isNewer } from './update-manifest.js';

export const CHECK_EVERY_MS = 30 * 60 * 1000;
export const RESTART_COUNTDOWN_MS = 60_000;
export const PAUSE_MAX_WAIT_MS = 10 * 60 * 1000;
export const REALTIME_JITTER_MS = 30_000;
export const ERROR_NOTICE_MS = 2 * 60 * 1000;

/**
 * @param {{ currentVersion: string,
 *   fetchManifest: () => Promise<{ version: string, url: string, sha256: string|null, size: number|null }>,
 *   requestPause: () => Promise<void>, resumeLoop: () => void,
 *   download: (manifest: object, onProgress: (pct: number) => void) => Promise<string>,
 *   install: (file: string, manifest: object) => Promise<void>,
 *   onState?: (st: object|null) => void, logger?: Console,
 *   setTimeoutImpl?: Function, clearTimeoutImpl?: Function, setIntervalImpl?: Function, clearIntervalImpl?: Function,
 *   random?: () => number, checkEveryMs?: number, countdownMs?: number, tickMs?: number,
 *   pauseMaxWaitMs?: number, jitterMs?: number, errorNoticeMs?: number }} o
 */
export function createInSessionUpdater({
  currentVersion,
  fetchManifest,
  requestPause,
  resumeLoop,
  download,
  install,
  onState = () => {},
  logger = console,
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutImpl = (h) => clearTimeout(h),
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (h) => clearInterval(h),
  random = Math.random,
  checkEveryMs = CHECK_EVERY_MS,
  countdownMs = RESTART_COUNTDOWN_MS,
  tickMs = 1000,
  pauseMaxWaitMs = PAUSE_MAX_WAIT_MS,
  jitterMs = REALTIME_JITTER_MS,
  errorNoticeMs = ERROR_NOTICE_MS,
}) {
  let phase = 'idle';
  let interval = null;
  let releaseTimer = null;
  let clearNoticeTimer = null;
  let running = false;

  const unref = (h) => {
    h?.unref?.();
    return h;
  };
  // Esperas del flujo (cuenta regresiva, tope de pausa): con referencia, cortas o canceladas.
  const wait = (ms) => new Promise((r) => setTimeoutImpl(r, ms));
  const show = (st) => {
    try {
      onState(st);
    } catch {
      /* la UI no debe romper la actualización */
    }
  };

  async function run(manifest) {
    const version = manifest.version;
    if (clearNoticeTimer) clearTimeoutImpl(clearNoticeTimer);
    clearNoticeTimer = null;
    try {
      phase = 'pausing';
      logger.log?.(`⬆️  Nueva versión ${version} (actual ${currentVersion}): se actualizará automáticamente. Terminando el envío en curso...`);
      show({ phase, version });
      let paused = false;
      let capTimer = null;
      await Promise.race([
        Promise.resolve()
          .then(requestPause)
          .then(() => {
            paused = true;
          }),
        new Promise((r) => (capTimer = setTimeoutImpl(r, pauseMaxWaitMs))),
      ]);
      clearTimeoutImpl(capTimer);
      if (!paused) logger.warn?.(`⚠️  El ciclo no se detuvo en ${Math.round(pauseMaxWaitMs / 60000)} min; se actualiza igual.`);
      else logger.log?.('⏸️  Envíos automáticos en pausa para actualizar.');

      phase = 'downloading';
      show({ phase, version, pct: 0 });
      let lastLogged = -10;
      const file = await download(manifest, (pct) => {
        show({ phase: 'downloading', version, pct });
        if (pct - lastLogged >= 10 || pct === 100) {
          lastLogged = pct;
          logger.log?.(`⬇️  Descargando actualización ${version}: ${pct}%`);
        }
      });
      logger.log?.(`✅ Instalador ${version} descargado y verificado.`);

      phase = 'restarting';
      for (let left = countdownMs; left > 0; left -= tickMs) {
        const secondsLeft = Math.ceil(left / 1000);
        show({ phase, version, secondsLeft });
        if (left === countdownMs || secondsLeft % 10 === 0) logger.log?.(`🔁 Reiniciando para actualizar en ${secondsLeft} s`);
        await wait(Math.min(tickMs, left));
      }

      phase = 'installing';
      show({ phase, version });
      logger.log?.(`🛠️  Instalando ${version}: ANA se cerrará y volverá a abrirse sola.`);
      await install(file, manifest);
    } catch (e) {
      const message = String(e?.message || e);
      logger.error?.(`⚠️  No se pudo actualizar a ${version}: ${message}. Los envíos continúan; se reintenta en el siguiente chequeo.`);
      show({ phase: 'error', version, message });
      clearNoticeTimer = unref(
        setTimeoutImpl(() => {
          clearNoticeTimer = null;
          if (phase === 'idle') show(null);
        }, errorNoticeMs),
      );
      phase = 'idle';
      try {
        resumeLoop();
      } catch {
        /* el ciclo sigue estacionado solo si resume falla */
      }
      return false;
    }
    phase = 'idle';
    return true;
  }

  async function checkNow(reason = 'interval') {
    if (phase !== 'idle') return false;
    phase = 'checking';
    let manifest;
    try {
      manifest = await fetchManifest();
    } catch (e) {
      phase = 'idle';
      logger.warn?.(`⚠️  Actualización (${reason}): no se pudo leer el manifiesto: ${e?.message || e}`);
      return false;
    }
    if (!manifest || !isNewer(manifest.version, currentVersion)) {
      phase = 'idle';
      return false;
    }
    return run(manifest);
  }

  return {
    get phase() {
      return phase;
    },
    start() {
      if (running) return;
      running = true;
      interval = unref(setIntervalImpl(() => void checkNow('interval'), checkEveryMs));
    },
    stop() {
      running = false;
      if (interval) clearIntervalImpl(interval);
      if (releaseTimer) clearTimeoutImpl(releaseTimer);
      interval = releaseTimer = null;
    },
    checkNow,
    /** Aviso realtime: espera aleatoria para no descargar toda la flota a la vez. */
    onRelease() {
      if (releaseTimer || phase !== 'idle') return;
      releaseTimer = unref(
        setTimeoutImpl(() => {
          releaseTimer = null;
          void checkNow('realtime');
        }, Math.round(random() * jitterMs)),
      );
    },
  };
}
