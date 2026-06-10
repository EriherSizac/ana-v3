// File: Worker de envío. Corre en el main process.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

/**
 * Worker de envío. Corre en el main process.
 *
 * - Pide TODOS los jobs pendientes del operador (GET /jobs/poll).
 * - Los agrupa por archivo (srcKey) y procesa **un archivo a la vez**.
 * - Rate limit humano: máx 7 mensajes / 20 min, con ≥2 min entre cada uno.
 * - Al terminar un archivo, borra el CSV de S3 (POST /uploads/delete) y pasa
 *   al siguiente.
 * - Emite progreso para la barra (onProgress).
 */
export interface SendJob {
  jobId: string;
  campaignId: string;
  phone: string;
  template: string;
  row: Record<string, string>;
  countryCode: string;
  srcKey: string;
}

export interface Progress {
  phase: 'idle' | 'sending' | 'waiting' | 'fileDone';
  campaignId?: string;
  total?: number;
  done?: number;
  sent?: number;
  failed?: number;
  waitMs?: number; // ms restantes de espera (rate limit)
  phone?: string;
}

export interface PollerDeps {
  apiBase: string;
  getToken: () => string | null;
  runJob: (job: SendJob) => Promise<{ success: boolean; error?: string }>;
  onProgress: (p: Progress) => void;
}

const POLL_INTERVAL_MS = 5000;
const MIN_GAP_MS = 2 * 60 * 1000; // ≥2 min entre mensajes
const WINDOW_MS = 20 * 60 * 1000; // ventana de 20 min
const MAX_PER_WINDOW = 7; // máx 7 mensajes por ventana

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JobPoller {
  private running = false;
  private sentAt: number[] = []; // timestamps de envíos recientes (rate limit)

  constructor(private deps: PollerDeps) {}

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  private async loop() {
    while (this.running) {
      const token = this.deps.getToken();
      if (!token) {
        await sleep(2000);
        continue;
      }
      try {
        const jobs = await this.fetchJobs(token);
        if (jobs.length === 0) {
          this.deps.onProgress({ phase: 'idle' });
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        // Agrupa por archivo, procesa uno a la vez.
        for (const group of groupByFile(jobs)) {
          if (!this.running) break;
          await this.processFile(group, token);
        }
      } catch {
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }

  private async fetchJobs(token: string): Promise<SendJob[]> {
    const res = await fetch(`${this.deps.apiBase}/jobs/poll`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const { jobs } = (await res.json()) as { jobs: { id: string; job: SendJob }[] };
    return jobs.map((j) => j.job);
  }

  private async processFile(group: SendJob[], token: string) {
    const total = group.length;
    let done = 0;
    let sent = 0;
    let failed = 0;
    const campaignId = group[0]?.campaignId;
    const srcKey = group[0]?.srcKey;
    this.deps.onProgress({ phase: 'sending', campaignId, total, done, sent, failed });

    for (const job of group) {
      if (!this.running) return;
      await this.rateLimitWait(campaignId, total, done, sent, failed);
      if (!this.running) return;

      const r = await this.deps.runJob(job);
      this.sentAt.push(Date.now());
      done += 1;
      r.success ? (sent += 1) : (failed += 1);
      await this.ack(token, [job.jobId]);
      this.deps.onProgress({
        phase: 'sending',
        campaignId,
        total,
        done,
        sent,
        failed,
        phone: job.phone,
      });
    }

    // Archivo terminado → borra el CSV de S3.
    if (srcKey) await this.deleteFile(token, srcKey);
    this.deps.onProgress({ phase: 'fileDone', campaignId, total, done, sent, failed });
  }

  /** Respeta gap mínimo y ventana; emite countdown mientras espera. */
  private async rateLimitWait(
    campaignId: string | undefined,
    total: number,
    done: number,
    sent: number,
    failed: number,
  ) {
    for (;;) {
      const now = Date.now();
      this.sentAt = this.sentAt.filter((t) => now - t < WINDOW_MS);
      const last = this.sentAt[this.sentAt.length - 1] ?? 0;

      let waitMs = 0;
      // gap mínimo entre mensajes
      if (last) waitMs = Math.max(waitMs, MIN_GAP_MS - (now - last));
      // ventana llena → espera a que salga el más viejo
      if (this.sentAt.length >= MAX_PER_WINDOW) {
        waitMs = Math.max(waitMs, this.sentAt[0] + WINDOW_MS - now);
      }
      if (waitMs <= 0) return;

      this.deps.onProgress({ phase: 'waiting', campaignId, total, done, sent, failed, waitMs });
      await sleep(Math.min(waitMs, 1000)); // tick de 1s para refrescar countdown
      if (!this.running) return;
    }
  }

  private async ack(token: string, ids: string[]) {
    try {
      await fetch(`${this.deps.apiBase}/jobs/ack`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      /* reintenta en el próximo poll */
    }
  }

  private async deleteFile(token: string, key: string) {
    try {
      await fetch(`${this.deps.apiBase}/uploads/delete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
    } catch {
      /* no crítico */
    }
  }
}

/** Agrupa jobs por archivo (srcKey), preservando orden de aparición. */
function groupByFile(jobs: SendJob[]): SendJob[][] {
  const map = new Map<string, SendJob[]>();
  for (const j of jobs) {
    const k = j.srcKey || j.campaignId;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(j);
  }
  return [...map.values()];
}
