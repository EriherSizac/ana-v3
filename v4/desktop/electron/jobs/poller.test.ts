import { describe, it, expect, vi, afterEach } from 'vitest';
import { JobPoller, type SendJob, type PollerDeps } from './poller';

const job = (id: string, extra: Partial<SendJob> = {}): SendJob => ({
  jobId: id,
  campaignId: 'c1',
  campaign: 'bancoppel',
  phone: '5512345678',
  template: 'Hola',
  row: {},
  countryCode: '52',
  srcKey: 'csv-uploads/a.csv',
  status: 'pending',
  ...extra,
});

const pollResponse = (jobs: SendJob[]) =>
  new Response(JSON.stringify({ jobs: jobs.map((j) => ({ id: j.jobId, job: j })) }), { status: 200 });

function makePoller(over: Partial<PollerDeps> = {}) {
  const onAssignment = vi.fn();
  const deps: PollerDeps = {
    apiBase: 'https://api',
    hasSession: () => true,
    authFetch: vi.fn(async () => new Response('{}', { status: 200 })),
    runJob: vi.fn(async () => ({ success: true })),
    onProgress: () => {},
    onAssignment,
    ...over,
  };
  return { poller: new JobPoller(deps), deps, onAssignment };
}

let toStop: JobPoller[] = [];
afterEach(() => {
  toStop.forEach((p) => p.stop());
  toStop = [];
});

describe('JobPoller.pollOnce', () => {
  it('publica la asignación cuando la consulta es exitosa', async () => {
    const { poller, onAssignment } = makePoller({ authFetch: vi.fn(async () => pollResponse([job('j1')])) });
    await poller.pollOnce();
    expect(onAssignment).toHaveBeenCalledWith([expect.objectContaining({ jobId: 'j1' })]);
  });

  it('401 y 500 no emiten onAssignment([]) y conservan la última asignación', async () => {
    const responses = [pollResponse([job('j1')]), new Response('', { status: 401 }), new Response('', { status: 500 })];
    const { poller, onAssignment } = makePoller({ authFetch: vi.fn(async () => responses.shift()!) });
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();
    expect(onAssignment).toHaveBeenCalledTimes(1);
    expect(poller.getAssignment().map((j) => j.jobId)).toEqual(['j1']);
  });

  it('error de red no publica nada', async () => {
    const { poller, onAssignment } = makePoller({
      authFetch: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    });
    await poller.pollOnce();
    expect(onAssignment).not.toHaveBeenCalled();
  });
});

describe('JobPoller.pauseNewJobs / waitIdle', () => {
  it('sin job en curso, waitIdle resuelve de inmediato', async () => {
    const { poller } = makePoller();
    const t0 = Date.now();
    await poller.waitIdle(180_000);
    expect(Date.now() - t0).toBeLessThan(50);
    expect(poller.hasJobInFlight()).toBe(false);
  });

  it('con un job en curso, waitIdle resuelve al terminar y tras pauseNewJobs no arranca otro', async () => {
    let finish!: () => void;
    const runJob = vi.fn(
      () => new Promise<{ success: boolean }>((r) => (finish = () => r({ success: true }))),
    );
    const authFetch = vi.fn(async (url: string) =>
      url.endsWith('/jobs/poll') ? pollResponse([job('j1'), job('j2')]) : new Response('{}'),
    );
    const { poller } = makePoller({ runJob, authFetch });
    poller.start(); // running=true (el loop también consulta; mismo resultado)
    toStop.push(poller);
    await poller.pollOnce(); // llena `known`

    const approving = poller.approve(['j1', 'j2']);
    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1));
    expect(poller.hasJobInFlight()).toBe(true);

    poller.pauseNewJobs();
    let idle = false;
    const waiting = poller.waitIdle(180_000).then(() => (idle = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(idle).toBe(false);

    finish();
    await waiting;
    await approving;
    expect(idle).toBe(true);
    expect(runJob).toHaveBeenCalledTimes(1); // j2 no arrancó
    expect(authFetch).toHaveBeenCalledWith('https://api/jobs/ack', expect.anything());
    expect((await poller.approve(['j2'])).ok).toBe(false);
  });

  it('waitIdle respeta el máximo', async () => {
    vi.useFakeTimers();
    try {
      const runJob = vi.fn(() => new Promise<{ success: boolean }>(() => {}));
      const authFetch = vi.fn(async () => pollResponse([job('j1')]));
      const { poller } = makePoller({ runJob, authFetch });
      poller.start();
      toStop.push(poller);
      await poller.pollOnce();
      void poller.approve(['j1']);
      await vi.waitFor(() => expect(runJob).toHaveBeenCalled());
      let idle = false;
      const w = poller.waitIdle(180_000).then(() => (idle = true));
      await vi.advanceTimersByTimeAsync(179_000);
      expect(idle).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      await w;
      expect(idle).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
