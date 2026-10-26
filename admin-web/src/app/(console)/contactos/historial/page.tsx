'use client';

import { UploadHistoryView } from '@/components/contacts/UploadHistoryView';

/** Cada carga enlaza a su detalle con los contactos por revisar (v4 por srcKey). */
const detailHref = (item: { fleet: string; id: string }, campaign: string) =>
  `/contactos/historial/${encodeURIComponent(item.id)}?campaign=${encodeURIComponent(campaign)}${item.fleet === 'v4' ? '&fleet=v4' : ''}`;

export default function HistorialPage() {
  return <UploadHistoryView detailHref={detailHref} />;
}
