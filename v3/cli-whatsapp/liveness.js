/**
 * Vida del CLI tras suspensión/reanudación y congelamientos (harden-client-resume).
 *
 *  - `withTimeout` / `boundedUi`: toda interacción de UI no de envío (widget,
 *    bloqueador de pausa, sondeo de ventanas) tiene un límite de tiempo.
 *  - `createResumeDetector`: intervalo de 5 s que compara `Date.now()`; un
 *    salto > 30 s entre ticks significa que el equipo se suspendió (o el
 *    proceso estuvo congelado) y dispara `onResume`.
 *  - `createLoopHeartbeat`: si el ciclo principal no late (poll o tick de
 *    espera) en > 3× el intervalo esperado y no está enviando, `onStall`.
 *  - `checkPageHealth`: sondea una ventana de WhatsApp (`page.evaluate` con
 *    límite) y, si no responde, la recarga; nunca lanza.
 * Todo con reloj y temporizadores inyectables para pruebas.
 */

export const RESUME_CHECK_MS = 5_000;
export const RESUME_GAP_MS = 30_000;
export const HEARTBEAT_FACTOR = 3;
export const UI_TIMEOUT_MS = 3_000;
export const PAGE_PROBE_TIMEOUT_MS = 5_000;
export const PAGE_RELOAD_TIMEOUT_MS = 30_000;

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label || 'operación'} excedió ${ms} ms`);
    this.name = 'TimeoutError';
    this.code = 'ETIMEOUT';
  }
}

/** Resuelve como `promise` o rechaza con TimeoutError tras `ms`. */
export function withTimeout(promise, ms, label, { setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeoutImpl(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeoutImpl(timer));
}

/** Interacción de UI acotada: devuelve el valor, o `undefined` si falla o vence. Nunca lanza. */
export async function boundedUi(fn, ms = UI_TIMEOUT_MS, opts) {
  try {
    return await withTimeout(Promise.resolve().then(fn), ms, 'ui', opts);
  } catch {
    return undefined;
  }
}

/**
 * Detector de reanudación por salto de reloj.
 * @param {{ onResume: (info: { gapMs: number }) => void, intervalMs?: number, gapMs?: number,
 *   now?: () => number, setIntervalImpl?: Function, clearIntervalImpl?: Function, logger?: Console }} o
 */
export function createResumeDetector({
  onResume,
  intervalMs = RESUME_CHECK_MS,
  gapMs = RESUME_GAP_MS,
  now = () => Date.now(),
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (h) => clearInterval(h),
  logger = console,
}) {
  let last = now();
  let handle = null;
  const check = () => {
    const t = now();
    const delta = t - last;
    last = t;
    // Un reloj que retrocede (ajuste de hora) también cuenta como salto.
    if (delta > gapMs || delta < -gapMs) {
      try {
        onResume({ gapMs: delta });
      } catch (e) {
        logger.error?.('[resume] manejador falló:', e?.message || e);
      }
      return true;
    }
    return false;
  };
  return {
    start() {
      if (handle) return;
      last = now();
      handle = setIntervalImpl(check, intervalMs);
      handle?.unref?.();
    },
    stop() {
      if (handle) clearIntervalImpl(handle);
      handle = null;
    },
    check,
  };
}

/**
 * Latido del ciclo principal. `beat()` en cada poll/tick de espera;
 * `setBusy(true)` durante el envío (no se reinicia a media asignación).
 * @param {{ expectedMs: number, onStall: (info: { elapsedMs: number }) => void, factor?: number,
 *   checkMs?: number, resumeGapMs?: number, now?: () => number,
 *   setIntervalImpl?: Function, clearIntervalImpl?: Function, logger?: Console }} o
 */
export function createLoopHeartbeat({
  expectedMs,
  onStall,
  factor = HEARTBEAT_FACTOR,
  checkMs = RESUME_CHECK_MS,
  resumeGapMs = RESUME_GAP_MS,
  now = () => Date.now(),
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (h) => clearInterval(h),
  logger = console,
}) {
  let lastBeat = now();
  let lastCheck = now();
  let busy = false;
  let handle = null;
  const limit = expectedMs * factor;
  const check = () => {
    const t = now();
    // Si el propio chequeo se retrasó (suspensión), se rebasa sin declarar bloqueo:
    // la reanudación la atiende el detector.
    if (t - lastCheck > checkMs + resumeGapMs) {
      lastCheck = t;
      lastBeat = t;
      return false;
    }
    lastCheck = t;
    if (busy) return false;
    const elapsed = t - lastBeat;
    if (elapsed <= limit) return false;
    lastBeat = t; // un aviso por periodo
    try {
      onStall({ elapsedMs: elapsed });
    } catch (e) {
      logger.error?.('[heartbeat] manejador falló:', e?.message || e);
    }
    return true;
  };
  return {
    beat() {
      lastBeat = now();
    },
    setBusy(v) {
      busy = !!v;
      lastBeat = now();
    },
    get busy() {
      return busy;
    },
    start() {
      if (handle) return;
      lastBeat = lastCheck = now();
      handle = setIntervalImpl(check, checkMs);
      handle?.unref?.();
    },
    stop() {
      if (handle) clearIntervalImpl(handle);
      handle = null;
    },
    check,
  };
}

/**
 * Estado de una ventana de WhatsApp: 'missing' | 'closed' | 'ok' | 'reloaded' | 'unresponsive'.
 * Nunca lanza.
 */
export async function checkPageHealth(page, { probeMs = PAGE_PROBE_TIMEOUT_MS, reloadMs = PAGE_RELOAD_TIMEOUT_MS, reload = true, timers } = {}) {
  if (!page) return 'missing';
  try {
    if (typeof page.isClosed === 'function' && page.isClosed()) return 'closed';
  } catch {
    return 'closed';
  }
  try {
    await withTimeout(page.evaluate(() => 1), probeMs, 'probe', timers);
    return 'ok';
  } catch {
    /* no responde: se intenta recargar */
  }
  if (!reload) return 'unresponsive';
  try {
    await withTimeout(page.reload({ timeout: reloadMs, waitUntil: 'domcontentloaded' }), reloadMs + 1000, 'reload', timers);
    return 'reloaded';
  } catch {
    return 'unresponsive';
  }
}

/**
 * Supervisor del ciclo: corre `iteration(gen)` hasta que termina o el latido
 * declara bloqueo (`stalled()` resuelve); en ese caso se abandona la iteración
 * colgada (su `gen` deja de ser vigente) y se inicia otra. La iteración debe
 * revisar `isCurrent(gen)` antes de efectos (crear registro, enviar).
 */
export function createLoopSupervisor() {
  let gen = 0;
  let stallResolve = null;
  return {
    get generation() {
      return gen;
    },
    isCurrent: (g) => g === gen,
    /** Señala bloqueo: la iteración actual se abandona. */
    stall() {
      gen += 1;
      const r = stallResolve;
      stallResolve = null;
      r?.('stalled');
    },
    /** Ejecuta una iteración; resuelve 'done' o 'stalled'. */
    async run(iteration) {
      const myGen = gen;
      const stalled = new Promise((resolve) => {
        stallResolve = resolve;
      });
      const work = Promise.resolve()
        .then(() => iteration(myGen))
        .then(() => 'done');
      // La iteración abandonada puede fallar después: no debe tumbar el proceso.
      work.catch(() => {});
      try {
        return await Promise.race([work, stalled]);
      } finally {
        if (gen === myGen) stallResolve = null;
      }
    },
  };
}
