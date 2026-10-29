/**
 * Compuerta de pausa del ciclo principal (add-in-session-updates D3).
 *
 * El actualizador pide la pausa con `request()` (resuelve cuando el ciclo se
 * estacionó). El ciclo la consulta en puntos seguros (`requested`) y llama
 * `park()`, que espera hasta `resume()` latiendo para que el supervisor no lo
 * reinicie. `sleep(ms)` es una espera que termina antes si se pide la pausa.
 * Temporizadores inyectables para pruebas.
 */

export function createPauseGate({
  onRequest = () => {},
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutImpl = (h) => clearTimeout(h),
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (h) => clearInterval(h),
} = {}) {
  let requested = false;
  let parked = false;
  let parkedWaiters = [];
  let releasePark = null;
  const sleepers = new Set();

  const notifyParked = () => {
    const w = parkedWaiters;
    parkedWaiters = [];
    for (const r of w) r();
  };

  return {
    get requested() {
      return requested;
    },
    get parked() {
      return parked;
    },
    /** Pide la pausa; resuelve cuando el ciclo está estacionado. */
    request() {
      const p = new Promise((resolve) => {
        if (parked) resolve();
        else parkedWaiters.push(resolve);
      });
      if (!requested) {
        requested = true;
        for (const wake of [...sleepers]) wake();
        try {
          onRequest();
        } catch {
          /* el aviso no debe romper la pausa */
        }
      }
      return p;
    },
    /**
     * Estaciona el ciclo hasta `resume()` (si no hay pausa pedida, vuelve de
     * inmediato). `onBeat` se llama cada `beatMs` mientras está estacionado.
     */
    async park({ onBeat = () => {}, beatMs = 1000 } = {}) {
      if (!requested) return false;
      parked = true;
      const beat = () => {
        try {
          onBeat();
        } catch {
          /* el latido no debe romper la espera */
        }
      };
      beat();
      const h = setIntervalImpl(beat, beatMs);
      h?.unref?.();
      try {
        await new Promise((resolve) => {
          releasePark = resolve;
          notifyParked();
        });
      } finally {
        clearIntervalImpl(h);
        parked = false;
        releasePark = null;
      }
      return true;
    },
    /** Levanta la pausa (actualización fallida): el ciclo sigue donde quedó. */
    resume() {
      requested = false;
      const r = releasePark;
      releasePark = null;
      r?.();
    },
    /** Espera `ms` o hasta que se pida la pausa: `'timeout'` | `'pause'`. */
    sleep(ms) {
      if (requested) return Promise.resolve('pause');
      return new Promise((resolve) => {
        let timer = null;
        const done = (why) => {
          sleepers.delete(wake);
          if (timer) clearTimeoutImpl(timer);
          resolve(why);
        };
        const wake = () => done('pause');
        sleepers.add(wake);
        timer = setTimeoutImpl(() => done('timeout'), ms);
      });
    },
  };
}
