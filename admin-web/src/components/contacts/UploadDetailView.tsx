'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { formatDate } from '@/lib/agents';
import {
  buildPlan,
  contactName,
  detectPhoneColumn,
  itemKey,
  itemRef,
  parseCsvText,
  planHash,
  reassignmentCsv,
  validateRows,
  type ParsedCsv,
  type Plan,
  type ReviewItem,
} from '@/lib/contacts';
import { StaleNotice } from '@/components/system/Realtime';
import { useRealtimeRefresh } from '@/lib/realtime/RealtimeProvider';
import type { UploadHistoryItem } from '@/lib/contacts/history';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';

const detailHref = (uploadId: string, campaign: string) => `/contactos/historial/${encodeURIComponent(uploadId)}?campaign=${encodeURIComponent(campaign)}`;

function StateCell({ item, campaign }: { item: ReviewItem; campaign: string }) {
  if (item.parseError) return <Badge variant="muted">Fila ilegible</Badge>;
  if (item.state === 'pending') return <Badge variant="default">Pendiente de revisión</Badge>;
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant={item.state === 'reassigned' ? 'success' : 'muted'}>
        {item.state === 'reassigned' ? `Reasignado a ${item.targetAgent ?? '—'}` : 'Descartado'}
      </Badge>
      <span className="text-2xs text-text-light">
        {item.stateBy ?? '—'} · {formatDate(item.stateAt)}
      </span>
      {item.state === 'reassigned' && item.reassignUploadId && (
        <Link href={detailHref(item.reassignUploadId, campaign)} className="text-2xs font-semibold text-primary underline">
          Ver carga {item.reassignUploadId}
        </Link>
      )}
    </div>
  );
}

interface ReassignState {
  items: ReviewItem[];
  agent: string | null;
  preview: { plan: Plan; hash: string; parsed: ParsedCsv; csv: string; rows: number } | null;
  error: string | null;
  confirm: boolean;
  sending: boolean;
  /** Carga entregada pero sin marcar (reintento solo del marcado). */
  pendingMark: string | null;
}

/**
 * Detalle de una carga v3 con sus contactos "por revisar" (o `uploadId=none`:
 * filas sin carga asociada), con descarte y reasignación.
 */
export function UploadDetailView({ uploadId, campaign }: { uploadId: string; campaign: string }) {
  const isNone = uploadId === 'none';
  const [upload, setUpload] = useState<UploadHistoryItem | null | undefined>(isNone ? null : undefined);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [re, setRe] = useState<ReassignState | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [hist, review] = await Promise.all([
        isNone ? Promise.resolve(null) : apiFetch<{ items: UploadHistoryItem[] }>(`/api/campaigns/${encodeURIComponent(campaign)}/uploads?fleet=v3`),
        apiFetch<{ items: ReviewItem[] }>(`/api/campaigns/${encodeURIComponent(campaign)}/review-items?uploadId=${encodeURIComponent(uploadId)}`),
      ]);
      if (!isNone) setUpload(hist?.items.find((i) => i.id === uploadId) ?? null);
      setItems(review.items);
    } catch (e) {
      if (isRedirecting(e)) return;
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar el detalle.');
    }
  }, [campaign, uploadId, isNone]);

  useEffect(() => {
    void load();
  }, [load]);

  const agents = useMemo(() => {
    const names = [...(upload?.perAgent ?? []).map((p) => p.agent)];
    for (const i of items ?? []) if (!names.includes(i.agent)) names.push(i.agent);
    return names;
  }, [upload, items]);

  const selectedItems = (items ?? []).filter((i) => selected.includes(itemKey(i)));
  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const mergeItems = (updated: ReviewItem[]) =>
    setItems((cur) => (cur ?? []).map((i) => updated.find((u) => itemKey(u) === itemKey(i)) ?? i));

  const discard = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ items: ReviewItem[] }>(`/api/campaigns/${encodeURIComponent(campaign)}/review-items/resolve`, {
        method: 'POST',
        json: { action: 'discard', items: selectedItems.map(itemRef) },
      });
      mergeItems(res.items);
      setSelected([]);
    } catch (e) {
      if (isRedirecting(e)) return;
      setActionError(e instanceof ApiError ? e.message : 'No se pudo descartar.');
    } finally {
      setBusy(false);
      setDiscardOpen(false);
    }
  };

  const openReassign = async () => {
    setActionError(null);
    setRe({ items: selectedItems, agent: null, preview: null, error: null, confirm: false, sending: false, pendingMark: null });
    try {
      const r = await apiFetch<{ agents: string[] }>(`/api/campaigns/${encodeURIComponent(campaign)}/enabled-agents?fleet=v3`);
      setEnabled(r.agents);
    } catch (e) {
      if (isRedirecting(e)) return;
      setRe((s) => (s ? { ...s, error: e instanceof ApiError ? e.message : 'No se pudo leer el roster.' } : s));
    }
  };

  const reassignCsv = useMemo(() => (re ? reassignmentCsv(re.items) : ''), [re]);

  const makePreview = async () => {
    if (!re || !re.agent) return;
    const parsed = parseCsvText(reassignCsv, 'v3');
    if ('error' in parsed) return setRe({ ...re, error: parsed.error });
    const phone = detectPhoneColumn(parsed.header, 'v3');
    if ('error' in phone) return setRe({ ...re, error: phone.error });
    const { valid } = validateRows(parsed, 'v3', phone.column);
    const plan = buildPlan({ fleet: 'v3', mode: 'single', enabled, agent: re.agent, rows: valid });
    if ('error' in plan) return setRe({ ...re, error: plan.error });
    setRe({ ...re, error: null, preview: { plan, hash: await planHash(plan, valid), parsed, csv: reassignCsv, rows: valid.length } });
  };

  const mark = async (reassignUploadId: string, state: ReassignState): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await apiFetch<{ items: ReviewItem[] }>(`/api/campaigns/${encodeURIComponent(campaign)}/review-items/resolve`, {
          method: 'POST',
          json: { action: 'reassign', items: state.items.map(itemRef), reassignUploadId },
        });
        mergeItems(res.items);
        return true;
      } catch (e) {
        if (isRedirecting(e)) return false;
        if (e instanceof ApiError && e.status !== 503 && e.status !== 0) break;
      }
    }
    return false;
  };

  const sendReassign = async () => {
    if (!re?.preview || !re.agent) return;
    const state = re;
    setRe({ ...state, sending: true, error: null });
    try {
      const res = await apiFetch<{ uploadId: string; manifest: { uploadId?: string } }>(`/api/campaigns/${encodeURIComponent(campaign)}/uploads`, {
        method: 'POST',
        json: {
          fleet: 'v3',
          mode: 'single',
          agent: state.agent,
          fileName: `reasignacion-${uploadId}.csv`,
          csv: state.preview!.csv,
          plan: { agents: state.preview!.plan.agents, counts: state.preview!.plan.counts, hash: state.preview!.hash },
          source: { type: 'review', fromUploadId: uploadId, items: state.items.map(itemRef) },
        },
      });
      const newId = res.manifest?.uploadId ?? res.uploadId;
      if (await mark(newId, state)) {
        setRe(null);
        setSelected([]);
      } else {
        setRe({ ...state, sending: false, confirm: false, pendingMark: newId, error: 'Carga entregada; reintenta marcar como reasignados' });
      }
    } catch (e) {
      if (isRedirecting(e)) return;
      setRe({
        ...state,
        sending: false,
        confirm: false,
        preview: e instanceof ApiError && e.status === 409 ? null : state.preview,
        error: e instanceof ApiError ? e.message : 'No se pudo entregar la reasignación.',
      });
    }
  };

  const retryMark = async () => {
    if (!re?.pendingMark) return;
    const state = re;
    setRe({ ...state, sending: true });
    if (await mark(state.pendingMark!, state)) {
      setRe(null);
      setSelected([]);
    } else setRe({ ...state, sending: false, error: 'Carga entregada; reintenta marcar como reasignados' });
  };

  const title = isNone ? 'Por revisar sin carga asociada' : `Carga ${upload?.fileName || uploadId}`;

  // Recarga en vivo (add-realtime-admin-web); con selección, diálogo o reasignación en curso → aviso.
  const live = useRealtimeRefresh({
    types: ['uploads.changed', 'review.changed'],
    campaign,
    reload: load,
    isDirty: () => selected.length > 0 || discardOpen || re !== null || busy,
  });

  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={isNone ? `Contactos por revisar de ${campaign} sin carga de ANA Admin asociada.` : `Detalle de la carga ${uploadId} en ${campaign} (v3).`}
        actions={
          <Link
            href={`/contactos/historial`}
            className="inline-flex h-10 items-center rounded-xl border border-neutral-60 bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Historial
          </Link>
        }
      />
      <StaleNotice stale={live.stale} onRefresh={live.refresh} />
      {error && <InlineMessage className="mb-3">{error}</InlineMessage>}
      {actionError && <InlineMessage className="mb-3">{actionError}</InlineMessage>}
      {!isNone && upload === null && <InlineMessage className="mb-3">Carga no encontrada en el historial v3.</InlineMessage>}
      {upload && (
        <div className="pernexium-card mb-4 flex flex-wrap gap-4 p-4 text-sm text-text-muted">
          <span>Autor: <span className="font-mono">{upload.uploadedBy ?? '—'}</span></span>
          <span>Fecha: {formatDate(upload.uploadedAt)}</span>
          <span>Filas: {upload.totalRows ?? '—'}</span>
        </div>
      )}

      {selected.length > 0 && (
        <div className="sticky top-20 z-20 mb-3 flex flex-col gap-3 rounded-2xl bg-primary px-5 py-3 text-primary-foreground shadow-card sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-semibold">{selected.length} seleccionados</span>
          <div className="flex gap-2">
            <Button variant="inverse" size="sm" onClick={() => void openReassign()}>
              Reasignar
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
          <SkeletonRows rows={4} cols={4} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {agents.length === 0 && <div className="pernexium-card p-4 text-sm text-text-light">Sin contactos por revisar</div>}
          {agents.map((agent) => {
            const mine = (items ?? []).filter((i) => i.agent === agent);
            return (
              <section key={agent} className="pernexium-card p-4" aria-labelledby={`agent-${agent}`} data-testid={`review-agent-${agent}`}>
                <h2 id={`agent-${agent}`} className="mb-2 text-base font-semibold">
                  <span className="font-mono">{agent}</span>
                  <span className="ml-2 text-xs font-normal text-text-light">Por revisar</span>
                </h2>
                {mine.length === 0 ? (
                  <p className="text-sm text-text-light">Sin contactos por revisar</p>
                ) : (
                  <TableContainer>
                    <table className="w-full min-w-[700px] text-left text-sm">
                      <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                        <tr>
                          <th className="w-10 px-3 py-2">
                            <span className="sr-only">Seleccionar</span>
                          </th>
                          <th className="px-3 py-2">Teléfono</th>
                          <th className="px-3 py-2">Nombre</th>
                          <th className="px-3 py-2">Asignación</th>
                          <th className="px-3 py-2">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mine.map((i) => {
                          const k = itemKey(i);
                          const selectable = i.state === 'pending' && !i.parseError;
                          return (
                            <tr key={k} className="border-t border-neutral-40 align-top" data-testid={`review-${i.phone}`}>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  aria-label={`Seleccionar ${i.phone}`}
                                  disabled={!selectable}
                                  checked={selected.includes(k)}
                                  onChange={() => toggle(k)}
                                  className="h-4 w-4 accent-primary"
                                />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{i.phone || '—'}</td>
                              <td className="px-3 py-2">{contactName(i.row) ?? '—'}</td>
                              <td className="px-3 py-2 font-mono text-2xs">{i.assignmentId}</td>
                              <td className="px-3 py-2">
                                <StateCell item={i} campaign={campaign} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableContainer>
                )}
              </section>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={discardOpen}
        title={`Descartar ${selected.length} contacto(s)`}
        description="Úsalo cuando el mensaje sí salió (confírmalo en WhatsApp). Los contactos quedan como descartados."
        destructive
        confirmLabel="Descartar"
        loading={busy}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={discard}
      />

      {re && (
        <Dialog open title={`Reasignar ${re.items.length} contacto(s)`} onClose={() => !re.sending && setRe(null)} dismissable={!re.sending} size="lg">
          <div className="flex flex-col gap-4">
            <SearchableSelect
              label="Agente destino (habilitado en v3)"
              options={enabled.map((a) => ({ value: a, label: a }))}
              value={re.agent}
              onChange={(a) => setRe({ ...re, agent: a, preview: null })}
              disabled={!!re.pendingMark}
            />
            <p className="text-xs text-text-light">El agente destino escribe el mensaje en Mi asignación antes de enviarlo.</p>
            {re.error && <InlineMessage>{re.error}</InlineMessage>}
            {re.preview && (
              <p className="text-sm text-text-muted" data-testid="reassign-preview">
                Vista previa: {re.preview.rows} contacto(s) a <span className="font-mono">{re.agent}</span>.
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setRe(null)} disabled={re.sending}>
                Cancelar
              </Button>
              {re.pendingMark ? (
                <Button onClick={() => void retryMark()} loading={re.sending}>
                  Reintentar marcado
                </Button>
              ) : re.preview ? (
                <Button onClick={() => setRe({ ...re, confirm: true })}>Confirmar reasignación</Button>
              ) : (
                <Button onClick={() => void makePreview()} disabled={!re.agent}>
                  Vista previa
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {re?.preview && (
        <ConfirmDialog
          open={re.confirm}
          title="Confirmar reasignación"
          description={`Antes de reasignar, confirma en WhatsApp que el mensaje NO salió. Se creará una carga nueva a ${re.agent} con ${re.preview.rows} contacto(s).`}
          confirmLabel="Reasignar"
          loading={re.sending}
          onCancel={() => setRe({ ...re, confirm: false })}
          onConfirm={sendReassign}
        />
      )}
      
    </PageContainer>
  );
}
