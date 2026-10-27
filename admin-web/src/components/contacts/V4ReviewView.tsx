'use client';

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  InlineMessage,
  PageContainer,
  PageHeader,
  SearchableSelect,
  SkeletonRows,
  TableContainer,
} from '@/components/ui';
import { AccessContext } from '@/components/system/AccessContext';
import { StaleNotice } from '@/components/system/Realtime';
import { useRealtimeRefresh } from '@/lib/realtime/RealtimeProvider';
import { formatDate } from '@/lib/agents';
import { contactName } from '@/lib/contacts';
import type { UploadHistoryItem } from '@/lib/contacts/history';
import {
  applyResolution,
  creditOf,
  DUPLICATE_WARNING,
  maskPhone,
  v4ItemKey,
  v4StateLabel,
  type V4ResolveResult,
  type V4ReviewItem,
} from '@/lib/contacts/v4review';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';

const enc = encodeURIComponent;

function StateCell({ item }: { item: V4ReviewItem }) {
  if (item.status === 'review') return <Badge variant="error">Por revisar</Badge>;
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant={item.resolution === 'requeued' ? 'success' : 'muted'}>{v4StateLabel(item)}</Badge>
      <span className="text-2xs text-text-light">
        {item.resolvedBy ?? '—'} · {formatDate(item.resolvedAt ?? null)}
      </span>
    </div>
  );
}

interface RequeueState {
  agent: string | null;
  confirm: boolean;
  error: string | null;
}

/**
 * Jobs v4 por revisar (envíos interrumpidos) de una carga (`srcKey`) o de
 * toda la campaña (`srcKey = null`, incluye envíos directos), con "Descartar"
 * y "Reenviar a…" (v4-review-interrupted-sends).
 */
export function V4ReviewView({ campaign, srcKey }: { campaign: string; srcKey: string | null }) {
  const me = useContext(AccessContext);
  const [upload, setUpload] = useState<UploadHistoryItem | null | undefined>(srcKey ? undefined : null);
  const [items, setItems] = useState<V4ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [rq, setRq] = useState<RequeueState | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [hist, review] = await Promise.all([
        srcKey
          ? apiFetch<{ items: UploadHistoryItem[] }>(`/api/campaigns/${enc(campaign)}/uploads?fleet=v4&srcKey=${enc(srcKey)}`)
          : Promise.resolve(null),
        apiFetch<{ items: V4ReviewItem[] }>(`/api/v4/campaigns/${enc(campaign)}/review${srcKey ? `?srcKey=${enc(srcKey)}` : ''}`),
      ]);
      if (srcKey) setUpload(hist?.items.find((i) => i.id === srcKey) ?? null);
      setItems(review.items);
    } catch (e) {
      if (isRedirecting(e)) return;
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar la revisión.');
    }
  }, [campaign, srcKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const agents = useMemo(() => {
    const names: string[] = [];
    for (const i of items ?? []) if (!names.includes(i.operatorId)) names.push(i.operatorId);
    return names;
  }, [items]);

  const selectedItems = (items ?? []).filter((i) => selected.includes(v4ItemKey(i)));
  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const resolve = async (action: 'discard' | 'requeue', to?: string): Promise<boolean> => {
    setBusy(true);
    setActionMsg(null);
    const target = selectedItems;
    try {
      const res = await apiFetch<{ results: V4ResolveResult[] }>(`/api/v4/campaigns/${enc(campaign)}/review/resolve`, {
        method: 'POST',
        json: { action, items: target.map((i) => ({ operatorId: i.operatorId, jobId: i.jobId })), ...(to ? { to } : {}) },
      });
      setItems((cur) => applyResolution(cur ?? [], res.results, action, me?.username ?? null));
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setActionMsg(`${failed.length} contacto(s) no se pudieron resolver: ${failed[0]!.error ?? 'error'}. Recarga para ver su estado.`);
      }
      setSelected([]);
      return true;
    } catch (e) {
      if (isRedirecting(e)) return false;
      setActionMsg(e instanceof ApiError ? e.message : 'No se pudo completar la acción.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openRequeue = async () => {
    setActionMsg(null);
    setRq({ agent: null, confirm: false, error: null });
    try {
      const r = await apiFetch<{ agents: string[] }>(`/api/campaigns/${enc(campaign)}/enabled-agents?fleet=v4`);
      setEnabled(r.agents);
    } catch (e) {
      if (isRedirecting(e)) return;
      setRq((s) => (s ? { ...s, error: e instanceof ApiError ? e.message : 'No se pudo leer el roster.' } : s));
    }
  };

  const title = srcKey ? `Carga ${upload?.fileName || srcKey.split('/').pop()}` : 'Por revisar (v4)';

  // Recarga en vivo (add-realtime-admin-web); con selección o diálogo abierto → aviso.
  const live = useRealtimeRefresh({
    types: ['review.changed'],
    campaign,
    reload: load,
    isDirty: () => selected.length > 0 || discardOpen || rq !== null || busy,
  });

  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={
          srcKey
            ? `Envíos interrumpidos de la carga en ${campaign} (v4).`
            : `Envíos interrumpidos de ${campaign} en v4, incluidos los envíos directos.`
        }
        actions={
          <Link
            href="/contactos/historial"
            className="inline-flex h-10 items-center rounded-xl border border-neutral-60 bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Historial
          </Link>
        }
      />
      <StaleNotice stale={live.stale} onRefresh={live.refresh} />
      {error && <InlineMessage className="mb-3">{error}</InlineMessage>}
      {actionMsg && <InlineMessage className="mb-3">{actionMsg}</InlineMessage>}
      {srcKey && upload === null && <InlineMessage className="mb-3">Carga no encontrada en el historial v4.</InlineMessage>}
      {upload && (
        <div className="pernexium-card mb-4 flex flex-wrap gap-4 p-4 text-sm text-text-muted">
          <span>
            Autor: <span className="font-mono">{upload.uploadedBy ?? '—'}</span>
          </span>
          <span>Fecha: {formatDate(upload.uploadedAt)}</span>
          <span>Filas: {upload.totalRows ?? '—'}</span>
        </div>
      )}

      {selected.length > 0 && (
        <div className="sticky top-20 z-20 mb-3 flex flex-col gap-3 rounded-2xl bg-primary px-5 py-3 text-primary-foreground shadow-card sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-semibold">{selected.length} seleccionados</span>
          <div className="flex gap-2">
            <Button variant="inverse" size="sm" onClick={() => void openRequeue()}>
              Reenviar a…
            </Button>
            <Button variant="inverse" size="sm" onClick={() => setDiscardOpen(true)}>
              Descartar
            </Button>
            <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-white/15" onClick={() => setSelected([])}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {items === null && !error ? (
        <div className="pernexium-card p-4">
          <SkeletonRows rows={4} cols={5} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {agents.length === 0 && <div className="pernexium-card p-4 text-sm text-text-light">Sin contactos por revisar</div>}
          {agents.map((agent) => {
            const mine = (items ?? []).filter((i) => i.operatorId === agent);
            return (
              <section key={agent} className="pernexium-card p-4" aria-labelledby={`v4-agent-${agent}`} data-testid={`v4-review-agent-${agent}`}>
                <h2 id={`v4-agent-${agent}`} className="mb-2 text-base font-semibold">
                  <span className="font-mono">{agent}</span>
                  <span className="ml-2 text-xs font-normal text-text-light">Por revisar</span>
                </h2>
                <TableContainer>
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                      <tr>
                        <th className="w-10 px-3 py-2">
                          <span className="sr-only">Seleccionar</span>
                        </th>
                        <th className="px-3 py-2">Nombre</th>
                        <th className="px-3 py-2">Crédito</th>
                        <th className="px-3 py-2">Teléfono</th>
                        <th className="px-3 py-2">Interrumpido</th>
                        <th className="px-3 py-2">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mine.map((i) => {
                        const k = v4ItemKey(i);
                        const masked = maskPhone(i.phone);
                        return (
                          <tr key={k} className="border-t border-neutral-40 align-top" data-testid={`v4-review-${i.jobId}`}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label={`Seleccionar ${contactName(i.row) ?? masked}`}
                                disabled={i.status !== 'review'}
                                checked={selected.includes(k)}
                                onChange={() => toggle(k)}
                                className="h-4 w-4 accent-primary"
                              />
                            </td>
                            <td className="px-3 py-2">
                              {contactName(i.row) ?? '—'}
                              {(i.auto || !i.srcKey) && (
                                <Badge variant="outline" className="ml-2">
                                  Envío directo
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{creditOf(i.row) ?? '—'}</td>
                            <td className="px-3 py-2 font-mono text-xs">{masked}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{formatDate(i.reviewAt)}</td>
                            <td className="px-3 py-2">
                              <StateCell item={i} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableContainer>
              </section>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={discardOpen}
        title={`Descartar ${selected.length} contacto(s)`}
        description="Los contactos quedan como descartados y no se vuelven a enviar."
        destructive
        confirmLabel="Descartar"
        loading={busy}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={async () => {
          await resolve('discard');
          setDiscardOpen(false);
        }}
      />

      {rq && !rq.confirm && (
        <Dialog open title={`Reenviar ${selectedItems.length} contacto(s)`} onClose={() => setRq(null)} size="lg">
          <div className="flex flex-col gap-4">
            <SearchableSelect
              label="Agente destino (habilitado en v4)"
              options={enabled.map((a) => ({ value: a, label: a }))}
              value={rq.agent}
              onChange={(a) => setRq({ ...rq, agent: a })}
            />
            {rq.error && <InlineMessage>{rq.error}</InlineMessage>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setRq(null)}>
                Cancelar
              </Button>
              <Button onClick={() => setRq({ ...rq, confirm: true })} disabled={!rq.agent}>
                Reenviar
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {rq?.confirm && rq.agent && (
        <ConfirmDialog
          open
          title={`Reenviar a ${rq.agent}`}
          description={DUPLICATE_WARNING}
          confirmLabel="Reenviar"
          loading={busy}
          onCancel={() => setRq({ ...rq, confirm: false })}
          onConfirm={async () => {
            if (await resolve('requeue', rq.agent!)) setRq(null);
            else setRq({ ...rq, confirm: false });
          }}
        />
      )}
    </PageContainer>
  );
}
