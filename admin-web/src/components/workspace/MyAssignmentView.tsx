'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
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
  Textarea,
} from '@/components/ui';
import { formatDate } from '@/lib/agents';
import { StaleNotice } from '@/components/system/Realtime';
import { useRealtimeRefresh } from '@/lib/realtime/RealtimeProvider';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';
import {
  defaultPhoneColumn,
  firstMessage,
  loadFile,
  maskPhone,
  MAX_PHONE_COLUMNS,
  MAX_TEMPLATE,
  mergeFiles,
  phonesFor,
  PHONE_ALIASES,
  publishSources,
  renderRow,
  unknownMarkers,
  unknownMarkersError,
  type LoadedFile,
  type MergedRow,
  type PendingFile,
} from '@/lib/workspace';

const CHANGED_MESSAGE = 'La asignación cambió; vuelve a cargarla';
const MAX_VISIBLE_ROWS = 500;

interface Publication {
  publishId: string;
  publishedAt: string;
  contacts: number;
  rows: number;
  sources: Array<{ key: string; rows: number; remaining: number; action: 'rewritten' | 'deleted' }>;
}

/** Solo al mostrar: espacios repetidos colapsados (base CRM: nombre_cliente con doble espacio). */
const displayValue = (v: string) => v.replace(/\s+/g, ' ').trim();
const fileName = (key: string) => key.split('/').pop() ?? key;
const sizeLabel = (n: number | null) => (n == null ? '—' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** "Mi asignación" (add-agent-workspace): pendientes v3 del agente, mensaje y publicación al CLI. */
export function MyAssignmentView() {
  const [campaigns, setCampaigns] = useState<string[] | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingFile[] | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);

  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phoneColumns, setPhoneColumns] = useState<string[]>([]);
  const [template, setTemplate] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);

  const [publications, setPublications] = useState<Publication[] | null>(null);
  const [publicationsError, setPublicationsError] = useState<string | null>(null);

  // Campañas donde el usuario está habilitado en v3.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ campaigns: string[] }>('/api/agent/campaigns')
      .then((r) => {
        if (cancelled) return;
        setCampaigns(r.campaigns);
        if (r.campaigns.length === 1) setCampaign(r.campaigns[0]!);
      })
      .catch((e) => {
        if (cancelled || isRedirecting(e)) return;
        setCampaignsError(errorText(e, 'No se pudieron cargar tus campañas.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPending = useCallback(async (c: string) => {
    setPending(null);
    setPendingError(null);
    try {
      const r = await apiFetch<{ items: PendingFile[] }>(`/api/agent/assignments/${encodeURIComponent(c)}`);
      setPending(r.items);
      setCheckedKeys(r.items.length ? [r.items[0]!.key] : []);
    } catch (e) {
      if (isRedirecting(e)) return;
      setPendingError(errorText(e, 'No se pudieron cargar tus asignaciones.'));
    }
  }, []);

  const loadPublications = useCallback(async (c: string) => {
    setPublications(null);
    setPublicationsError(null);
    try {
      const r = await apiFetch<{ items: Publication[] }>(`/api/agent/assignments/${encodeURIComponent(c)}/publications`);
      setPublications(r.items);
    } catch (e) {
      if (isRedirecting(e)) return;
      setPublicationsError(errorText(e, 'No se pudo cargar el historial.'));
    }
  }, []);

  const resetWork = () => {
    setFiles([]);
    setSelected(new Set());
    setPhoneColumns([]);
    setSearch('');
    setSort(null);
    setFilesError(null);
  };

  useEffect(() => {
    resetWork();
    setTemplate('');
    setPublished(null);
    setPublishError(null);
    if (!campaign) return;
    void loadPending(campaign);
    void loadPublications(campaign);
  }, [campaign, loadPending, loadPublications]);

  const merged = useMemo(() => mergeFiles(files), [files]);

  // Recarga en vivo (add-realtime-admin-web): pendientes con `assignment.pending`
  // (con archivos cargados, filas seleccionadas o publicación en curso → aviso) e
  // historial con `publications.changed`.
  const livePending = useRealtimeRefresh({
    types: ['assignment.pending'],
    campaign,
    reload: () => (campaign ? loadPending(campaign) : undefined),
    isDirty: () => files.length > 0 || selected.size > 0 || confirmOpen || publishing,
  });
  useRealtimeRefresh({
    types: ['publications.changed'],
    campaign,
    reload: () => (campaign ? loadPublications(campaign) : undefined),
  });

  const loadSelected = async () => {
    if (!campaign || checkedKeys.length === 0) return;
    setLoadingFiles(true);
    setFilesError(null);
    setPublished(null);
    setPublishError(null);
    try {
      const loaded: LoadedFile[] = [];
      for (const key of checkedKeys) {
        const f = await apiFetch<{ key: string; etag: string; csv: string }>(
          `/api/agent/assignments/${encodeURIComponent(campaign)}/file?key=${encodeURIComponent(key)}`,
        );
        loaded.push(loadFile(f.key, f.etag, f.csv));
      }
      const m = mergeFiles(loaded);
      setFiles(loaded);
      setSelected(new Set(m.rows.filter((r) => r.valid).map((r) => r.id)));
      const def = defaultPhoneColumn(m.header);
      setPhoneColumns(def ? [def] : []);
      setTemplate((t) => (t.trim() ? t : firstMessage(m.rows)));
    } catch (e) {
      if (isRedirecting(e)) return;
      setFilesError(errorText(e, 'No se pudieron cargar los archivos.'));
    } finally {
      setLoadingFiles(false);
    }
  };

  const isPhoneColumn = (h: string) => phoneColumns.includes(h) || (PHONE_ALIASES as readonly string[]).includes(h) || /tel|phone/i.test(h);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? merged.rows.filter((r) => merged.header.some((h) => (r.record[h] ?? '').toLowerCase().includes(q))) : merged.rows;
    if (!sort) return base;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = (a.record[sort.column] ?? '').toLowerCase();
      const bv = (b.record[sort.column] ?? '').toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [merged, search, sort]);

  const selectedRows = useMemo(() => merged.rows.filter((r) => r.valid && selected.has(r.id)), [merged, selected]);
  const phones = useMemo(() => phonesFor(selectedRows, phoneColumns), [selectedRows, phoneColumns]);
  const contactCount = useMemo(() => [...phones.values()].reduce((n, p) => n + p.length, 0), [phones]);
  const markers = useMemo(
    () => (template.trim() && files.length ? unknownMarkers(template, merged.header, selectedRows.length ? selectedRows : merged.rows.filter((r) => r.valid)) : []),
    [template, files.length, merged, selectedRows],
  );

  const firstPhoneOf = (r: MergedRow) => phoneColumns.map((c) => r.record[c] ?? '').find((v) => v.replace(/\D/g, '').length >= 10) ?? '';
  const previewOf = (r: MergedRow) => (template.trim() ? renderRow(template, merged.header, r.record, firstPhoneOf(r)).text : '');

  const publishBlock: string | null = (() => {
    if (files.length === 0) return 'Carga tus archivos';
    if (selectedRows.length === 0) return 'Selecciona al menos una fila';
    if (phoneColumns.length === 0) return 'Elige la columna de teléfono';
    if (!template.trim()) return 'Escribe el mensaje';
    if (template.length > MAX_TEMPLATE) return `El mensaje admite como máximo ${MAX_TEMPLATE} caracteres`;
    if (markers.length) return unknownMarkersError(markers);
    if (contactCount === 0) return 'Ninguna fila seleccionada tiene un teléfono válido';
    return null;
  })();

  const filteredValid = filtered.filter((r) => r.valid);
  const allFilteredSelected = filteredValid.length > 0 && filteredValid.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      for (const r of filteredValid) {
        if (allFilteredSelected) n.delete(r.id);
        else n.add(r.id);
      }
      return n;
    });
  const toggleRow = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const insertVariable = (column: string) => {
    const token = `{{${column}}}`;
    const el = messageRef.current;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const publish = async () => {
    if (!campaign || publishBlock) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await apiFetch<{ manifest: { contacts: number } }>(`/api/agent/assignments/${encodeURIComponent(campaign)}/publish`, {
        method: 'POST',
        json: { template, phoneColumns, sources: publishSources(files, selectedRows) },
      });
      setConfirmOpen(false);
      setPublished(`Publicado: ${res.manifest.contacts} contactos; el CLI los enviará en su siguiente consulta.`);
      resetWork();
      void loadPending(campaign);
      void loadPublications(campaign);
    } catch (e) {
      if (isRedirecting(e)) return;
      setConfirmOpen(false);
      if (e instanceof ApiError && e.status === 409) {
        setPublishError(CHANGED_MESSAGE);
        resetWork();
        void loadPending(campaign);
      } else {
        setPublishError(errorText(e, 'No se pudo publicar.'));
      }
    } finally {
      setPublishing(false);
    }
  };

  const visible = filtered.slice(0, MAX_VISIBLE_ROWS);

  return (
    <PageContainer>
      <PageHeader title="Mi asignación" description="Revisa tus contactos asignados en v3, escribe tu mensaje y publícalos para que tu CLI los envíe." />
      <StaleNotice stale={livePending.stale} onRefresh={livePending.refresh} />

      <section className="pernexium-card p-6" aria-labelledby="campana-title">
        <h2 id="campana-title" className="text-base font-semibold">
          1. Campaña y asignaciones
        </h2>
        <div className="mt-4 max-w-sm">
          {campaigns === null && !campaignsError ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <SearchableSelect label="Campaña" options={(campaigns ?? []).map((c) => ({ value: c, label: c }))} value={campaign} onChange={setCampaign} />
          )}
        </div>
        {campaignsError && <InlineMessage className="mt-3">{campaignsError}</InlineMessage>}
        {campaigns && campaigns.length === 0 && <InlineMessage className="mt-3">No estás habilitado como agente v3 en ninguna campaña</InlineMessage>}

        {campaign && (
          <div className="mt-4">
            {pendingError && <InlineMessage>{pendingError}</InlineMessage>}
            {pending === null && !pendingError && <SkeletonRows rows={3} cols={3} />}
            {pending && pending.length === 0 && <p className="text-sm text-text-light">Sin asignaciones pendientes</p>}
            {pending && pending.length > 0 && (
              <>
                <TableContainer className="max-h-64 overflow-y-auto">
                  <table className="w-full min-w-[480px] text-left text-sm" data-testid="pending-files">
                    <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                      <tr>
                        <th className="w-10 px-3 py-2" />
                        <th className="px-3 py-2">Archivo</th>
                        <th className="px-3 py-2">Fecha</th>
                        <th className="px-3 py-2">Tamaño</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((p) => (
                        <tr key={p.key} className="border-t border-neutral-40">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar ${p.fileName}`}
                              checked={checkedKeys.includes(p.key)}
                              onChange={() => setCheckedKeys((ks) => (ks.includes(p.key) ? ks.filter((k) => k !== p.key) : [...ks, p.key]))}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{p.fileName}</td>
                          <td className="whitespace-nowrap px-3 py-2">{formatDate(p.lastModified)}</td>
                          <td className="px-3 py-2">{sizeLabel(p.size)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button onClick={() => void loadSelected()} disabled={checkedKeys.length === 0} loading={loadingFiles}>
                    Cargar seleccionados ({checkedKeys.length})
                  </Button>
                  <Button variant="outline" onClick={() => void loadPending(campaign)}>
                    Actualizar
                  </Button>
                </div>
              </>
            )}
            {filesError && <InlineMessage className="mt-3">{filesError}</InlineMessage>}
          </div>
        )}
        {published && (
          <InlineMessage kind="success" className="mt-4">
            {published}
          </InlineMessage>
        )}
        {publishError && <InlineMessage className="mt-4">{publishError}</InlineMessage>}
      </section>

      {files.length > 0 && (
        <section className="pernexium-card mt-4 p-6" aria-labelledby="mensaje-title">
          <h2 id="mensaje-title" className="text-base font-semibold">
            2. Mensaje y teléfonos
          </h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="mb-2 max-w-xs">
                <SearchableSelect
                  label="Insertar variable"
                  options={merged.header.map((h) => ({ value: h, label: `{{${h}}}` }))}
                  value={null}
                  onChange={insertVariable}
                  emptyLabel="Elige una columna"
                />
              </div>
              <Label htmlFor="agent-message">Mensaje para WhatsApp</Label>
              <Textarea
                id="agent-message"
                ref={messageRef}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="Hola {{first_name}}, tu saldo es {{total_balance}}"
                invalid={markers.length > 0}
              />
              <p className="mt-1 text-xs text-text-light">
                Variables {'{{columna}}'} o {'{columna}'} y expresiones como {'{{total_balance*0.8}}'}; {'\\n'} es salto de línea. Los valores se insertan tal cual; para redondear a 2 decimales usa {'{{columna*1}}'} (también {'{{pago_minimo.1*1}}'}).
              </p>
              {markers.length > 0 && <InlineMessage className="mt-2">{unknownMarkersError(markers)}</InlineMessage>}
            </div>
            <div>
              <SearchableMultiselect
                label="Columnas de teléfono"
                options={merged.header.map((h) => ({ value: h, label: h }))}
                selected={phoneColumns}
                onChange={(v) => setPhoneColumns(v.slice(0, MAX_PHONE_COLUMNS))}
              />
              {phoneColumns.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {phoneColumns.map((c) => (
                    <FilterPill key={c} label={`Teléfono: ${c}`} onRemove={() => setPhoneColumns(phoneColumns.filter((x) => x !== c))} />
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-text-light">El mensaje se envía a cada teléfono válido de las columnas elegidas (máximo {MAX_PHONE_COLUMNS}).</p>
              {selectedRows[0] && template.trim() && (
                <div className="mt-3 rounded-xl border border-neutral-50 bg-neutral-30 p-3" data-testid="message-preview">
                  <span className="text-2xs uppercase tracking-wider text-text-light">Vista previa (primera fila seleccionada)</span>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{previewOf(selectedRows[0])}</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section className="pernexium-card mt-4 p-6" aria-labelledby="contactos-title">
          <h2 id="contactos-title" className="text-base font-semibold">
            3. Contactos
          </h2>
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} aria-label="Seleccionar todos los resultados" />
              Seleccionar todos los resultados
            </label>
            <Input className="md:w-80" placeholder="Buscar…" aria-label="Buscar contactos" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {selectedRows.length > 0 && (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-primary px-5 py-3 text-primary-foreground shadow-card sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-semibold">
                {selectedRows.length} fila(s) seleccionada(s) · {contactCount} teléfono(s)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {publishBlock && <span className="text-xs">{publishBlock}</span>}
                <Button variant="inverse" onClick={() => setConfirmOpen(true)} disabled={!!publishBlock}>
                  Publicar ({contactCount})
                </Button>
                <Button variant="ghost" className="text-primary-foreground hover:bg-primary-10" onClick={() => setSelected(new Set())}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          <TableContainer className="mt-3 max-h-[32rem] overflow-y-auto">
            <table className="w-full min-w-[900px] text-left text-sm" data-testid="contacts-table">
              <thead className="sticky top-0 bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  {merged.header.map((h) => (
                    <th key={h} className="px-3 py-2">
                      <button
                        type="button"
                        className="flex items-center gap-1 uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                        onClick={() => setSort((s) => (s?.column === h ? { column: h, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { column: h, dir: 'asc' }))}
                      >
                        {h}
                        {sort?.column === h ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-2">Vista previa</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className={`border-t border-neutral-40 ${selected.has(r.id) ? 'bg-primary-light-90' : ''}`} data-testid={`row-${r.id}`}>
                    <td className="px-3 py-2">
                      {r.valid ? (
                        <input type="checkbox" aria-label={`Seleccionar fila ${r.id}`} checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                      ) : (
                        <Badge variant="error">Incompleta</Badge>
                      )}
                    </td>
                    {merged.header.map((h) => (
                      <td key={h} className="whitespace-nowrap px-3 py-2 text-text-muted">
                        {isPhoneColumn(h) ? <span className="font-mono text-xs">{maskPhone(r.record[h] ?? '')}</span> : displayValue(r.record[h] ?? '')}
                      </td>
                    ))}
                    <td className="max-w-xs px-3 py-2 text-xs text-text-light">
                      <span className="line-clamp-3 whitespace-pre-wrap">{r.valid ? previewOf(r) : 'Fila con menos columnas que el encabezado'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableContainer>
          <p className="mt-2 text-xs text-text-light">
            Mostrando {visible.length} de {filtered.length} (total {merged.rows.length})
          </p>
        </section>
      )}

      {campaign && (
        <section className="pernexium-card mt-4 p-6" aria-labelledby="historial-title">
          <h2 id="historial-title" className="text-base font-semibold">
            Historial de publicaciones
          </h2>
          {publicationsError && <InlineMessage className="mt-3">{publicationsError}</InlineMessage>}
          {publications === null && !publicationsError && (
            <div className="mt-3">
              <SkeletonRows rows={3} cols={3} />
            </div>
          )}
          {publications && publications.length === 0 && <p className="mt-3 text-sm text-text-light">Sin publicaciones</p>}
          {publications && publications.length > 0 && (
            <TableContainer className="mt-3">
              <table className="w-full min-w-[600px] text-left text-sm" data-testid="publications">
                <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Contactos</th>
                    <th className="px-3 py-2">Archivos origen</th>
                  </tr>
                </thead>
                <tbody>
                  {publications.map((p) => (
                    <tr key={p.publishId} className="border-t border-neutral-40 align-top" data-testid={`publication-${p.publishId}`}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(p.publishedAt)}</td>
                      <td className="px-3 py-2">{p.contacts}</td>
                      <td className="px-3 py-2">
                        <ul className="flex flex-col gap-1">
                          {(p.sources ?? []).map((s) => (
                            <li key={s.key} className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs">{fileName(s.key)}</span>
                              <Badge variant={s.action === 'deleted' ? 'muted' : 'outline'}>
                                {s.action === 'deleted' ? 'Consumido' : `Reescrito (${s.remaining} pendientes)`}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableContainer>
          )}
        </section>
      )}

      {campaign && (
        <ConfirmDialog
          open={confirmOpen}
          title="Publicar contactos"
          description={`${campaign} · ${selectedRows.length} fila(s) · ${contactCount} teléfono(s). Tu CLI enviará el mensaje por WhatsApp a cada teléfono en su siguiente consulta.`}
          confirmLabel="Publicar"
          loading={publishing}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={publish}
        >
          {selectedRows[0] && <p className="whitespace-pre-wrap rounded-xl bg-neutral-30 p-3 text-sm text-text-muted">{previewOf(selectedRows[0])}</p>}
        </ConfirmDialog>
      )}
    </PageContainer>
  );
}
