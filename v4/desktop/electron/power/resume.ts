// File: Recuperación tras suspensión/reanudación del equipo (harden-client-resume): detector de saltos de reloj y coordinador de reanudación.
// Created: 2026-10-29
// Updated: 2026-10-29
// Author: Erick Hernández Silva

/**
 * Los agentes suspenden el equipo (pausas, baño). Al volver, el socket realtime
 * puede estar muerto sin cierre, el token vencido y Chromium de WhatsApp
 * congelado. Este módulo es puro (reloj y timers inyectables):
 *  - `createClockJumpDetector`: respaldo de `powerMonitor` — un intervalo de 5 s
 *    compara `Date.now()`; un hueco > 30 s se trata como reanudación;
 *  - `createResumeCoordinator`: agrupa las señales (`resume`, `unlock-screen`,
 *    salto de reloj) en una sola recuperación y ejecuta los pasos en orden,
 *    cada uno aislado y con tiempo límite;
 *  - `decideWaAction`: qué hacer con el cliente de WhatsApp según su estado.
 */

export const CLOCK_TICK_MS = 5_000;
export const CLOCK_JUMP_MS = 30_000;
/** Señales dentro de esta ventana tras una recuperación se agrupan en ella. */
export const RESUME_COALESCE_MS = 15_000;
/** Tiempo máximo por paso de recuperación (token, estado de WhatsApp). */
export const RESUME_STEP_TIMEOUT_MS = 15_000;
export const WA_PROBE_TIMEOUT_MS = 10_000;

export interface IntervalApi {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (h: unknown) => void;
}

export interface TimeoutApi {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
}

const realIntervals: IntervalApi = {
  setInterval: (fn, ms) => {
    const h = setInterval(fn, ms);
    (h as { unref?: () => void }).unref?.();
    return h;
  },
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

const realTimeouts: TimeoutApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface ClockJumpOptions {
  onJump: (gapMs: number) => void;
  now?: () => number;
  timers?: IntervalApi;
  tickMs?: number;
  thresholdMs?: number;
}

/**
 * Detector de saltos de reloj: con el equipo suspendido el intervalo no corre,
 * así que al despertar la diferencia entre ticks supera por mucho los 5 s.
 * También cubre congelamientos largos del proceso.
 */
export function createClockJumpDetector(opts: ClockJumpOptions) {
  const now = opts.now ?? Date.now;
  const timers = opts.timers ?? realIntervals;
  const tickMs = opts.tickMs ?? CLOCK_TICK_MS;
  const threshold = opts.thresholdMs ?? CLOCK_JUMP_MS;
  let last = now();
  let handle: unknown = null;

  const tick = () => {
    const t = now();
    const gap = t - last;
    last = t;
    // Hueco > umbral (o reloj hacia atrás de más del umbral): reanudación.
    if (gap > threshold || gap < -threshold) {
      try {
        opts.onJump(gap);
      } catch {
        /* el detector nunca se detiene por un error del handler */
      }
    }
  };

  return {
    start() {
      if (handle) return;
      last = now();
      handle = timers.setInterval(tick, tickMs);
    },
    stop() {
      if (handle) timers.clearInterval(handle);
      handle = null;
    },
    /** Expuesto para pruebas. */
    tick,
  };
}

/** Resuelve con el valor de `p`, o con `fallback` si tarda más de `ms` o falla. */
export function withTimeout<T>(p: Promise<T> | T, ms: number, fallback: T, timers: TimeoutApi = realTimeouts): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const h = timers.setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(p).then(
      (v) => {
        if (done) return;
        done = true;
        timers.clearTimeout(h);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        timers.clearTimeout(h);
        resolve(fallback);
      },
    );
  });
}

export type WaProbe = 'CONNECTED' | 'absent' | 'timeout' | string;
export type WaAction = 'ok' | 'skip' | 'restart';

/**
 * Qué hacer con WhatsApp al reanudar:
 *  - sin sesión de la app, o WhatsApp no estaba conectado (QR, inactivo,
 *    desconectado por conflicto): nada;
 *  - `CONNECTED`: nada;
 *  - otro estado, cliente ausente o `getState` colgado: reinicializar
 *    conservando la sesión guardada (sin QR).
 */
export function decideWaAction(input: { hasSession: boolean; lastStatus: string; probe: WaProbe }): WaAction {
  if (!input.hasSession) return 'skip';
  // `disconnected` (conflicto, cierre desde el teléfono) conserva su flujo
  // actual: reconectar solo podría robar la sesión a otro equipo.
  if (input.lastStatus !== 'connected' && input.lastStatus !== 'authenticated') return 'skip';
  if (input.probe === 'CONNECTED') return 'ok';
  return 'restart';
}

export type ResumeSource = 'resume' | 'unlock-screen' | 'clock-jump';

export interface ResumeDeps {
  /** Renueva el token si está por vencer o vencido (`TokenBroker.getFreshToken`). */
  refreshToken: () => Promise<unknown>;
  /** Cierra el socket (posiblemente muerto) y abre uno nuevo con backoff reiniciado. */
  reconnectRealtime: () => void;
  pollNow: () => void;
  settingsRefreshNow: () => void;
  /** Revisa WhatsApp y lo reinicializa si hace falta (ver `decideWaAction`). */
  checkWhatsapp: () => Promise<unknown>;
  heartbeat: () => void;
  /** ¿Hay sesión del operador? Sin sesión solo se registra la señal. */
  hasSession: () => boolean;
  now?: () => number;
  timers?: TimeoutApi;
  coalesceMs?: number;
  stepTimeoutMs?: number;
  log?: (msg: string) => void;
}

/**
 * Coordinador de reanudación. Varias señales seguidas (`resume` +
 * `unlock-screen` + salto de reloj) producen UNA recuperación; una señal
 * durante una recuperación en curso se ignora.
 */
export function createResumeCoordinator(deps: ResumeDeps) {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? realTimeouts;
  const coalesce = deps.coalesceMs ?? RESUME_COALESCE_MS;
  const stepMs = deps.stepTimeoutMs ?? RESUME_STEP_TIMEOUT_MS;
  const log = deps.log ?? (() => undefined);
  let running: Promise<void> | null = null;
  let lastRunAt = -Infinity;
  let suspendedAt: number | null = null;
  let runs = 0;

  const step = (name: string, fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      log(`[resume] paso ${name} falló: ${(e as Error)?.message ?? e}`);
    }
  };

  async function recover(source: ResumeSource): Promise<void> {
    runs += 1;
    log(`[resume] recuperación tras ${source}`);
    // 1) Token primero: realtime, poll y WhatsApp lo necesitan vigente.
    await withTimeout(Promise.resolve().then(deps.refreshToken), stepMs, undefined, timers);
    // 2) Canal realtime nuevo (el socket previo pudo morir sin cierre).
    step('realtime', deps.reconnectRealtime);
    // 3) Lecturas inmediatas.
    step('poll', deps.pollNow);
    step('settings', deps.settingsRefreshNow);
    // 4) WhatsApp (puede reinicializar; acotado).
    await withTimeout(Promise.resolve().then(deps.checkWhatsapp), stepMs, undefined, timers);
    // 5) Presencia del agente.
    step('heartbeat', deps.heartbeat);
  }

  return {
    onSuspend() {
      suspendedAt = now();
      log('[resume] equipo suspendido');
    },
    /** Señal de reanudación; devuelve la recuperación (o `null` si se agrupó). */
    signal(source: ResumeSource): Promise<void> | null {
      const t = now();
      const away = suspendedAt != null ? t - suspendedAt : null;
      suspendedAt = null;
      if (running) return null;
      if (t - lastRunAt < coalesce) return null;
      if (!deps.hasSession()) {
        log(`[resume] ${source} sin sesión: nada que recuperar`);
        return null;
      }
      if (away != null) log(`[resume] ${source} tras ${Math.round(away / 1000)} s suspendido`);
      lastRunAt = t;
      running = recover(source)
        .catch((e) => log(`[resume] recuperación falló: ${(e as Error)?.message ?? e}`))
        .finally(() => {
          lastRunAt = now();
          running = null;
        });
      return running;
    },
    isRecovering: () => running !== null,
    runs: () => runs,
  };
}
