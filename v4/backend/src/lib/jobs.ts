// File: Un send-job: una fila de CSV resuelta a un mensaje a enviar.
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

export const JOBS_TABLE = process.env.JOBS_TABLE!;

/**
 * Índice por campaña (v4-harden-send-job-queue D1). Configurable para el
 * despliegue en pasos: `campaign-index` (viejo) → `campaign-status-index`.
 */
export const jobsCampaignIndex = () => process.env.JOBS_CAMPAIGN_INDEX || 'campaign-index';

/**
 * Estados de un job. `leased` es heredado (nada lo asigna) y cuenta como pendiente.
 * `sending` = reservado por el desktop justo antes de enviar; `review` = envío
 * interrumpido (por revisar); `discarded` = resuelto por un supervisor
 * (v4-review-interrupted-sends).
 */
export type JobStatus =
  | 'pending'
  | 'leased'
  | 'sending'
  | 'sent'
  | 'no_whatsapp'
  | 'error'
  | 'review'
  | 'discarded';
/** Resultados que acepta el acuse. */
export type FinalStatus = 'sent' | 'no_whatsapp' | 'error';
export const FINAL_STATUSES: readonly FinalStatus[] = ['sent', 'no_whatsapp', 'error'];

/** Un `sending` con `claimedAt` de hace MÁS de esto pasa a `review` (design D2). */
export const REVIEW_AFTER_MS = 10 * 60 * 1000;

/** ¿Por enviar? `pending`, sin estado o `leased` heredado. */
export const isPendingStatus = (s: unknown): boolean =>
  s === undefined || s === null || s === 'pending' || s === 'leased';

/** ¿Resultado de un acuse (sent/no_whatsapp/error)? */
export const isFinalStatus = (s: unknown): s is FinalStatus =>
  (FINAL_STATUSES as readonly unknown[]).includes(s);

export type JobClass = 'pending' | 'sending' | 'review' | 'final';

/**
 * Clasificación pura de un job a la hora `now`:
 *  - pending: por enviar (pending, sin estado o leased).
 *  - sending: reservado hace ≤ 10 min (en envío).
 *  - review: `review`, o `sending` reservado hace más de 10 min (debe pasar a review).
 *  - final: sent/no_whatsapp/error/discarded (historial).
 */
export function classify(job: { status?: unknown; claimedAt?: unknown }, now: number): JobClass {
  const s = job.status;
  if (isPendingStatus(s)) return 'pending';
  if (s === 'review') return 'review';
  if (s === 'sending') return isReviewDue(job, now) ? 'review' : 'sending';
  return 'final';
}

/** ¿Un `sending` venció y debe pasar a `review`? (estrictamente más de 10 min). */
export function isReviewDue(job: { status?: unknown; claimedAt?: unknown }, now: number): boolean {
  if (job.status !== 'sending') return false;
  const at = typeof job.claimedAt === 'number' ? job.claimedAt : 0;
  return now - at > REVIEW_AFTER_MS;
}

/** Un send-job: una fila de CSV resuelta a un mensaje a enviar. */
export interface SendJob {
  operatorId: string; // dueño — PK, aísla el pull
  jobId: string; // SK, único por job: `<campaignId>#<índice>`
  // Identificador de la carga: generado por el servidor (key del CSV sin
  // `csv-uploads/`) o `direct-<campaña>` en envíos directos.
  campaignId: string;
  label?: string; // identificador que eligió el cliente (`<archivo>-<lada>`)
  campaign?: string; // nombre de campaña — PK del GSI por campaña (sparse:
  // ausente en uploads sin campaña; un GSI no acepta '' como key)
  phone: string; // crudo, tal cual del CSV
  template: string; // plantilla con {campos}
  row: Record<string, string>; // datos de la fila
  countryCode: string;
  srcKey: string; // key del CSV en S3 (referencia de la carga)
  // pending (o leased heredado) = por enviar; sent/no_whatsapp/error = historial.
  status: JobStatus;
  /** Heredado: jobs viejos pueden traerlo; los nuevos no lo escriben. */
  leaseUntil?: number;
  attempts: number;
  ttl: number; // epoch s — autolimpieza DynamoDB (historial vive 7 días)
  sentAt?: number; // epoch ms en que se procesó (para ordenar el historial)
  // true = envío directo (POST /send): el desktop lo manda sin aprobación.
  auto?: boolean;
  // --- Reserva y revisión (v4-review-interrupted-sends) ---
  claimedAt?: number; // epoch ms de la reserva (POST /jobs/claim)
  reviewReason?: 'interrupted';
  reviewAt?: number; // epoch ms del paso a review
  resolution?: 'discarded' | 'requeued';
  resolvedBy?: string;
  resolvedAt?: number;
  requeuedTo?: string; // operatorId destino del reencolado
  requeuedFrom?: string; // `<operatorId>/<jobId>` del original (en el job nuevo)
}

export const JOB_TTL_DAYS = 7;
