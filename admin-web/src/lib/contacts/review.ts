import { serializeCsv } from './csv';
import { UPLOAD_ID_COLUMN } from './reserved';

// Contactos "por revisar" (link-review-contacts-to-uploads).

export type ReviewState = 'pending' | 'reassigned' | 'discarded';

export interface ReviewItem {
  agent: string;
  assignmentId: string;
  phone: string;
  row: Record<string, string> | null;
  parseError?: boolean;
  state: ReviewState;
  stateBy: string | null;
  stateAt: string | null;
  reassignUploadId: string | null;
  targetAgent: string | null;
}

export const itemKey = (i: Pick<ReviewItem, 'agent' | 'assignmentId' | 'phone'>) => `${i.agent}/${i.assignmentId}/${i.phone.replace(/\D/g, '')}`;

export const itemRef = (i: ReviewItem) => ({ agent: i.agent, assignmentId: i.assignmentId, phone: i.phone });

export function contactName(row: Record<string, string> | null): string | null {
  if (!row) return null;
  const full = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return row.name || row.contact_name || row.nombre || full || null;
}

/**
 * CSV de reasignación con las filas originales SIN `ana_upload_id`
 * (encabezado = unión de columnas en orden de aparición).
 */
export function reassignmentCsv(items: readonly ReviewItem[]): string {
  const header: string[] = [];
  for (const i of items) {
    for (const k of Object.keys(i.row ?? {})) if (k.toLowerCase() !== UPLOAD_ID_COLUMN && !header.includes(k)) header.push(k);
  }
  return serializeCsv(
    header,
    items.map((i) => header.map((h) => i.row?.[h] ?? '')),
  );
}
