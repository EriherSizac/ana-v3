// Intervalo variable y consulta inmediata (add-realtime-v4-desktop D3/D4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobPoller, POLL_BACKUP_INTERVAL_MS, POLL_INTERVAL_MS, type PollerDeps, type SendJob } from './poller';
import { RemoteSettings, SETTINGS_BACKUP_REFRESH_MS, SETTINGS_REFRESH_MS } from '../settings/remoteSettings';

const job = (id: string, extra: Partial<SendJob> = {}): SendJob => ({
  jobId: id,
  campaignId: 'c1',
  phone: '5512345678',
  template: 'Hola',
  row: {},
  countryCode: '52',
  srcKey: 'csv-uploads/a.csv',
  status: 'pending',
  ...extra,
});
const pollBody = (jobs: SendJob[]) => new Response(JSON.stringify({ jobs: jobs.map((j) => ({ id: j.jobId, job: j })) }), { status: 200 });

let polls: number;
let interval: number;
let stops: Array<() => void>;
function makePoller(over: Partial<PollerDeps> = {}) {
  const authFetch = vi.fn(async (url: string) => {
    if (url.endsWith('/jobs/poll')) {
      polls += 1;
      return pollBody([]);
    }
    return new Response('{}', { status: 200 });
  });
  const poller = new JobPoller({
    apiBase: 'https://api',
    hasSession: () => true,
    authFetch,
    runJob: async () => ({ success: true }),
    onProgress: () => {},
    onAssignment: () => {},
    intervalMs: () => interval,
    ...over,
  });
  stops.push(() => poller.stop());
  return poller;
}

beforeEach(() => {
  vi.useFakeTimers();
  polls = 0;
  interval = POLL_INTERVAL_MS;
  stops = [];
});
afterEach(() => {
  stops.forEach((s) => s());
  vi.useRealTimers();
});

describe('JobPoller con canal realtime', () => {
  it('pollNow ×5 en 500 ms → una sola consulta en ≤ 1 s', async () => {
    interval = POLL_BACKUP_INTERVAL_MS;
    const p = makePoller();
    p.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(polls).toBe(1);
    for (let i = 0; i < 5; i++) {
      p.pollNow();
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(600);
    expect(polls).toBe(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(polls).toBe(2);
  });

  it('canal activo sin eventos: ~5 consultas en 10 min', async () => {
    interval = POLL_BACKUP_INTERVAL_MS;
    const p = makePoller();
    p.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1000);
    expect(polls).toBe(5);
  });

  it('canal caído: la siguiente consulta en ≤ 5 s', async () => {
    interval = POLL_BACKUP_INTERVAL_MS;
    const p = makePoller();
    p.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(polls).toBe(1);
    interval = POLL_INTERVAL_MS;
    p.intervalChanged();
    await vi.advanceTimersByTimeAsync(10);
    expect(polls).toBe(2); // ya pasaron más de 5 s desde la última
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(polls).toBe(3);
  });

  it('pollNow durante un envío: no interrumpe y consulta al terminar el lote', async () => {
    interval = POLL_BACKUP_INTERVAL_MS;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const authFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/jobs/poll')) {
        polls += 1;
        if (first) {
          first = false;
          return pollBody([job('a#1', { auto: true })]);
        }
        return pollBody([]);
      }
      return new Response('{}', { status: 200 });
    });
    const p = makePoller({
      authFetch,
      runJob: async () => {
        await gate;
        return { success: true };
      },
    });
    p.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(polls).toBe(1);
    p.pollNow();
    await vi.advanceTimersByTimeAsync(3000);
    expect(polls).toBe(1); // sigue enviando
    release();
    await vi.advanceTimersByTimeAsync(2500);
    expect(polls).toBe(2);
  });
});

describe('RemoteSettings con canal realtime', () => {
  it('refreshNow aplica el valor nuevo en ≤ 1 s; con 15 min no consulta antes', async () => {
    let gap = 120;
    const authFetch = vi.fn(async () => new Response(JSON.stringify({ values: { sendMinGapSeconds: gap } }), { status: 200 }));
    let ms = SETTINGS_BACKUP_REFRESH_MS;
    const rs = new RemoteSettings({ apiBase: 'https://api', hasSession: () => true, authFetch, intervalMs: () => ms });
    rs.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(authFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SETTINGS_REFRESH_MS);
    expect(authFetch).toHaveBeenCalledTimes(1); // 5 min no basta con canal activo
    gap = 180;
    rs.refreshNow();
    rs.refreshNow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(rs.get().sendMinGapSeconds).toBe(180);
    await vi.advanceTimersByTimeAsync(SETTINGS_BACKUP_REFRESH_MS);
    expect(authFetch).toHaveBeenCalledTimes(3);
    ms = SETTINGS_REFRESH_MS;
    rs.intervalChanged();
    await vi.advanceTimersByTimeAsync(SETTINGS_REFRESH_MS);
    expect(authFetch).toHaveBeenCalledTimes(4);
    rs.stop();
  });
});
