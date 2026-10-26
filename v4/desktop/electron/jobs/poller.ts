// File: Worker de envío. Corre en el main process.
// Created: 2026-06-10
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { AuthFetch } from '../auth/tokenBroker';

/**
 * Worker de envío. Corre en el main process.
 *
 * Flujo con aprobación (como la asignación de v3): el poller consulta los jobs
 * pendientes del operador (~5s) y los PUBLICA al renderer (onAssignment); NO
 * envía nada hasta que el agente aprueba una selección (approve), opcionalmente
 * con otra plantilla. Lo no aprobado queda pendiente en el backend y reaparece
 * en el siguiente poll.
 *
 * Al enviar: agrupa por archivo (srcKey), un archivo a la vez, rate limit
 * humano (máx 7 mensajes / 20 min, ≥2 min entre cada uno) y ack por job.
 * El CSV de S3 se borra solo cuando ya no quedan jobs de ese archivo.
 *
 * Todas las llamadas usan `authFetch` (token fresco + reintento ante 401). Un
 * 401/no-2xx/red al consultar NO publica una asignación vacía: se conserva la
 * última publicada hasta la siguiente consulta exitosa.
 */
export interface SendJob {
  jobId: string;
  campaignId: string;
  campaign?: string; // nombre de campaña del CRM (para registrar interacciones)
  phone: string;
  template: string;
  row: Record<string, string>;
  countryCode: string;
  srcKey: string;
  // pending/leased = por enviar; sent/no_whatsapp/error = historial.
  status?: 'pending' | 'leased' | 'sent' | 'no_whatsapp' | 'error';
  sentAt?: number;
  // true = envío directo (POST /send del backend): se manda sin aprobación.
  auto?: boolean;
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
  /** ¿Hay sesión? (token presente, sin renovar). */
  hasSession: () => boolean;
  authFetch: AuthFetch;
  runJob: (job: SendJob) => Promise<{ success: boolean; error?: string; noWhatsapp?: boolean }>;
  onProgress: (p: Progress) => void;
  /** Jobs del operador (pendientes + historial). El renderer los separa. */
  onAssignment: (jobs: SendJob[]) => void;
}

const POLL_INTERVAL_MS = 5000;
const MIN_GAP_MS = 2 * 60 * 1000; // ≥2 min entre mensajes
const WINDOW_MS = 20 * 60 * 1000; // ventana de 20 min
const MAX_PER_WINDOW = 7; // máx 7 mensajes por ventana

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isPending = (j: SendJob) => !j.status || j.status === 'pending' || j.status === 'leased';

export class JobPoller {
  private running = false;
  private sending = false;
  private paused = false; // actualización pendiente: no iniciar jobs nuevos
  private current: Promise<unknown> | null = null; // job en curso (runJob + ack)
  private sentAt: number[] = []; // timestamps de envíos recientes (rate limit)
  private known = new Map<string, SendJob>(); // jobId → job (último poll)
  private lastAssignment: SendJob[] = []; // última asignación manual publicada

  constructor(private deps: PollerDeps) {}

  /** Asignación manual vigente (para hidratar la vista al montarse). */
  getAssignment(): SendJob[] {
    return this.lastAssignment;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  /** Deja de iniciar jobs (el que esté en curso termina con su ack). */
  pauseNewJobs() {
    this.paused = true;
  }

  /** ¿Hay un job enviándose ahora mismo? */
  hasJobInFlight(): boolean {
    return this.current !== null;
  }

  /** Resuelve cuando termina el job en curso (o de inmediato), máximo `timeoutMs`. */
  async waitIdle(timeoutMs: number): Promise<void> {
    const c = this.current;
    if (!c) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      c.catch(() => undefined),
      new Promise<void>((r) => (timer = setTimeout(r, timeoutMs))),
    ]);
    if (timer) clearTimeout(timer);
  }

  /**
   * Envía los jobs seleccionados (en orden de asignación), opcionalmente con
   * una plantilla distinta a la del upload. Los no seleccionados no se tocan.
   */
  async approve(
    jobIds: string[],
    templateOverride?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.paused) return { ok: false, error: 'Actualización pendiente: no se inician envíos' };
    if (this.sending) return { ok: false, error: 'Ya hay un envío en curso' };
    if (!this.deps.hasSession()) return { ok: false, error: 'Sin sesión' };

    const wanted = new Set(jobIds);
    // Solo lo que sigue pendiente (nunca reenvía algo ya procesado).
    const selected = [...this.known.values()].filter((j) => wanted.has(j.jobId) && isPending(j));
    if (selected.length === 0) return { ok: false, error: 'Sin envíos seleccionados' };

    this.sending = true;
    try {
      for (const group of groupByFile(selected)) {
        if (!this.running || this.paused) break;
        await this.processFile(group, templateOverride);
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    } finally {
      this.sending = false;
    }
  }

  private async loop() {
    while (this.running) {
      if (!this.deps.hasSession() || this.sending) {
        await sleep(2000);
        continue;
      }
      await this.pollOnce();
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /** Un ciclo: consulta, publica (solo si la consulta fue exitosa) y envía directos. */
  async pollOnce(): Promise<void> {
    try {
      const jobs = await this.fetchJobs();
      if (jobs === null) return; // 401/no-2xx/red: conserva la última asignación
      this.known = new Map(jobs.map((j) => [j.jobId, j]));

      // Publica TODO (pendientes + historial): el renderer los separa en tabs.
      this.lastAssignment = jobs;
      this.deps.onAssignment(jobs);
      if (jobs.length === 0) this.deps.onProgress({ phase: 'idle' });

      // Directos (POST /send) AÚN pendientes: se envían solos, sin aprobación.
      const autos = jobs.filter((j) => j.auto && isPending(j));
      if (autos.length > 0 && !this.paused) {
        this.sending = true;
        try {
          for (const group of groupByFile(autos)) {
            if (!this.running || this.paused) break;
            await this.processFile(group);
          }
        } finally {
          this.sending = false;
        }
      }
    } catch {
      /* red caída: reintenta en el próximo poll */
    }
  }

  /** Jobs del operador o null si la consulta no fue exitosa (no publicar). */
  private async fetchJobs(): Promise<SendJob[] | null> {
    try {
      // authFetch ya invalida el token y reintenta una vez ante 401.
      const res = await this.deps.authFetch(`${this.deps.apiBase}/jobs/poll`);
      if (!res.ok) return null;
      const { jobs } = (await res.json()) as { jobs: { id: string; job: SendJob }[] };
      return jobs.map((j) => j.job);
    } catch {
      return null;
    }
  }

  private async processFile(group: SendJob[], templateOverride?: string) {
    const total = group.length;
    let done = 0;
    let sent = 0;
    let failed = 0;
    const campaignId = group[0]?.campaignId;
    const srcKey = group[0]?.srcKey;
    this.deps.onProgress({ phase: 'sending', campaignId, total, done, sent, failed });

    for (const job of group) {
      if (!this.running || this.paused) return;
      await this.rateLimitWait(campaignId, total, done, sent, failed);
      if (!this.running || this.paused) return;

      const effective = templateOverride ? { ...job, template: templateOverride } : job;
      const work = (async () => {
        const r = await this.deps.runJob(effective);
        this.sentAt.push(Date.now());
        // Marca el job (no lo borra): queda en el historial con su resultado.
        const status = r.success ? 'sent' : r.noWhatsapp ? 'no_whatsapp' : 'error';
        await this.ack([{ jobId: job.jobId, status }]);
        return { r, status } as const;
      })();
      this.current = work;
      let outcome: Awaited<typeof work>;
      try {
        outcome = await work;
      } finally {
        this.current = null;
      }
      done += 1;
      outcome.r.success ? (sent += 1) : (failed += 1);
      // Refleja el nuevo estado en memoria (para la próxima publicación).
      const k = this.known.get(job.jobId);
      if (k) k.status = outcome.status;
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

    // Borra el CSV de S3 solo si ya no quedan jobs PENDIENTES de ese archivo.
    const remaining = [...this.known.values()].some((j) => j.srcKey === srcKey && isPending(j));
    if (srcKey && !remaining) await this.deleteFile(srcKey);
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
      if (!this.running || this.paused) return;
    }
  }

  private async ack(acks: { jobId: string; status: string }[]) {
    try {
      await this.deps.authFetch(`${this.deps.apiBase}/jobs/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acks }),
      });
    } catch {
      /* reintenta en el próximo poll */
    }
  }

  private async deleteFile(key: string) {
    try {
      await this.deps.authFetch(`${this.deps.apiBase}/uploads/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
