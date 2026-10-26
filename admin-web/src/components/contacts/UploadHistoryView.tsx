'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, InlineMessage, PageContainer, PageHeader, SearchableSelect, Skeleton, SkeletonRows, TableContainer } from '@/components/ui';
import { useCampaigns } from '@/components/system/useCampaigns';
import { formatDate } from '@/lib/agents';
import { MODE_LABEL, REASON_LABEL, STATUS_LABEL, type UploadHistoryItem, type UploadStatus } from '@/lib/contacts/history';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';

const FLEET_OPTIONS = [
  { value: 'v3', label: 'v3 (CLI)' },
  { value: 'v4', label: 'v4 (desktop)' },
];

const STATUS_VARIANT: Record<UploadStatus, 'success' | 'error' | 'default'> = {
  completed: 'success',
  processed: 'success',
  failed: 'error',
  rejected: 'error',
};

export interface UploadHistoryViewProps {
  /** Enlace opcional al detalle de una carga v3 (link-review-contacts-to-uploads). */
  detailHref?: (item: UploadHistoryItem, campaign: string) => string | null;
}

export function UploadHistoryView({ detailHref }: UploadHistoryViewProps = {}) {
  const { campaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns();
  const [campaign, setCampaign] = useState<string | null>(null);
  const [fleet, setFleet] = useState<'v3' | 'v4'>('v3');
  const [items, setItems] = useState<UploadHistoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaign) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: UploadHistoryItem[] }>(`/api/campaigns/${encodeURIComponent(campaign)}/uploads?fleet=${fleet}`);
      setItems(res.items);
    } catch (e) {
      if (isRedirecting(e)) return;
      setItems(null);
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, [campaign, fleet]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title="Historial de cargas"
        description="Cargas de contactos más recientes por campaña y flota."
        actions={
          <>
            <Link
              href="/contactos"
              className="inline-flex h-10 items-center rounded-xl border border-neutral-60 bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              Nueva carga
            </Link>
            <Button variant="outline" onClick={() => void load()} disabled={!campaign || loading}>
              Actualizar
            </Button>
          </>
        }
      />
      <div className="pernexium-card mb-4 grid gap-4 p-4 md:grid-cols-3">
        {campaignsLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <SearchableSelect label="Campaña" options={campaigns.map((c) => ({ value: c, label: c }))} value={campaign} onChange={setCampaign} />
        )}
        <SearchableSelect label="Flota" options={FLEET_OPTIONS} value={fleet} onChange={(v) => setFleet(v as 'v3' | 'v4')} />
      </div>
      {campaign && fleet === 'v3' && (
        <p className="mb-3 text-sm">
          <Link
            href={`/contactos/historial/none?campaign=${encodeURIComponent(campaign)}`}
            className="font-semibold text-primary underline"
          >
            Por revisar sin carga asociada
          </Link>
        </p>
      )}
      {campaignsError && <InlineMessage className="mb-3">{campaignsError}</InlineMessage>}
      {error && <InlineMessage className="mb-3">{error}</InlineMessage>}

      <div className="pernexium-card p-4">
        {!campaign ? (
          <p className="text-sm text-text-light">Elige una campaña para ver su historial.</p>
        ) : loading && !items ? (
          <SkeletonRows rows={6} cols={6} />
        ) : items && items.length === 0 ? (
          <p className="text-sm text-text-light">Sin cargas registradas.</p>
        ) : (
          <TableContainer>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                <tr>
                  <th className="px-3 py-3">Fecha</th>
                  <th className="px-3 py-3">Autor</th>
                  <th className="px-3 py-3">Archivo</th>
                  <th className="px-3 py-3">Modo</th>
                  <th className="px-3 py-3">Filas</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3">Por agente</th>
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((it) => {
                  const href = detailHref && campaign ? detailHref(it, campaign) : null;
                  return (
                    <tr key={`${it.fleet}-${it.id}`} className="border-t border-neutral-40 align-top" data-testid={`upload-${it.id}`}>
                      <td className="px-3 py-3 whitespace-nowrap">{formatDate(it.uploadedAt)}</td>
                      <td className="px-3 py-3 font-mono text-xs">{it.uploadedBy ?? '—'}</td>
                      <td className="px-3 py-3">
                        {href ? (
                          <Link href={href} className="font-semibold text-primary underline">
                            {it.fileName || it.id}
                          </Link>
                        ) : (
                          it.fileName || it.id
                        )}
                      </td>
                      <td className="px-3 py-3">{it.mode ? (MODE_LABEL[it.mode] ?? it.mode) : '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {it.validRows ?? '—'} / {it.totalRows ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={STATUS_VARIANT[it.status]}>{STATUS_LABEL[it.status]}</Badge>
                        {it.reason && <span className="mt-1 block text-xs text-text-light">{REASON_LABEL[it.reason] ?? it.reason}</span>}
                      </td>
                      <td className="px-3 py-3">
                        <ul className="text-xs">
                          {it.perAgent.map((p) => (
                            <li key={p.agent}>
                              <span className="font-mono">{p.agent}</span>: {p.rows}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableContainer>
        )}
      </div>
    </PageContainer>
  );
}
