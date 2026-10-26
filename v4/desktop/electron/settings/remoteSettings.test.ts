import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, RemoteSettings, SETTINGS_REFRESH_MS, paceOf, sanitizeSettings } from './remoteSettings';

const okBody = (values: unknown) => new Response(JSON.stringify({ version: 1, values }), { status: 200 });

afterEach(() => vi.useRealTimers());

describe('RemoteSettings', () => {
  it('falla inicial → defaults; reintenta a los 5 minutos', async () => {
    vi.useFakeTimers();
    const responses = [new Response('', { status: 503 }), okBody({ ...DEFAULT_SETTINGS, sendMinGapSeconds: 180 })];
    const authFetch = vi.fn(async () => responses.shift() ?? okBody(DEFAULT_SETTINGS));
    const onChange = vi.fn();
    const rs = new RemoteSettings({ apiBase: 'https://api', hasSession: () => true, authFetch, onChange });
    rs.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(rs.get()).toEqual(DEFAULT_SETTINGS);
    expect(rs.get().openChatInteraction).toBe(false);
    await vi.advanceTimersByTimeAsync(SETTINGS_REFRESH_MS);
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(rs.get().sendMinGapSeconds).toBe(180);
    expect(onChange).toHaveBeenCalledTimes(1);
    rs.stop();
  });

  it('falla posterior → conserva el último valor', async () => {
    const responses = [okBody({ ...DEFAULT_SETTINGS, openChatInteraction: true }), new Response('', { status: 500 })];
    const rs = new RemoteSettings({ apiBase: 'https://api', hasSession: () => true, authFetch: vi.fn(async () => responses.shift()!) });
    expect(await rs.refresh()).toBe(true);
    expect(await rs.refresh()).toBe(false);
    expect(rs.get().openChatInteraction).toBe(true);
  });

  it('error de red no lanza y sin sesión no consulta', async () => {
    const authFetch = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const rs = new RemoteSettings({ apiBase: 'https://api', hasSession: () => true, authFetch });
    expect(await rs.refresh()).toBe(false);
    const rs2 = new RemoteSettings({ apiBase: 'https://api', hasSession: () => false, authFetch });
    expect(await rs2.refresh()).toBe(false);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('sanitize: valores fuera de límites se ignoran por llave; paceOf en ms', () => {
    expect(sanitizeSettings({ sendMinGapSeconds: 10, sendMaxPerWindow: 5, openChatInteraction: 'x' })).toEqual({
      ...DEFAULT_SETTINGS,
      sendMaxPerWindow: 5,
    });
    expect(paceOf(DEFAULT_SETTINGS)).toEqual({ minGapMs: 120_000, windowMs: 1_200_000, maxPerWindow: 7 });
  });
});
