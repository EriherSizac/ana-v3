/**
 * Espera entre polls del CLI (add-realtime-v3-cli, design D3).
 *
 * - 30 s con el canal realtime inactivo y 2 min con el canal activo; la
 *   duración se decide al empezar y, si el canal cae durante una espera de
 *   2 min, se acorta a lo que reste de 30 s.
 * - Un aviso (`wake`) termina la espera de inmediato. Un aviso recibido
 *   fuera de la espera (ciclo de envío, pausa por lote) queda pendiente y la
 *   siguiente espera termina sin dormir.
 * - Etiqueta del widget: "En vivo · respaldo en 1m 45s" (activo) o
 *   "Próximo poll: 00:00:30" (inactivo, como antes).
 */

export const POLL_INTERVAL_MS = 30 * 1000;
export const POLL_BACKUP_INTERVAL_MS = 2 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

/** `HH:MM:SS` (formato previo del widget). */
export function formatHms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** `1m 45s` / `45s`. */
export function formatShort(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Texto del widget mientras se espera el siguiente poll. */
export function waitLabel(active, remainingMs) {
  return active ? `En vivo · respaldo en ${formatShort(remainingMs)}` : `Próximo poll: ${formatHms(remainingMs)}`;
}

/** Despertador de la espera entre polls. */
export function createPollWaker() {
  let pending = false;
  let waiter = null;
  return {
    /**
     * Termina la espera en curso. Sin espera en curso: con `pendingIfIdle`
     * (aviso de asignación, actualización forzada) la siguiente espera termina
     * de inmediato; sin él (reconexión) no deja nada pendiente.
     */
    wake({ pendingIfIdle = true } = {}) {
      if (waiter) waiter();
      else if (pendingIfIdle) pending = true;
    },
    takePending() {
      const p = pending;
      pending = false;
      return p;
    },
    attach(fn) {
      waiter = fn;
    },
    detach(fn) {
      if (waiter === fn) waiter = null;
    },
    get waiting() {
      return waiter !== null;
    },
  };
}

/**
 * Espera hasta el siguiente poll. Resuelve `'woken'` (aviso) o `'timeout'`.
 * @param {{ isActive: () => boolean, waker: ReturnType<typeof createPollWaker>,
 *   onTick?: (remainingMs: number, active: boolean) => void|Promise<void>,
 *   tickMs?: number, now?: () => number, setTimeoutImpl?: Function, clearTimeoutImpl?: Function }} o
 */
export function waitForNextPoll({
  isActive,
  waker,
  onTick = () => {},
  tickMs = 1000,
  now = () => Date.now(),
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutImpl = (h) => clearTimeout(h),
}) {
  if (waker.takePending()) return Promise.resolve('woken');
  const start = now();
  let endAt = start + (isActive() ? POLL_BACKUP_INTERVAL_MS : POLL_INTERVAL_MS);
  return new Promise((resolve) => {
    let timer = null;
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      if (timer) clearTimeoutImpl(timer);
      waker.detach(onWake);
      resolve(why);
    };
    const onWake = () => finish('woken');
    waker.attach(onWake);
    const tick = async () => {
      if (done) return;
      const act = isActive();
      if (!act) endAt = Math.min(endAt, start + POLL_INTERVAL_MS);
      const remaining = endAt - now();
      if (remaining <= 0) return finish('timeout');
      try {
        await onTick(remaining, act);
      } catch {
        /* el widget no debe romper la espera */
      }
      if (done) return;
      timer = setTimeoutImpl(tick, Math.min(tickMs, Math.max(1, endAt - now())));
    };
    void tick();
  });
}
