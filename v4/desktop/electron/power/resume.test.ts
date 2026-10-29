import { describe, expect, it } from 'vitest';
import {
  CLOCK_JUMP_MS,
  CLOCK_TICK_MS,
  RESUME_COALESCE_MS,
  createClockJumpDetector,
  createResumeCoordinator,
  decideWaAction,
  withTimeout,
  type IntervalApi,
  type ResumeDeps,
  type TimeoutApi,
} from './resume';

/** Reloj falso: `advance` mueve el tiempo y dispara timeouts vencidos. */
function fakeClock() {
  let t = 1_000_000;
  let seq = 0;
  const timeouts = new Map<number, { at: number; fn: () => void }>();
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  const timers: TimeoutApi & IntervalApi = {
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timeouts.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (h) => {
      timeouts.delete(h as number);
    },
    setInterval: (fn, ms) => {
      const id = ++seq;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (h) => {
      intervals.delete(h as number);
    },
  };
  return {
    now: () => t,
    timers,
    /** Mueve el reloj sin correr intervalos (equipo suspendido). */
    jump(ms: number) {
      t += ms;
    },
    advance(ms: number) {
      t += ms;
      for (const [id, x] of [...timeouts]) {
        if (x.at <= t) {
          timeouts.delete(id);
          x.fn();
        }
      }
    },
    tickIntervals() {
      for (const x of intervals.values()) x.fn();
    },
    intervalCount: () => intervals.size,
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('createClockJumpDetector', () => {
  it('no dispara con ticks normales de 5 s', () => {
    const c = fakeClock();
    const jumps: number[] = [];
    const d = createClockJumpDetector({ onJump: (g) => jumps.push(g), now: c.now, timers: c.timers });
    d.start();
    for (let i = 0; i < 20; i++) {
      c.jump(CLOCK_TICK_MS);
      c.tickIntervals();
    }
    expect(jumps).toEqual([]);
  });

  it('dispara una vez tras un hueco > 30 s (suspensión) y sigue vigilando', () => {
    const c = fakeClock();
    const jumps: number[] = [];
    const d = createClockJumpDetector({ onJump: (g) => jumps.push(g), now: c.now, timers: c.timers });
    d.start();
    c.jump(CLOCK_TICK_MS);
    c.tickIntervals();
    c.jump(10 * 60_000); // 10 min suspendido
    c.tickIntervals();
    c.jump(CLOCK_TICK_MS);
    c.tickIntervals();
    expect(jumps).toEqual([10 * 60_000]);
    c.jump(CLOCK_JUMP_MS + 1);
    c.tickIntervals();
    expect(jumps.length).toBe(2);
  });

  it('un error del handler no detiene el detector; start es idempotente y stop limpia', () => {
    const c = fakeClock();
    let n = 0;
    const d = createClockJumpDetector({
      onJump: () => {
        n += 1;
        throw new Error('boom');
      },
      now: c.now,
      timers: c.timers,
    });
    d.start();
    d.start();
    expect(c.intervalCount()).toBe(1);
    c.jump(60_000);
    expect(() => d.tick()).not.toThrow();
    c.jump(60_000);
    d.tick();
    expect(n).toBe(2);
    d.stop();
    expect(c.intervalCount()).toBe(0);
  });
});

describe('withTimeout', () => {
  it('devuelve el fallback si la promesa se cuelga o falla', async () => {
    const c = fakeClock();
    const hung = withTimeout(new Promise<string>(() => undefined), 1000, 'timeout', c.timers);
    c.advance(1000);
    expect(await hung).toBe('timeout');
    expect(await withTimeout(Promise.reject(new Error('x')), 1000, 'fb', c.timers)).toBe('fb');
    expect(await withTimeout(Promise.resolve('ok'), 1000, 'fb', c.timers)).toBe('ok');
  });
});

describe('decideWaAction', () => {
  it('reinicia solo si estaba conectado y getState no es CONNECTED', () => {
    expect(decideWaAction({ hasSession: true, lastStatus: 'connected', probe: 'CONNECTED' })).toBe('ok');
    for (const probe of ['timeout', 'absent', 'UNPAIRED', 'null', 'error'])
      expect(decideWaAction({ hasSession: true, lastStatus: 'connected', probe })).toBe('restart');
    expect(decideWaAction({ hasSession: true, lastStatus: 'authenticated', probe: 'timeout' })).toBe('restart');
  });

  it('no toca WhatsApp sin sesión, en QR, inactivo o desconectado por conflicto', () => {
    expect(decideWaAction({ hasSession: false, lastStatus: 'connected', probe: 'timeout' })).toBe('skip');
    for (const lastStatus of ['qr', 'idle', 'disconnected'])
      expect(decideWaAction({ hasSession: true, lastStatus, probe: 'absent' })).toBe('skip');
  });
});

function coordinator(over: Partial<ResumeDeps> = {}) {
  const c = fakeClock();
  const calls: string[] = [];
  const co = createResumeCoordinator({
    hasSession: () => true,
    refreshToken: async () => calls.push('token'),
    reconnectRealtime: () => calls.push('realtime'),
    pollNow: () => calls.push('poll'),
    settingsRefreshNow: () => calls.push('settings'),
    checkWhatsapp: async () => calls.push('wa'),
    heartbeat: () => calls.push('heartbeat'),
    now: c.now,
    timers: c.timers,
    ...over,
  });
  return { c, calls, co };
}

describe('createResumeCoordinator', () => {
  it('ejecuta los pasos en orden: token, realtime, poll, settings, WhatsApp, heartbeat', async () => {
    const { co, calls } = coordinator();
    co.onSuspend();
    await co.signal('resume');
    expect(calls).toEqual(['token', 'realtime', 'poll', 'settings', 'wa', 'heartbeat']);
  });

  it('con checkUpdates: revisa el feed después de la configuración', async () => {
    const { co, calls } = coordinator({ checkUpdates: () => void calls.push('update') });
    await co.signal('resume');
    expect(calls).toEqual(['token', 'realtime', 'poll', 'settings', 'update', 'wa', 'heartbeat']);
  });

  it('agrupa resume + unlock-screen + salto de reloj en una sola recuperación', async () => {
    const { co, calls, c } = coordinator();
    const p = co.signal('resume');
    expect(p).not.toBeNull();
    expect(co.signal('unlock-screen')).toBeNull(); // en curso
    await p;
    c.advance(1000);
    expect(co.signal('clock-jump')).toBeNull(); // dentro de la ventana
    expect(co.runs()).toBe(1);
    expect(calls.filter((x) => x === 'poll').length).toBe(1);
    c.advance(RESUME_COALESCE_MS);
    await co.signal('resume');
    expect(co.runs()).toBe(2);
  });

  it('sin sesión no hace nada', () => {
    const { co, calls } = coordinator({ hasSession: () => false });
    expect(co.signal('resume')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('un token o WhatsApp colgado no bloquea la recuperación (tiempo límite por paso)', async () => {
    const { co, calls, c } = coordinator({
      refreshToken: () => new Promise(() => undefined),
      checkWhatsapp: () => new Promise(() => undefined),
      stepTimeoutMs: 1000,
    });
    const p = co.signal('resume')!;
    await flush();
    c.advance(1000); // vence el token
    await flush();
    expect(calls).toEqual(['realtime', 'poll', 'settings']);
    c.advance(1000); // vence WhatsApp
    await p;
    expect(calls).toEqual(['realtime', 'poll', 'settings', 'heartbeat']);
    expect(co.isRecovering()).toBe(false);
  });

  it('un paso que lanza no impide los siguientes', async () => {
    const logs: string[] = [];
    const { co, calls } = coordinator({
      reconnectRealtime: () => {
        throw new Error('socket');
      },
      checkWhatsapp: async () => {
        throw new Error('chromium');
      },
      log: (m) => logs.push(m),
    });
    await co.signal('clock-jump');
    expect(calls).toEqual(['token', 'poll', 'settings', 'heartbeat']);
    expect(logs.some((l) => l.includes('realtime'))).toBe(true);
  });
});
