'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import {
  Badge,
  Button,
  FilterPill,
  InlineMessage,
  Input,
  Label,
  PageContainer,
  PageHeader,
  SearchableMultiselect,
  SearchableSelect,
  Skeleton,
  SkeletonRows,
  TableContainer,
} from '@/components/ui';
import { useCampaigns } from '@/components/system/useCampaigns';
import { StaleNotice } from '@/components/system/Realtime';
import { useRealtimeRefresh } from '@/lib/realtime/RealtimeProvider';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import {
  buildQuery,
  csvFileName,
  defaultFilters,
  EXPORT_MAX_ROWS,
  EXPORT_PAGE,
  formatMx,
  nextSort,
  progressPct,
  rangeError,
  RESULT_STATUSES,
  STATUS_LABEL,
  STATUS_VARIANT,
  toCsv,
  type HistoryFilters,
  type PublicationSummary,
  type ResultRow,
  type ResultsResponse,
  type ResultStatus,
  type SortField,
} from '@/lib/send-history';

/**
 * "Historial de envíos" (add-agent-send-history, spec v3/agent-send-history):
 * - `agent`: lo que el agente publicó y su CLI reportó (`/mi-asignacion/historial`).
 * - `campaign`: líderes y supervisores, con filtro de agente (`/historial-envios`).
 * Los teléfonos llegan ya enmascarados desde v3.
 */
export type SendHistoryScope = 'agent' | 'campaign';

const STATUS_OPTIONS = RESULT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }));
const SEARCH_DEBOUNCE_MS = 400;

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Campañas del alcance: agente (habilitado en v3) o campaña (catálogo del usuario). */
function useScopeCampaigns(scope: SendHistoryScope) {
  const all = useCampaigns();
  const [own, setOwn] = useState<{ campaigns: string[] | null; error: string | null }>({ campaigns: null, error: null });
  useEffect(() => {
    if (scope !== 'agent') return;
    let cancelled = false;
    apiFetch<{ campaigns: string[] }>('/api/agent/campaigns')
      .then((r) => !cancelled && setOwn({ campaigns: r.campaigns, error: null }))
      .catch((e) => {
        if (cancelled || isRedirecting(e)) return;
        setOwn({ campaigns: [], error: errorText(e, 'No se pudieron cargar tus campañas.') });
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);
  if (scope === 'agent') return { campaigns: own.campaigns, error: own.error };
  return { campaigns: all.loading ? null : all.campaigns, error: all.error };
}

function SortHeader({ label, field, filters, onSort }: { label: string; field: SortField; filters: HistoryFilters; onSort: (f: SortField) => void }) {
  const active = filters.sort === field;
  const Icon = filters.order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="px-3 py-3" aria-sort={active ? (filters.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
      >
        {label}
        {active && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </th>
  );
}

function PublicationCard({ p, showAgent, selected, onSelect }: { p: PublicationSummary; showAgent: boolean; selected: boolean; onSelect: () => void }) {
  const pct = progressPct(p);
  const counts: Array<[string, number | string]> = [
    ['Publicados', p.published],
    ['Enviados', p.sent],
    ['Sin WhatsApp', p.no_whatsapp],
    ['Error', p.error],
    ['Por revisar', p.por_revisar],
    ['Pendientes', p.pending === null ? 'parcial' : p.pending],
  ];
  return (
    <article
      className={cn('pernexium-card flex flex-col gap-3 p-4', selected && 'ring-2 ring-secondary')}
      data-testid={`publication-${p.publicationId}`}
      aria-label={`Publicación del ${formatMx(p.publishedAt)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{formatMx(p.publishedAt)}</p>
          {showAgent && <p className="font-mono text-xs text-text-light">{p.agent}</p>}
        </div>
        <Button size="sm" variant={selected ? 'default' : 'outline'} onClick={onSelect}>
          {selected ? 'Viendo' : 'Ver contactos'}
        </Button>
      </div>
      {p.templatePreview && <p className="line-clamp-2 text-xs text-text-light">{p.templatePreview}</p>}
      <div>
        <div
          role="progressbar"
          aria-label="Avance de la publicación"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? 0}
          className="h-2 w-full overflow-hidden rounded-full bg-neutral-40"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct ?? 0}%` }} />
        </div>
        <p className="mt-1 text-xs text-text-light">
          {p.reported} de {p.published} reportados{pct !== null ? ` (${pct}%)` : ''}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-text-light">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function SendHistoryView({ scope }: { scope: SendHistoryScope }) {
  const { campaigns, error: campaignsError } = useScopeCampaigns(scope);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(() => defaultFilters());
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (campaigns && campaigns.length === 1 && !campaign) setCampaign(campaigns[0]!);
  }, [campaigns, campaign]);

  // Búsqueda con espera (crédito o dígitos del teléfono).
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const invalidRange = rangeError(filters.from, filters.to);
  const baseUrl = campaign
    ? scope === 'agent'
      ? `/api/agent/results/${encodeURIComponent(campaign)}`
      : `/api/campaigns/${encodeURIComponent(campaign)}/results`
    : null;

  const load = useCallback(async () => {
    if (!baseUrl || invalidRange) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ResultsResponse>(`${baseUrl}?${buildQuery(filters)}`);
      if (id !== requestId.current) return;
      setData(res);
      setRows(res.items);
    } catch (e) {
      if (id !== requestId.current || isRedirecting(e)) return;
      setData(null);
      setRows([]);
      setError(errorText(e, 'No se pudo cargar el historial.'));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [baseUrl, filters, invalidRange]);

  useEffect(() => {
    void load();
  }, [load]);

  // Recarga en vivo (D9): lotes nuevos del CLI del agente.
  const live = useRealtimeRefresh({
    types: scope === 'agent' ? ['results.changed'] : [],
    campaign,
    reload: load,
  });

  const loadMore = async () => {
    if (!baseUrl || !data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch<ResultsResponse>(`${baseUrl}?${buildQuery(filters, { cursor: data.nextCursor })}`);
      setRows((r) => [...r, ...res.items]);
      setData((d) => (d ? { ...d, nextCursor: res.nextCursor } : d));
    } catch (e) {
      if (!isRedirecting(e)) setError(errorText(e, 'No se pudieron cargar más filas.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = async () => {
    if (!baseUrl || !campaign) return;
    setExporting(true);
    setExportNote(null);
    try {
      const all: ResultRow[] = [];
      let cursor: string | null = null;
      do {
        const res: ResultsResponse = await apiFetch<ResultsResponse>(`${baseUrl}?${buildQuery(filters, { cursor, limit: EXPORT_PAGE })}`);
        all.push(...res.items);
        cursor = res.nextCursor;
      } while (cursor && all.length < EXPORT_MAX_ROWS);
      const rowsOut = all.slice(0, EXPORT_MAX_ROWS);
      const blob = new Blob([toCsv(rowsOut)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = csvFileName(campaign, filters);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportNote(
        cursor ? `Se exportaron las primeras ${EXPORT_MAX_ROWS.toLocaleString('es-MX')} filas; acota los filtros para el resto.` : `Se exportaron ${rowsOut.length} filas.`,
      );
    } catch (e) {
      if (!isRedirecting(e)) setError(errorText(e, 'No se pudo exportar el historial.'));
    } finally {
      setExporting(false);
    }
  };

  const update = (patch: Partial<HistoryFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const onCampaign = (c: string) => {
    setCampaign(c);
    setData(null);
    setRows([]);
    update({ publicationId: null, agent: null });
  };
  const onSort = (field: SortField) => update(nextSort(filters, field));

  const publicationOptions = useMemo(
    () => [
      { value: '', label: 'Todas las publicaciones' },
      { value: 'none', label: 'Sin publicación' },
      ...(data?.publications ?? []).map((p) => ({ value: p.publicationId, label: `${formatMx(p.publishedAt)}${scope === 'campaign' ? ` · ${p.agent}` : ''}` })),
    ],
    [data?.publications, scope],
  );
  const agentOptions = useMemo(() => [{ value: '', label: 'Todos los agentes' }, ...(data?.agents ?? []).map((a) => ({ value: a, label: a }))], [data?.agents]);
  const publicationLabel = publicationOptions.find((o) => o.value === filters.publicationId)?.label ?? filters.publicationId;
  const showAgent = scope === 'campaign';
  const hasUnlinked = (data?.unlinked.reported ?? 0) > 0;

  return (
    <PageContainer>
      <PageHeader
        title="Historial de envíos"
        description={
          scope === 'agent'
            ? 'Lo que tu CLI envió de tus publicaciones: resultado por contacto y avance de cada publicación.'
            : 'Resultado por contacto de los envíos del CLI v3 en la campaña, por agente y publicación.'
        }
        actions={
          <>
            {scope === 'agent' && (
              <Link
                href="/mi-asignacion"
                className="inline-flex h-10 items-center rounded-xl border border-neutral-60 bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              >
                Mi asignación
              </Link>
            )}
            <Button variant="outline" onClick={() => void load()} disabled={!campaign || loading || !!invalidRange}>
              Actualizar
            </Button>
            <Button onClick={() => void exportCsv()} disabled={!campaign || exporting || !data || data.total === 0}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {exporting ? 'Exportando…' : 'Exportar CSV'}
            </Button>
          </>
        }
      />
      <StaleNotice stale={live.stale} onRefresh={live.refresh} />

      <section className="pernexium-card mb-4 p-4" aria-label="Filtros">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {campaigns === null ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <SearchableSelect label="Campaña" options={campaigns.map((c) => ({ value: c, label: c }))} value={campaign} onChange={onCampaign} />
          )}
          <div>
            <Label htmlFor="hist-from">Desde</Label>
            <Input id="hist-from" type="date" value={filters.from} max={filters.to} onChange={(e) => update({ from: e.target.value })} invalid={!!invalidRange} />
          </div>
          <div>
            <Label htmlFor="hist-to">Hasta</Label>
            <Input id="hist-to" type="date" value={filters.to} min={filters.from} onChange={(e) => update({ to: e.target.value })} invalid={!!invalidRange} />
          </div>
          <div>
            <Label htmlFor="hist-q">Buscar</Label>
            <Input id="hist-q" type="search" placeholder="Crédito o últimos dígitos" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={64} />
          </div>
          <SearchableMultiselect label="Estado" options={STATUS_OPTIONS} selected={filters.statuses} onChange={(v) => update({ statuses: v as ResultStatus[] })} />
          <SearchableSelect
            label="Publicación"
            options={publicationOptions}
            value={filters.publicationId ?? ''}
            onChange={(v) => update({ publicationId: v || null })}
            disabled={!campaign}
          />
          {showAgent && (
            <SearchableSelect label="Agente" options={agentOptions} value={filters.agent ?? ''} onChange={(v) => update({ agent: v || null })} disabled={!campaign} />
          )}
        </div>
        {(filters.statuses.length > 0 || filters.publicationId || filters.agent || filters.q) && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Filtros activos">
            {filters.statuses.map((s) => (
              <FilterPill key={s} label={STATUS_LABEL[s]} onRemove={() => update({ statuses: filters.statuses.filter((x) => x !== s) })} />
            ))}
            {filters.publicationId && <FilterPill label={`Publicación: ${publicationLabel}`} onRemove={() => update({ publicationId: null })} />}
            {filters.agent && <FilterPill label={`Agente: ${filters.agent}`} onRemove={() => update({ agent: null })} />}
            {filters.q && (
              <FilterPill
                label={`Búsqueda: ${filters.q}`}
                onRemove={() => {
                  setSearch('');
                  update({ q: '' });
                }}
              />
            )}
          </div>
        )}
        {invalidRange && <InlineMessage className="mt-3">{invalidRange}</InlineMessage>}
      </section>

      {campaignsError && <InlineMessage className="mb-3">{campaignsError}</InlineMessage>}
      {campaigns && campaigns.length === 0 && (
        <InlineMessage className="mb-3">{scope === 'agent' ? 'No estás habilitado como agente v3 en ninguna campaña' : 'No tienes campañas disponibles'}</InlineMessage>
      )}
      {error && <InlineMessage className="mb-3">{error}</InlineMessage>}
      {exportNote && (
        <InlineMessage kind="success" className="mb-3">
          {exportNote}
        </InlineMessage>
      )}

      {!campaign ? (
        <div className="pernexium-card p-4">
          <p className="text-sm text-text-light">Elige una campaña para ver el historial.</p>
        </div>
      ) : (
        <>
          <section className="mb-4" aria-labelledby="pubs-title">
            <h2 id="pubs-title" className="mb-3 text-base font-semibold">
              Publicaciones
            </h2>
            {loading && !data ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-44 w-full rounded-2xl" />
                ))}
              </div>
            ) : data && (data.publications.length > 0 || hasUnlinked) ? (
              <>
                {data.publications.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="publication-cards">
                    {data.publications.map((p) => (
                      <PublicationCard
                        key={`${p.agent}-${p.publicationId}`}
                        p={p}
                        showAgent={showAgent}
                        selected={filters.publicationId === p.publicationId}
                        onSelect={() => update({ publicationId: filters.publicationId === p.publicationId ? null : p.publicationId })}
                      />
                    ))}
                  </div>
                )}
                {hasUnlinked && (
                  <p className="mt-3 text-xs text-text-light" data-testid="unlinked">
                    {data.unlinked.reported} resultado(s) sin publicación asociada (cargas directas o asignaciones anteriores).
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-text-light">Sin publicaciones ni resultados en el rango.</p>
            )}
          </section>

          <section className="pernexium-card p-4" aria-labelledby="rows-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="rows-title" className="text-base font-semibold">
                Contactos
              </h2>
              {data && (
                <div className="flex flex-wrap gap-2 text-xs" data-testid="summary">
                  <Badge variant="outline">{data.total} en el filtro</Badge>
                  {RESULT_STATUSES.map((s) => (
                    <Badge key={s} variant={STATUS_VARIANT[s]}>
                      {STATUS_LABEL[s]}: {data.summary[s]}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {loading && !data ? (
              <SkeletonRows rows={6} cols={6} />
            ) : rows.length === 0 ? (
              <p className="text-sm text-text-light">Sin resultados con estos filtros.</p>
            ) : (
              <>
                <TableContainer>
                  <table className="w-full min-w-[900px] text-left text-sm" data-testid="results-table">
                    <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                      <tr>
                        <SortHeader label="Fecha (MX)" field="sentAt" filters={filters} onSort={onSort} />
                        {showAgent && <th className="px-3 py-3">Agente</th>}
                        <SortHeader label="Estado" field="status" filters={filters} onSort={onSort} />
                        <SortHeader label="Crédito" field="credit" filters={filters} onSort={onSort} />
                        <th className="px-3 py-3">Teléfono</th>
                        <th className="px-3 py-3">Mensaje</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={`${r.agent}-${r.id}`} className="border-t border-neutral-40 align-top" data-testid={`row-${r.id}`}>
                          <td className="whitespace-nowrap px-3 py-3">{formatMx(r.sentAt)}</td>
                          {showAgent && <td className="px-3 py-3 font-mono text-xs">{r.agent}</td>}
                          <td className="px-3 py-3">
                            <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                            {r.error && r.status !== 'sent' && <span className="mt-1 block max-w-[220px] text-xs text-text-light">{r.error}</span>}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs">{r.credit ?? '—'}</td>
                          <td className="px-3 py-3 font-mono text-xs">{r.phone || '—'}</td>
                          <td className="max-w-[360px] px-3 py-3 text-xs text-text-light">
                            <span className="line-clamp-2" title={r.messagePreview ?? undefined}>
                              {r.messagePreview ?? '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-text-light">
                  <span>
                    Mostrando {rows.length} de {data?.total ?? rows.length}
                  </span>
                  {data?.nextCursor && (
                    <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                      {loadingMore ? 'Cargando…' : 'Cargar más'}
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </PageContainer>
  );
}
