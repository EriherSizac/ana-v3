import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { UpdaterCore, CHECK_EVERY_MS, MAX_JOB_WAIT_MS, type UpdaterLike, type UpdateStatus } from './updaterCore';

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

  it('404 → none; otro error → error', () => {
    const { updater, core, sent, send } = make();
    core.setup(send);
    updater.emit('error', new Error('HttpError: 404 latest.yml'));
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(sent.slice(-2)).toEqual([
      { phase: 'none' },
      { phase: 'error', message: 'Error: net::ERR_INTERNET_DISCONNECTED' },
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
