import { describe, expect, it, vi } from 'vitest';
import { createRealtimeWiring, realtimeConfig } from './wiring';

describe('realtimeConfig', () => {
  it('entorno, luego build-config; sin URL o con ANA_REALTIME=off no conecta', () => {
    expect(realtimeConfig({ ANA_REALTIME_URL: 'wss://dev/dev' }, { realtimeUrl: 'wss://prod/prod' })).toEqual({ enabled: true, url: 'wss://dev/dev' });
    expect(realtimeConfig({}, { realtimeUrl: 'wss://prod/prod' })).toEqual({ enabled: true, url: 'wss://prod/prod' });
    expect(realtimeConfig({}, {})).toEqual({ enabled: false, url: null, reason: 'no_url' });
    expect(realtimeConfig({ ANA_REALTIME_URL: 'https://x' })).toEqual({ enabled: false, url: null, reason: 'no_url' });
    expect(realtimeConfig({ ANA_REALTIME: 'off', ANA_REALTIME_URL: 'wss://x/p' })).toEqual({ enabled: false, url: null, reason: 'flag' });
  });
});

describe('createRealtimeWiring', () => {
  const make = () => {
    const d = {
      pollNow: vi.fn(),
      pollIntervalChanged: vi.fn(),
      settingsRefreshNow: vi.fn(),
      settingsIntervalChanged: vi.fn(),
      refreshAccess: vi.fn(async () => {}),
      notifyRenderer: vi.fn(),
    };
    return { d, w: createRealtimeWiring(d) };
  };

  it('intervalos: inactivo 5 s / 5 min; activo 2 min / 15 min', () => {
    const { d, w } = make();
    expect([w.pollIntervalMs(), w.settingsIntervalMs()]).toEqual([5000, 300_000]);
    w.onState('active');
    expect([w.pollIntervalMs(), w.settingsIntervalMs()]).toEqual([120_000, 900_000]);
    expect(d.pollIntervalChanged).toHaveBeenCalledTimes(1);
    w.onState('inactive');
    expect(w.pollIntervalMs()).toBe(5000);
  });

  it('jobs.changed → pollNow; settings.changed desktop → refreshNow; otro scope se ignora', () => {
    const { d, w } = make();
    w.onEvent({ v: 1, type: 'jobs.changed', id: '1', at: 1 });
    w.onEvent({ v: 1, type: 'settings.changed', id: '2', at: 1, ref: { scope: 'desktop' } });
    w.onEvent({ v: 1, type: 'settings.changed', id: '3', at: 1, ref: { scope: 'cli' } });
    expect(d.pollNow).toHaveBeenCalledTimes(1);
    expect(d.settingsRefreshNow).toHaveBeenCalledTimes(1);
  });

  it('confirmación: lectura de jobs y configuración', () => {
    const { d, w } = make();
    w.onConfirmed();
    expect(d.pollNow).toHaveBeenCalledTimes(1);
    expect(d.settingsRefreshNow).toHaveBeenCalledTimes(1);
  });

  it('session.refresh: /me del main, aviso al renderer, jobs y configuración', () => {
    const { d, w } = make();
    w.onRefresh('permissions');
    expect(d.refreshAccess).toHaveBeenCalled();
    expect(d.notifyRenderer).toHaveBeenCalledWith('permissions');
    expect(d.pollNow).toHaveBeenCalled();
    expect(d.settingsRefreshNow).toHaveBeenCalled();
  });
});
