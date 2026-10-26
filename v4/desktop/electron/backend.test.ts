import { describe, it, expect, vi, afterEach } from 'vitest';
import { Backend, REPORT_RETRY_DELAYS_MS } from './backend';

const report = { jobId: 'j1', campaign: 'bancoppel', phone: '5512345678', status: 'sent' as const, row: {} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.useRealTimers());

function make(responses: (Response | Error)[]) {
  const authFetch = vi.fn(async () => {
    const r = responses.shift() ?? json({ reported: true });
    if (r instanceof Error) throw r;
    return r;
  });
  return { backend: new Backend('https://api', () => true, authFetch), authFetch };
}

describe('Backend.reportInteraction (reintentos)', () => {
  it('retryable → reintenta a los 30 s y para al registrar', async () => {
    vi.useFakeTimers();
    const { backend, authFetch } = make([json({ reported: false, retryable: true }), json({ reported: true })]);
    await backend.reportInteraction(report); // no espera los reintentos
    expect(authFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REPORT_RETRY_DELAYS_MS[0]);
    expect(authFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(authFetch).toHaveBeenCalledTimes(2);
  });

  it('"ya reportado" → no reintenta', async () => {
    vi.useFakeTimers();
    const { backend, authFetch } = make([json({ reported: false, reason: 'ya reportado' })]);
    await backend.reportInteraction(report);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('5xx y red → máximo 3 reintentos (30 s, 2 min, 10 min)', async () => {
    vi.useFakeTimers();
    const { backend, authFetch } = make([
      json({}, 502),
      new Error('ECONNRESET'),
      json({ reported: false, retryable: true }),
      json({}, 500),
      json({}, 500),
    ]);
    await backend.reportInteraction(report);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(authFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(authFetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(authFetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(authFetch).toHaveBeenCalledTimes(4); // 1 + 3 reintentos
  });

  it('4xx → no reintenta', async () => {
    vi.useFakeTimers();
    const { backend, authFetch } = make([json({ error: 'faltan jobId/phone/status' }, 400)]);
    await backend.reportInteraction(report);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
});
