'use client';

import { UploadHistoryView } from '@/components/contacts/UploadHistoryView';

/** Las cargas v3 enlazan a su detalle con los contactos por revisar. */
const detailHref = (item: { fleet: string; id: string }, campaign: string) =>
  item.fleet === 'v3' ? `/contactos/historial/${encodeURIComponent(item.id)}?campaign=${encodeURIComponent(campaign)}` : null;

export default function HistorialPage() {
  return <UploadHistoryView detailHref={detailHref} />;
}
