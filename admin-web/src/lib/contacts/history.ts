// Historial de cargas normalizado para ambas flotas (BFF → UI).

export type UploadStatus = 'completed' | 'failed' | 'processed' | 'rejected';

export interface UploadHistoryItem {
  fleet: 'v3' | 'v4';
  /** v3: uploadId; v4: srcKey. */
  id: string;
  fileName: string;
  uploadedBy: string | null;
  uploadedAt: string | null;
  mode: string | null;
  totalRows: number | null;
  validRows: number | null;
  status: UploadStatus;
  reason: string | null;
  perAgent: Array<{ agent: string; rows: number }>;
  source?: unknown;
}

export const STATUS_LABEL: Record<UploadStatus, string> = {
  completed: 'Completada',
  failed: 'Fallida',
  processed: 'Procesada',
  rejected: 'Rechazada',
};

export const REASON_LABEL: Record<string, string> = {
  too_large: 'Archivo mayor a 10 MB',
  too_many_rows: 'Más de 50 000 filas',
  missing_operator: 'Sin operador en la metadata',
};

export const MODE_LABEL: Record<string, string> = {
  distribute: 'Repartir',
  single: 'Asignar a un agente',
  assignments: 'Reparto explícito',
  self: 'Propio',
};
