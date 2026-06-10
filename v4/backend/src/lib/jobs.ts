// File: Un send-job: una fila de CSV resuelta a un mensaje a enviar.
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

export const JOBS_TABLE = process.env.JOBS_TABLE!;

/** Un send-job: una fila de CSV resuelta a un mensaje a enviar. */
export interface SendJob {
  operatorId: string; // dueño — PK, aísla el pull
  jobId: string; // SK, único por job
  campaignId: string;
  campaign?: string; // nombre de campaña — PK del GSI campaign-index (sparse:
  // ausente en uploads sin campaña; un GSI no acepta '' como key)
  phone: string; // crudo, tal cual del CSV
  template: string; // plantilla con {campos}
  row: Record<string, string>; // datos de la fila
  countryCode: string;
  srcKey: string; // key del CSV en S3 (para borrarlo al terminar el archivo)
  // pending/leased = por enviar; sent/no_whatsapp/error = ya procesado (historial).
  status: 'pending' | 'leased' | 'sent' | 'no_whatsapp' | 'error';
  leaseUntil: number; // epoch ms; 0 si pending
  attempts: number;
  ttl: number; // epoch s — autolimpieza DynamoDB (historial vive 7 días)
  sentAt?: number; // epoch ms en que se procesó (para ordenar el historial)
  // true = envío directo (POST /send): el desktop lo manda sin aprobación.
  auto?: boolean;
}

export const LEASE_MS = 60_000;
export const JOB_TTL_DAYS = 7;
