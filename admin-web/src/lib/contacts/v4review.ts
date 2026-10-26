// Jobs v4 "por revisar" (v4-review-interrupted-sends): envíos interrumpidos
// que un supervisor descarta o reenvía desde ANA Admin.

export type V4ReviewStatus = 'review' | 'discarded';

export interface V4ReviewItem {
  operatorId: string;
  jobId: string;
  srcKey: string;
  label: string | null;
  phone: string;
  row: Record<string, string> | null;
  /** true = envío directo (`POST /send`, sin carga). */
  auto: boolean;
  claimedAt: number | null;
  reviewAt: number | null;
  status: V4ReviewStatus;
  resolution?: 'discarded' | 'requeued';
  resolvedBy?: string;
  resolvedAt?: number;
  requeuedTo?: string;
}

export interface V4ResolveResult {
  jobId: string;
  operatorId: string;
  ok: boolean;
  error?: string;
  newJobId?: string;
  to?: string;
}

export const DUPLICATE_WARNING = 'Este contacto pudo haber recibido el mensaje. Reenviarlo puede duplicarlo.';

export const v4ItemKey = (i: Pick<V4ReviewItem, 'operatorId' | 'jobId'>) => `${i.operatorId}/${i.jobId}`;

/** Teléfono enmascarado (`***` + últimos 4 dígitos). */
export function maskPhone(phone: string): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  return d.length < 4 ? '***' : `***${d.slice(-4)}`;
}

/** Crédito de la fila (mismas columnas que el desktop). */
export function creditOf(row: Record<string, string> | null): string | null {
  if (!row) return null;
  return row.credit || row.credito || row.credit_id || row.id_credito || null;
}

/** Texto del estado de un job por revisar. */
export function v4StateLabel(i: V4ReviewItem): string {
  if (i.status === 'review') return 'Por revisar';
  if (i.resolution === 'requeued') return `Reenviado a ${i.requeuedTo ?? '—'}`;
  return 'Descartado';
}

/** Aplica los resultados exitosos de una resolución a la lista local. */
export function applyResolution(
  items: readonly V4ReviewItem[],
  results: readonly V4ResolveResult[],
  action: 'discard' | 'requeue',
  by: string | null,
  now = Date.now(),
): V4ReviewItem[] {
  const ok = new Map(results.filter((r) => r.ok).map((r) => [v4ItemKey(r), r]));
  return items.map((i) => {
    const r = ok.get(v4ItemKey(i));
    if (!r) return i;
    return {
      ...i,
      status: 'discarded',
      resolution: action === 'requeue' ? 'requeued' : 'discarded',
      ...(action === 'requeue' ? { requeuedTo: r.to ?? i.operatorId } : {}),
      ...(by ? { resolvedBy: by } : {}),
      resolvedAt: now,
    };
  });
}
