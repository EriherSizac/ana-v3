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
    expect(onAssignment).toHaveBeenCalledWith([expect.objectContaining({ jobId: 'j1' })], {
      truncated: false,
      pendingTotal: 1,
      historyTotal: 0,
    });
  });

  it('propaga truncated/pendingTotal/historyTotal del backend', async () => {
    const body = { jobs: [{ id: 'j1', job: job('j1') }], truncated: true, pendingTotal: 3000, historyTotal: 12 };
    const { poller, onAssignment } = makePoller({
      authFetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    });
    await poller.pollOnce();
    const info = { truncated: true, pendingTotal: 3000, historyTotal: 12 };
    expect(onAssignment).toHaveBeenCalledWith([expect.objectContaining({ jobId: 'j1' })], info);
    expect(poller.getAssignmentInfo()).toEqual(info);
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

describe('JobPoller.approve (plantilla por archivo, respuesta inmediata)', () => {
  it('dos archivos → cada job con la plantilla de su archivo; responde antes del primer envío', async () => {
    vi.useFakeTimers();
    try {
      const sentWith: Record<string, string> = {};
      const runJob = vi.fn(async (j: SendJob) => {
        sentWith[j.jobId] = j.template;
        return { success: true };
      });
      const jobs = [
        job('a1', { srcKey: 'csv/a.csv', template: 'Plantilla A {nombre}' }),
        job('a2', { srcKey: 'csv/a.csv', template: 'Plantilla A {nombre}' }),
        job('b1', { srcKey: 'csv/b.csv', template: 'Plantilla B' }),
      ];
      const authFetch = vi.fn(async (url: string) =>
        url.endsWith('/jobs/poll') ? pollResponse(jobs) : new Response('{}'),
      );
      const { poller } = makePoller({ runJob, authFetch });
      poller.start();
      toStop.push(poller);
      await poller.pollOnce();

      const res = await poller.approve(['a1', 'a2', 'b1'], { 'csv/a.csv': 'Editada A' });
      expect(res).toEqual({ ok: true });
      expect(runJob).not.toHaveBeenCalled(); // respondió antes del primer envío

      // Segundo approve durante el envío.
      expect(await poller.approve(['b1'])).toEqual({ ok: false, error: 'Ya hay un envío en curso' });

      const done = poller.currentBatch();
      await vi.advanceTimersByTimeAsync(15 * 60_000); // incluye las pausas del ritmo (2 min entre envíos)
      await done;
      expect(sentWith).toEqual({ a1: 'Editada A', a2: 'Editada A', b1: 'Plantilla B' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('archivo sin mensaje → error', async () => {
    const authFetch = vi.fn(async () => pollResponse([job('x1', { template: '' })]));
    const { poller } = makePoller({ authFetch });
    await poller.pollOnce();
    expect(await poller.approve(['x1'], {})).toEqual({ ok: false, error: 'Falta el mensaje de un archivo' });
  });

  it('selección ya procesada → "Sin envíos seleccionados"', async () => {
    const authFetch = vi.fn(async () => pollResponse([job('s1', { status: 'sent' })]));
    const { poller } = makePoller({ authFetch });
    await poller.pollOnce();
    expect(await poller.approve(['s1'])).toEqual({ ok: false, error: 'Sin envíos seleccionados' });
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

describe('JobPoller: reserva y acuse (v4-review-interrupted-sends)', () => {
  const run = async (jobs: SendJob[], route: (url: string) => Response | Promise<Response>, ids: string[]) => {
    const runJob = vi.fn(async () => ({ success: true }));
    const authFetch = vi.fn(async (url: string) => (url.endsWith('/jobs/poll') ? pollResponse(jobs) : route(url)));
    const { poller } = makePoller({ runJob, authFetch });
    poller.start();
    toStop.push(poller);
    await poller.pollOnce();
    expect((await poller.approve(ids)).ok).toBe(true);
    const done = poller.currentBatch();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await done;
    return { runJob, authFetch, poller };
  };
  const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

  it('claim 409 → no llama runJob ni ack; sigue con el siguiente', async () => {
    vi.useFakeTimers();
    let claims = 0;
    try {
      const { runJob, authFetch } = await run(
        [job('j1'), job('j2')],
        (url) => {
          if (url.endsWith('/jobs/claim')) {
            claims += 1;
            const n = claims;
            return new Response(JSON.stringify(n === 1 ? { error: 'job no disponible', status: null } : { claimed: true }), {
              status: n === 1 ? 409 : 200,
            });
          }
          return new Response('{}');
        },
        ['j1', 'j2'],
      );
      expect(runJob).toHaveBeenCalledTimes(1);
      expect(runJob.mock.calls[0][0]).toMatchObject({ jobId: 'j2' });
      expect(urls(authFetch).filter((u) => u.endsWith('/jobs/ack'))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('claim con error de red → no envía', async () => {
    vi.useFakeTimers();
    try {
      const { runJob } = await run(
        [job('j1')],
        (url) => {
          if (url.endsWith('/jobs/claim')) throw new Error('ECONNRESET');
          return new Response('{}');
        },
        ['j1'],
      );
      expect(runJob).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ack falla 2 veces y luego ok → un solo runJob, 3 acks; CSV borrado', async () => {
    vi.useFakeTimers();
    try {
      let acks = 0;
      const { runJob, authFetch } = await run(
        [job('j1')],
        (url) => {
          if (url.endsWith('/jobs/ack')) {
            acks += 1;
            if (acks === 1) throw new Error('red');
            return new Response('{}', { status: acks === 2 ? 502 : 200 });
          }
          return new Response('{"claimed":true}');
        },
        ['j1'],
      );
      expect(runJob).toHaveBeenCalledTimes(1);
      expect(acks).toBe(3);
      expect(urls(authFetch)).toContain('https://api/uploads/delete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ack falla siempre → queda reservado y el CSV NO se borra', async () => {
    vi.useFakeTimers();
    try {
      const { authFetch } = await run(
        [job('j1')],
        (url) => (url.endsWith('/jobs/ack') ? new Response('', { status: 503 }) : new Response('{"claimed":true}')),
        ['j1'],
      );
      expect(urls(authFetch).filter((u) => u.endsWith('/jobs/ack'))).toHaveLength(4);
      expect(urls(authFetch)).not.toContain('https://api/uploads/delete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sending/review no son aprobables ni se envían solos', async () => {
    const authFetch = vi.fn(async () =>
      pollResponse([job('r1', { status: 'review' }), job('s1', { status: 'sending', auto: true })]),
    );
    const runJob = vi.fn(async () => ({ success: true }));
    const { poller } = makePoller({ authFetch, runJob });
    await poller.pollOnce();
    expect(await poller.approve(['r1', 's1'])).toEqual({ ok: false, error: 'Sin envíos seleccionados' });
    expect(runJob).not.toHaveBeenCalled();
  });
});
