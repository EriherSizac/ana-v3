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

/** Estados de un job. `leased` es heredado (nada lo asigna) y cuenta como pendiente. */
export type JobStatus = 'pending' | 'leased' | 'sent' | 'no_whatsapp' | 'error';
export type FinalStatus = 'sent' | 'no_whatsapp' | 'error';
export const FINAL_STATUSES: readonly FinalStatus[] = ['sent', 'no_whatsapp', 'error'];

/** ¿Por enviar? `pending`, sin estado o `leased` heredado. */
export const isPendingStatus = (s: unknown): boolean =>
  s === undefined || s === null || s === 'pending' || s === 'leased';

/** ¿Estado final (historial)? */
export const isFinalStatus = (s: unknown): s is FinalStatus =>
  (FINAL_STATUSES as readonly unknown[]).includes(s);

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
}

export const JOB_TTL_DAYS = 7;
