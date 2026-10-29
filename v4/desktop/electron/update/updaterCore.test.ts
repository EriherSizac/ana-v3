import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  UpdaterCore,
  CHECK_EVERY_MS,
  MAX_JOB_WAIT_MS,
  RESTART_COUNTDOWN_S,
  type UpdaterLike,
  type UpdateStatus,
} from './updaterCore';

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn(async () => undefined as unknown);
  quitAndInstall = vi.fn();
}

const EVENTS = ['checking-for-update', 'update-available', 'download-progress', 'update-downloaded', 'update-not-available', 'error'];

function make(isPackaged = true) {
  const updater = new FakeUpdater();
  const setInterval = vi.fn();
  const setTimeout = vi.fn((fn: () => void) => fn());
  const core = new UpdaterCore({ updater, isPackaged, setInterval, setTimeout });
  const sent: UpdateStatus[] = [];
  return { updater, setInterval, setTimeout, core, sent, send: (s: UpdateStatus) => sent.push(s) };
}

describe('UpdaterCore.setup', () => {
  it('tres llamadas registran un listener por evento y un solo intervalo', () => {
    const { updater, setInterval, core, send } = make();
    core.setup(send);
    core.setup(send);
    core.setup(send);
    for (const e of EVENTS) expect(updater.listenerCount(e)).toBe(1);
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(setInterval.mock.calls[0][1]).toBe(CHECK_EVERY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('una nueva llamada re-emite la última fase al nuevo destino', () => {
    const { updater, core, send } = make();
    core.setup(send);
    updater.emit('update-not-available');
    const again: UpdateStatus[] = [];
    core.setup((s) => again.push(s));
    expect(again).toEqual([{ phase: 'none' }]);
  });

  it('dev: emite none sin consultar el feed', () => {
    const { updater, core, sent, send } = make(false);
    core.setup(send);
    expect(sent).toEqual([{ phase: 'none' }]);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('arranque: error → error; 404 → none', () => {
    const { updater, core, sent, send } = make();
    core.setup(send);
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    updater.emit('error', new Error('HttpError: 404 latest.yml'));
    expect(sent.slice(-2)).toEqual([
      { phase: 'error', message: 'Error: net::ERR_INTERNET_DISCONNECTED' },
      { phase: 'none' },
    ]);
  });

  it('retry vuelve a consultar el feed', () => {
    const { updater, core, send } = make();
    core.setup(send);
    core.retry();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('bypass: emite none+bypass y un error posterior no re-bloquea', () => {
    const { updater, core, sent, send } = make();
    core.setup(send);
    updater.emit('error', new Error('ECONNREFUSED'));
    core.markBypassed();
    updater.emit('error', new Error('ECONNREFUSED'));
    updater.emit('checking-for-update');
    expect(sent.at(-1)).toEqual({ phase: 'none', bypass: true });
    const again: UpdateStatus[] = [];
    core.setup((s) => again.push(s));
    expect(again).toEqual([{ phase: 'none', bypass: true }]);
  });
});

describe('UpdaterCore: instalación tras el job en curso', () => {
  it('con job en curso: pausa, espera (máx 3 min) y luego instala', async () => {
    const { updater, core, sent, send } = make();
    const order: string[] = [];
    let release!: () => void;
    const hooks = {
      pauseNewJobs: vi.fn(() => order.push('pause')),
      hasJobInFlight: () => true,
      waitIdle: vi.fn((ms: number) => {
        order.push(`wait:${ms}`);
        return new Promise<void>((r) => (release = r));
      }),
      beforeInstall: vi.fn(async () => void order.push('stopWa')),
    };
    core.setup(send, hooks);
    updater.emit('update-downloaded');
    await Promise.resolve();
    expect(sent.at(-1)).toEqual({ phase: 'installing', waitingForJob: true });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true));
    expect(order).toEqual(['pause', `wait:${MAX_JOB_WAIT_MS}`, 'stopWa']);
  });

  it('sin job en curso: instala de inmediato', async () => {
    const { updater, core, sent, send } = make();
    const waitIdle = vi.fn(async () => {});
    core.setup(send, { hasJobInFlight: () => false, waitIdle });
    updater.emit('update-downloaded');
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalled());
    expect(waitIdle).not.toHaveBeenCalled();
    expect(sent.at(-1)).toEqual({ phase: 'installing', waitingForJob: false });
  });
});

describe('UpdaterCore: a media sesión (add-in-session-updates)', () => {
  /** Core ya pasado el arranque (primera fase none) con hooks espía. */
  function inSession(over: Record<string, unknown> = {}) {
    const m = make();
    const order: string[] = [];
    const hooks = {
      pauseNewJobs: vi.fn(() => order.push('pause')),
      resumeJobs: vi.fn(() => order.push('resume')),
      hasJobInFlight: vi.fn(() => false),
      waitIdle: vi.fn(async () => void order.push('wait')),
      beforeInstall: vi.fn(async () => void order.push('stopWa')),
      ...over,
    };
    m.core.setup(m.send, hooks);
    m.updater.emit('update-not-available');
    m.sent.length = 0;
    return { ...m, hooks, order };
  }

  it('versión nueva: pausa jobs al detectarla, descarga sin bloquear, 60 s y instalación silenciosa', async () => {
    const { updater, sent, hooks, order } = inSession();
    updater.emit('checking-for-update'); // sin fase checking: no bloquea
    updater.emit('update-available', { version: '1.5.1' });
    expect(hooks.pauseNewJobs).toHaveBeenCalledTimes(1);
    updater.emit('download-progress', { percent: 41.6 });
    expect(sent.slice(0, 2)).toEqual([
      { phase: 'downloading', version: '1.5.1', percent: 0, inSession: true },
      { phase: 'downloading', version: '1.5.1', percent: 42, inSession: true },
    ]);
    updater.emit('update-downloaded');
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true));
    const countdown = sent.filter((s) => s.phase === 'restarting').map((s) => s.secondsLeft);
    expect(countdown).toHaveLength(RESTART_COUNTDOWN_S);
    expect(countdown[0]).toBe(60);
    expect(countdown.at(-1)).toBe(1);
    expect(sent.every((s) => s.inSession)).toBe(true);
    expect(sent.some((s) => s.phase === 'checking')).toBe(false);
    expect(order).toEqual(['pause', 'pause', 'stopWa']);
  });

  it('job en curso al terminar la descarga: espera el job (máx 3 min) antes de la cuenta', async () => {
    let release!: () => void;
    const { updater, sent, hooks } = inSession({
      hasJobInFlight: vi.fn(() => true),
      waitIdle: vi.fn(() => new Promise<void>((r) => (release = r))),
    });
    updater.emit('update-available', { version: '1.5.1' });
    updater.emit('update-downloaded');
    await Promise.resolve();
    expect(sent.at(-1)).toEqual({ phase: 'installing', version: '1.5.1', waitingForJob: true, inSession: true });
    expect(hooks.waitIdle).toHaveBeenCalledWith(MAX_JOB_WAIT_MS);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true));
  });

  it('error de descarga: reanuda jobs y avisa sin bloquear; un chequeo fallido solo se registra', () => {
    const { updater, sent, hooks } = inSession();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    updater.emit('error', new Error('net::ERR_CONNECTION_RESET'));
    expect(sent).toEqual([]);
    updater.emit('update-available', { version: '1.5.1' });
    updater.emit('error', new Error('net::ERR_CONNECTION_RESET'));
    expect(hooks.resumeJobs).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toEqual({
      phase: 'error',
      version: '1.5.1',
      message: 'Error: net::ERR_CONNECTION_RESET',
      inSession: true,
    });
    warn.mockRestore();
  });

  it('checkNow: consulta a media sesión y se ignora con una actualización en curso', () => {
    const { updater, core } = inSession();
    expect(core.checkNow()).toBe(true);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.emit('update-available', { version: '1.5.1' });
    expect(core.isUpdatingInSession()).toBe(true);
    expect(core.checkNow()).toBe(false);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('checkSoon: espera aleatoria (0–30 s) y agrupa avisos', () => {
    const m = make();
    const delays: number[] = [];
    const fns: (() => void)[] = [];
    const core = new UpdaterCore({
      updater: m.updater,
      isPackaged: true,
      setInterval: vi.fn(),
      setTimeout: (fn: () => void, ms: number) => {
        delays.push(ms);
        fns.push(fn);
      },
    });
    core.setup(m.send);
    core.checkSoon(30_000, () => 0.5);
    core.checkSoon(30_000, () => 0.5);
    expect(delays).toEqual([15_000]);
    fns[0]();
    expect(m.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('dev (no empaquetado): checkNow no consulta', () => {
    const { updater, core, send } = make(false);
    core.setup(send);
    expect(core.checkNow()).toBe(false);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
