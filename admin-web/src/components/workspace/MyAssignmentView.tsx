'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, CheckCircle2, X } from 'lucide-react';
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
  amountColumns,
  applyFilters,
  categoryColumns,
  columnFilterActive,
  columnFilterKind,
  columnFilterPills,
  columnValueCounts,
  defaultPhoneColumns,
  distinctValues,
  emptyFilters,
  firstMessage,
  isFilterActive,
  loadFile,
  loadTableState,
  maskPhone,
  MAX_PHONE_COLUMNS,
  MAX_TEMPLATE,
  mergeFiles,
  movePhoneColumn,
  nextSort,
  NO_CUSTOM_FIELD_WARNING,
  parseNumber,
  PHONE_ALIASES,
  phoneCandidates,
  planPhones,
  publishOverrides,
  publishSources,
  removeColumnFilterPart,
  renderRow,
  reorderSelection,
  saveTableState,
  setColumnFilter,
  sortRows,
  suggestedFields,
  templateHasCustomField,
  unknownMarkers,
  unknownMarkersError,
  type ColumnFilter,
  type FilterState,
  type LoadedFile,
  type MergedRow,
  type PendingFile,
  type PersistedTableState,
  type PhoneMode,
} from '@/lib/workspace';
import {
  clearDraft,
  isRecentSource,
  loadDraft,
  samplePairs,
  saveDraft,
  summarizePlan,
  type WizardDraft,
  type WizardStep,
} from '@/lib/workspace/wizard';
import { AssignmentFilesStep } from './AssignmentFilesStep';
import { ColumnFilterButton, type ColumnFilterStats } from './ColumnFilterPopover';
import { WizardNav, WizardStepper } from './WizardStepper';
import { WizardSummary } from './WizardSummary';

const PHONE_MODE_OPTIONS: ReadonlyArray<{ value: PhoneMode; label: string }> = [
  { value: 'first', label: 'Primer teléfono válido' },
  { value: 'all', label: 'Todos los seleccionados' },
];
const phoneModeLabel = (m: PhoneMode) => PHONE_MODE_OPTIONS.find((o) => o.value === m)!.label;
const AUTO = '__auto__';

/** Teléfono(s) de la fila (enmascarados) y selector para elegir uno de sus teléfonos válidos. */
function SendPhoneCell({
  row,
  phoneColumns,
  sending,
  override,
  onPick,
}: {
  row: MergedRow;
  phoneColumns: readonly string[];
  sending: readonly string[];
  override: string | undefined;
  onPick: (phone: string | null) => void;
}) {
  const candidates = phoneCandidates(row.record, phoneColumns);
  const shown = sending.length ? sending.map(maskPhone).join(', ') : '—';
  if (candidates.length < 2) return <span className="whitespace-nowrap font-mono text-xs text-text-muted">{shown}</span>;
  const options = [
    { value: AUTO, label: 'Automático' },
    ...candidates.map((c) => ({ value: c.phone, label: `${maskPhone(c.phone)} · ${c.column}` })),
  ];
  const value = override !== undefined && candidates.some((c) => c.phone === override) ? override : AUTO;
  return (
    <div className="w-44">
      <SearchableSelect label={`Teléfono a enviar fila ${row.id}`} hideLabel options={options} value={value} onChange={(v) => onPick(v === AUTO ? null : v)} />
      <span className="mt-0.5 block whitespace-nowrap font-mono text-2xs text-text-light">{shown}</span>
    </div>
  );
}

const CHANGED_MESSAGE = 'La asignación cambió; vuelve a cargarla';
const MAX_VISIBLE_ROWS = 500;
const PREVIEW_ROWS = 3;

interface Publication {
  publishId: string;
  publishedAt: string;
  contacts: number;
  rows: number;
  sources: Array<{ key: string; rows: number; remaining: number; action: 'rewritten' | 'deleted' }>;
}

interface Published {
  publishId: string;
  messages: number;
  rows: number;
}

/** Solo al mostrar: espacios repetidos colapsados (base CRM: nombre_cliente con doble espacio). */
const displayValue = (v: string) => v.replace(/\s+/g, ' ').trim();
const fileName = (key: string) => key.split('/').pop() ?? key;
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * "Mi asignación" (add-agent-workspace): asistente de 4 pasos — archivo(s) de
 * asignación (≤ 3 meses), contactos (filtros, selección y teléfonos), mensaje y
 * resumen con envío al CLI. El borrador vive por campaña en sessionStorage.
 */
export function MyAssignmentView() {
  const [campaigns, setCampaigns] = useState<string[] | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<string | null>(null);

  const [step, setStep] = useState<WizardStep>(1);
  const [notice, setNotice] = useState<string | null>(null);
  // Borrador por restaurar al cargar los pendientes; `hydrated` evita guardar antes de restaurar.
  const draftRef = useRef<WizardDraft | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [pending, setPending] = useState<PendingFile[] | null>(null);
  const [hiddenOld, setHiddenOld] = useState(0);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);

  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // Filtros y orden de la tabla, guardados por campaña (localStorage). `campaign`
  // marca a qué campaña pertenecen para no escribirlos en la clave de otra al cambiar.
  const [table, setTable] = useState<PersistedTableState & { campaign: string | null }>({ campaign: null, filters: emptyFilters(), sort: null });
  const [rangeColumn, setRangeColumn] = useState<string | null>(null);
  const { filters, sort } = table;
  const setFilters = (fn: (f: FilterState) => FilterState) => setTable((t) => ({ ...t, filters: fn(t.filters) }));
  const setSearch = (search: string) => setFilters((f) => ({ ...f, search }));
  // Columna con el popover de filtro abierto (sus valores se calculan solo entonces).
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const setColumn = (column: string, next: ColumnFilter | undefined) => setFilters((f) => ({ ...f, columns: setColumnFilter(f.columns, column, next) }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phoneColumns, setPhoneColumns] = useState<string[]>([]);
  const [phoneMode, setPhoneMode] = useState<PhoneMode>('first');
  // Teléfono elegido por fila (MergedRow.id → teléfono); vive mientras la página esté abierta.
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [template, setTemplate] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<Published | null>(null);

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

  /** Descarga los archivos en el orden dado; `null` si falla (con el error en pantalla). */
  const fetchFiles = useCallback(async (c: string, keys: readonly string[]): Promise<LoadedFile[] | null> => {
    setLoadingFiles(true);
    setFilesError(null);
    try {
      const loaded: LoadedFile[] = [];
      for (const key of keys) {
        const f = await apiFetch<{ key: string; etag: string; csv: string }>(`/api/agent/assignments/${encodeURIComponent(c)}/file?key=${encodeURIComponent(key)}`);
        loaded.push(loadFile(f.key, f.etag, f.csv));
      }
      return loaded;
    } catch (e) {
      if (!isRedirecting(e)) setFilesError(errorText(e, 'No se pudieron cargar los archivos.'));
      return null;
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  /** Aplica archivos cargados: todo lo válido seleccionado y teléfonos por omisión, o lo del borrador. */
  const applyLoaded = useCallback((loaded: LoadedFile[], restore?: Pick<WizardDraft, 'selected' | 'phoneColumns' | 'overrides'>) => {
    const m = mergeFiles(loaded);
    const valid = m.rows.filter((r) => r.valid).map((r) => r.id);
    setFiles(loaded);
    setSelected(new Set(restore ? restore.selected.filter((id) => valid.includes(id)) : valid));
    const cols = restore ? restore.phoneColumns.filter((c) => m.header.includes(c)) : [];
    setPhoneColumns(cols.length ? cols : defaultPhoneColumns(m.header));
    setOverrides(new Map(restore?.overrides ?? []));
    setTemplate((t) => (t.trim() ? t : firstMessage(m.rows)));
  }, []);

  const loadPending = useCallback(
    async (c: string) => {
      setPending(null);
      setPendingError(null);
      try {
        const r = await apiFetch<{ items: PendingFile[] }>(`/api/agent/assignments/${encodeURIComponent(c)}`);
        // Más de 3 meses: nunca se ofrecen (v3 tampoco los lista ni los publica).
        const now = Date.now();
        const items = r.items.filter((p) => isRecentSource(p, now));
        setHiddenOld(r.items.length - items.length);
        setPending(items);
        const has = (k: string) => items.some((p) => p.key === k);
        const draft = draftRef.current;
        draftRef.current = null;
        if (draft) {
          setTemplate(draft.template);
          setPhoneMode(draft.phoneMode);
          const keys = draft.keys.filter(has);
          setCheckedKeys(keys.length ? keys : items.length ? [items[0]!.key] : []);
          if (draft.step >= 2 && keys.length > 0 && keys.length === draft.keys.length && draft.etags.length === keys.length) {
            const loaded = await fetchFiles(c, keys);
            if (loaded && loaded.every((f, i) => f.etag === draft.etags[i])) {
              applyLoaded(loaded, draft);
              setStep(draft.step);
            } else if (loaded) {
              applyLoaded(loaded);
              setStep(2);
              setNotice('La asignación cambió desde tu borrador; revisa tu selección.');
            }
          } else if (draft.step >= 2 && keys.length !== draft.keys.length) {
            setNotice('Algunos archivos de tu borrador ya no están disponibles; vuelve a elegirlos.');
          }
        } else {
          setCheckedKeys((prev) => {
            const kept = prev.filter(has);
            return kept.length ? kept : items.length ? [items[0]!.key] : [];
          });
        }
      } catch (e) {
        if (isRedirecting(e)) return;
        setPendingError(errorText(e, 'No se pudieron cargar tus asignaciones.'));
      } finally {
        setHydrated(true);
      }
    },
    [applyLoaded, fetchFiles],
  );

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
    setOverrides(new Map());
    setFilesError(null);
  };

  useEffect(() => {
    resetWork();
    setTemplate('');
    setPhoneMode('first');
    setStep(1);
    setNotice(null);
    setHydrated(false);
    setCheckedKeys([]);
    setPublished(null);
    setPublishError(null);
    setRangeColumn(null);
    setOpenFilter(null);
    setTable(campaign ? { campaign, ...loadTableState(campaign) } : { campaign: null, filters: emptyFilters(), sort: null });
    if (!campaign) return;
    draftRef.current = loadDraft(campaign);
    void loadPending(campaign);
    void loadPublications(campaign);
  }, [campaign, loadPending, loadPublications]);

  useEffect(() => {
    if (table.campaign) saveTableState(table.campaign, { filters: table.filters, sort: table.sort });
  }, [table]);

  // Archivos marcados en el orden del listado (más reciente primero).
  const orderedKeys = useMemo(() => (pending ?? []).filter((p) => checkedKeys.includes(p.key)).map((p) => p.key), [pending, checkedKeys]);

  // Borrador del asistente (sessionStorage): una recarga no pierde el trabajo.
  useEffect(() => {
    if (!campaign || !hydrated || published) return;
    saveDraft(campaign, {
      v: 1,
      step,
      keys: step === 1 ? orderedKeys : files.map((f) => f.key),
      etags: step === 1 ? [] : files.map((f) => f.etag),
      selected: [...selected],
      phoneColumns,
      phoneMode,
      overrides: [...overrides],
      template,
    });
  }, [campaign, hydrated, published, step, orderedKeys, files, selected, phoneColumns, phoneMode, overrides, template]);

  const merged = useMemo(() => mergeFiles(files), [files]);

  // Recarga en vivo (add-realtime-admin-web): pendientes con `assignment.pending`
  // (con trabajo en curso → aviso) e historial con `publications.changed`.
  const livePending = useRealtimeRefresh({
    types: ['assignment.pending'],
    campaign,
    reload: () => (campaign ? loadPending(campaign) : undefined),
    isDirty: () => step > 1 || files.length > 0 || confirmOpen || publishing,
  });
  useRealtimeRefresh({
    types: ['publications.changed'],
    campaign,
    reload: () => (campaign ? loadPublications(campaign) : undefined),
  });

  const isPhoneColumn = (h: string) => phoneColumns.includes(h) || (PHONE_ALIASES as readonly string[]).includes(h) || /tel|phone/i.test(h);

  const categories = useMemo(() => categoryColumns(merged.header), [merged.header]);
  const categoryOptions = useMemo(
    () => Object.fromEntries(categories.map((c) => [c, distinctValues(merged.rows, c).map((v) => ({ value: v, label: v }))])),
    [categories, merged.rows],
  );
  const amounts = useMemo(() => amountColumns(merged.header, merged.rows, phoneColumns), [merged, phoneColumns]);
  const activeRangeColumn = rangeColumn && amounts.includes(rangeColumn) ? rangeColumn : (amounts[0] ?? null);
  const filtersActive = isFilterActive(filters, merged.header);

  // Diferido: escribir en un filtro no bloquea el input mientras se refiltran miles de filas.
  const deferredFilters = useDeferredValue(filters);
  const filtered = useMemo(
    () => sortRows(applyFilters(merged.rows, merged.header, deferredFilters), sort && merged.header.includes(sort.column) ? sort : null),
    [merged, deferredFilters, sort],
  );

  // Valores del popover abierto: filas que pasan los demás filtros (estilo Excel).
  // La clave solo cambia con los demás filtros, no al marcar valores de esta columna.
  const otherFiltersKey = useMemo(() => {
    if (!openFilter) return '';
    const columns = { ...filters.columns };
    delete columns[openFilter];
    return JSON.stringify({ ...filters, columns });
  }, [filters, openFilter]);
  const openStats = useMemo<ColumnFilterStats | null>(() => {
    if (!openFilter || !merged.header.includes(openFilter)) return null;
    const others = JSON.parse(otherFiltersKey) as FilterState;
    const forceText = phoneColumns.includes(openFilter) || (PHONE_ALIASES as readonly string[]).includes(openFilter) || /tel|phone/i.test(openFilter);
    return {
      kind: columnFilterKind(merged.rows, openFilter, forceText),
      counts: columnValueCounts(applyFilters(merged.rows, merged.header, others), openFilter),
    };
  }, [openFilter, otherFiltersKey, merged, phoneColumns]);

  const setRange = (column: string, bound: 'min' | 'max', value: string) =>
    setFilters((f) => ({ ...f, ranges: { ...f.ranges, [column]: { min: '', max: '', ...f.ranges[column], [bound]: value } } }));
  const removeRange = (column: string) =>
    setFilters((f) => {
      const ranges = { ...f.ranges };
      delete ranges[column];
      return { ...f, ranges };
    });
  const clearFilters = () => setFilters(() => emptyFilters());
  const pills: Array<{ key: string; label: string; onRemove: () => void }> = [
    ...categories.flatMap((c) =>
      (filters.values[c] ?? []).map((v) => ({
        key: `v:${c}:${v}`,
        label: `${c}: ${v}`,
        onRemove: () => setFilters((f) => ({ ...f, values: { ...f.values, [c]: (f.values[c] ?? []).filter((x) => x !== v) } })),
      })),
    ),
    ...Object.entries(filters.ranges)
      .filter(([c, r]) => merged.header.includes(c) && (parseNumber(r.min) !== null || parseNumber(r.max) !== null))
      .map(([c, r]) => {
        const min = parseNumber(r.min);
        const max = parseNumber(r.max);
        const label = min !== null && max !== null ? `${c}: ${min} – ${max}` : min !== null ? `${c} ≥ ${min}` : `${c} ≤ ${max}`;
        return { key: `r:${c}`, label, onRemove: () => removeRange(c) };
      }),
    ...columnFilterPills(filters.columns, merged.header, (c, v) => (isPhoneColumn(c) ? maskPhone(v) : v)).map((p) => ({
      key: p.key,
      label: p.label,
      onRemove: () => setFilters((f) => ({ ...f, columns: removeColumnFilterPart(f.columns, p.column, p.part) })),
    })),
  ];

  const selectedRows = useMemo(() => merged.rows.filter((r) => r.valid && selected.has(r.id)), [merged, selected]);
  const phones = useMemo(() => planPhones(selectedRows, phoneColumns, phoneMode, overrides), [selectedRows, phoneColumns, phoneMode, overrides]);
  const summary = useMemo(() => summarizePlan(merged.rows, selectedRows, phones, phoneColumns), [merged.rows, selectedRows, phones, phoneColumns]);
  const contactCount = summary.messages;
  const markers = useMemo(
    () => (template.trim() && files.length ? unknownMarkers(template, merged.header, selectedRows.length ? selectedRows : merged.rows.filter((r) => r.valid)) : []),
    [template, files.length, merged, selectedRows],
  );
  // Aviso no bloqueante: plantilla sin ninguna variable que resuelva a una columna.
  const noCustomField = useMemo(
    () => !!template.trim() && files.length > 0 && !templateHasCustomField(template, merged.header, phoneColumns),
    [template, files.length, merged.header, phoneColumns],
  );
  const suggestions = useMemo(() => suggestedFields(merged.header, phoneColumns), [merged.header, phoneColumns]);

  /** Teléfonos a los que se enviaría la fila (los de la publicación si está seleccionada). */
  const sendPhonesOf = (r: MergedRow): string[] => phones.get(r.id) ?? planPhones([r], phoneColumns, phoneMode, overrides).get(r.id) ?? [];
  const setOverride = (id: string, phone: string | null) =>
    setOverrides((m) => {
      const n = new Map(m);
      if (phone === null) n.delete(id);
      else n.set(id, phone);
      return n;
    });
  const samples = useMemo(
    () =>
      template.trim()
        ? samplePairs(selectedRows, phones, PREVIEW_ROWS).map((s) => ({ ...s, text: renderRow(template, merged.header, s.row.record, s.phone).text }))
        : [],
    [template, selectedRows, phones, merged.header],
  );

  // ── Validación por paso (Siguiente deshabilitado con el motivo) ──────────
  const step1Block: string | null = pending === null ? 'Cargando asignaciones' : orderedKeys.length === 0 ? 'Elige al menos un archivo' : null;
  const step2Block: string | null = (() => {
    if (files.length === 0) return 'Carga tus archivos';
    if (selectedRows.length === 0) return 'Selecciona al menos una fila';
    if (phoneColumns.length === 0) return 'Elige la columna de teléfono';
    if (contactCount === 0) return 'Ninguna fila seleccionada tiene un teléfono válido';
    return null;
  })();
  const step3Block: string | null = (() => {
    if (!template.trim()) return 'Escribe el mensaje';
    if (template.length > MAX_TEMPLATE) return `El mensaje admite como máximo ${MAX_TEMPLATE} caracteres`;
    if (markers.length) return unknownMarkersError(markers);
    return null;
  })();
  const publishBlock = step2Block ?? step3Block;

  const filteredValid = filtered.filter((r) => r.valid);
  const allFilteredSelected = filteredValid.length > 0 && filteredValid.every((r) => selected.has(r.id));
  const filteredIds = new Set(filtered.map((r) => r.id));
  const hiddenSelected = selectedRows.filter((r) => !filteredIds.has(r.id)).length;
  const selectOnlyFiltered = () => setSelected(new Set(filteredValid.map((r) => r.id)));
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

  const goNextFromFiles = async () => {
    if (!campaign || step1Block) return;
    setNotice(null);
    const same = files.length === orderedKeys.length && files.every((f, i) => f.key === orderedKeys[i]);
    if (!same) {
      const loaded = await fetchFiles(campaign, orderedKeys);
      if (!loaded) return;
      applyLoaded(loaded);
    }
    setStep(2);
  };

  const backToFiles = (message: string) => {
    resetWork();
    setStep(1);
    setNotice(message);
    if (campaign) void loadPending(campaign);
  };

  const publish = async () => {
    if (!campaign || publishBlock) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await apiFetch<{ publishId: string; manifest: { contacts: number; rows?: number; publishId?: string } }>(
        `/api/agent/assignments/${encodeURIComponent(campaign)}/publish`,
        {
          method: 'POST',
          json: {
            template,
            phoneColumns,
            phoneMode,
            sources: publishSources(files, selectedRows),
            overrides: publishOverrides(files, selectedRows, phoneColumns, overrides),
          },
        },
      );
      setConfirmOpen(false);
      setPublished({ publishId: res.manifest.publishId ?? res.publishId, messages: res.manifest.contacts, rows: res.manifest.rows ?? selectedRows.length });
      clearDraft(campaign);
      resetWork();
      setTemplate('');
      setStep(1);
      void loadPending(campaign);
      void loadPublications(campaign);
    } catch (e) {
      if (isRedirecting(e)) return;
      setConfirmOpen(false);
      if (e instanceof ApiError && e.status === 409) backToFiles(CHANGED_MESSAGE);
      else if (e instanceof ApiError && e.status === 400 && /3 meses/.test(e.message)) backToFiles(e.message);
      else setPublishError(errorText(e, 'No se pudo publicar.'));
    } finally {
      setPublishing(false);
    }
  };

  const startOver = () => {
    setPublished(null);
    setNotice(null);
    setStep(1);
  };

  const visible = filtered.slice(0, MAX_VISIBLE_ROWS);

  return (
    <PageContainer>
      <PageHeader
        title="Mi asignación"
        description="Elige tu asignación, revisa los contactos, escribe tu mensaje y publícalo para que tu CLI lo envíe."
        actions={
          <Link
            href="/mi-asignacion/historial"
            className="inline-flex h-10 items-center rounded-xl border border-neutral-60 bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Historial de envíos
          </Link>
        }
      />
      <StaleNotice stale={livePending.stale} onRefresh={livePending.refresh} />

      <section className="pernexium-card p-6" aria-labelledby="campana-title">
        <h2 id="campana-title" className="text-base font-semibold">
          Campaña
        </h2>
        <div className="mt-3 max-w-sm">
          {campaigns === null && !campaignsError ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <SearchableSelect label="Campaña" options={(campaigns ?? []).map((c) => ({ value: c, label: c }))} value={campaign} onChange={setCampaign} />
          )}
        </div>
        {campaignsError && <InlineMessage className="mt-3">{campaignsError}</InlineMessage>}
        {campaigns && campaigns.length === 0 && <InlineMessage className="mt-3">No estás habilitado como agente v3 en ninguna campaña</InlineMessage>}
      </section>

      {campaign && published && (
        <section className="pernexium-card mt-4 p-6 text-center sm:p-10" data-testid="publish-success" aria-labelledby="success-title">
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
          <h2 id="success-title" className="mt-3 text-xl font-bold">
            Asignación enviada
          </h2>
          <p className="mt-2 text-sm text-text-muted">
            Publicado: {published.messages} mensaje(s) de {published.rows} fila(s); tu CLI los enviará en su siguiente consulta.
          </p>
          <p className="mt-2 text-xs text-text-light">
            Publicación <span className="font-mono">{published.publishId}</span>
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={startOver}>Nueva asignación</Button>
            <a
              href="#historial"
              className="inline-flex items-center justify-center rounded-xl border border-neutral-60 px-4 py-2 text-sm font-semibold text-primary hover:bg-neutral-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              Ver historial
            </a>
          </div>
        </section>
      )}

      {campaign && !published && (
        <>
          <div className="mt-4">
            <WizardStepper current={step} onGo={setStep} />
          </div>

          <section className="pernexium-card mt-4 p-6" aria-label={`Paso ${step}`} data-testid={`step-panel-${step}`}>
            {notice && <InlineMessage className="mb-4">{notice}</InlineMessage>}

            {step === 1 && (
              <>
                <AssignmentFilesStep
                  pending={pending}
                  error={pendingError}
                  hiddenOld={hiddenOld}
                  checkedKeys={checkedKeys}
                  onToggle={(k) => setCheckedKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}
                  onRefresh={() => void loadPending(campaign)}
                />
                {filesError && <InlineMessage className="mt-3">{filesError}</InlineMessage>}
                <WizardNav step={1} block={step1Block} loading={loadingFiles} onBack={() => undefined} onNext={() => void goNextFromFiles()} />
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-base font-semibold">Contactos</h2>
                <p className="mt-1 text-sm text-text-light">Filtra, ordena y elige a quién enviar y a qué teléfono.</p>

                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-neutral-50 bg-neutral-30 p-4 lg:col-span-1">
                    <h3 className="text-sm font-semibold">Teléfonos</h3>
                    <div className="mt-2">
                      <SearchableMultiselect
                        label="Columnas de teléfono"
                        options={merged.header.map((h) => ({ value: h, label: h }))}
                        selected={phoneColumns}
                        onChange={(v) => setPhoneColumns((cur) => reorderSelection(cur, v, MAX_PHONE_COLUMNS))}
                      />
                    </div>
                    {phoneColumns.length > 0 && (
                      <ol className="mt-2 flex flex-col gap-1" aria-label="Orden de las columnas de teléfono" data-testid="phone-order">
                        {phoneColumns.map((c, i) => (
                          <li key={c} className="flex items-center gap-2 rounded-lg border border-neutral-50 bg-white px-2 py-1 text-sm">
                            <span className="w-5 text-xs text-text-light">{i + 1}.</span>
                            <span className="flex-1 truncate">{c}</span>
                            <Button variant="ghost" size="sm" aria-label={`Subir ${c}`} disabled={i === 0} onClick={() => setPhoneColumns((cur) => movePhoneColumn(cur, i, -1))}>
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Bajar ${c}`}
                              disabled={i === phoneColumns.length - 1}
                              onClick={() => setPhoneColumns((cur) => movePhoneColumn(cur, i, 1))}
                            >
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button variant="ghost" size="sm" aria-label={`Quitar ${c}`} onClick={() => setPhoneColumns((cur) => cur.filter((x) => x !== c))}>
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="mt-3" role="radiogroup" aria-label="Teléfonos a los que se envía">
                      <div className="inline-flex flex-wrap rounded-xl border border-neutral-50 bg-white p-1">
                        {PHONE_MODE_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            role="radio"
                            aria-checked={phoneMode === o.value}
                            onClick={() => setPhoneMode(o.value)}
                            className={`rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
                              phoneMode === o.value ? 'bg-primary text-primary-foreground shadow-card' : 'text-text-muted hover:bg-neutral-40'
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-text-light">
                      {phoneMode === 'first'
                        ? `Un mensaje por crédito, al primer teléfono válido en el orden de arriba (máximo ${MAX_PHONE_COLUMNS} columnas). Puedes elegir otro teléfono por fila en la tabla.`
                        : `El mensaje se envía a cada teléfono válido de las columnas elegidas (máximo ${MAX_PHONE_COLUMNS}), una vez por crédito.`}
                    </p>
                  </div>

                  <div className="lg:col-span-2">
                    <div className="flex flex-wrap items-end gap-3" data-testid="contacts-filters">
                      <Input
                        className="min-w-[180px] flex-1"
                        placeholder="Buscar…"
                        aria-label="Buscar contactos"
                        value={filters.search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {categories.map((c) => (
                        <div key={c} className="w-full sm:w-56">
                          <SearchableMultiselect
                            label={c}
                            hideLabel
                            options={categoryOptions[c] ?? []}
                            selected={filters.values[c] ?? []}
                            onChange={(v) => setFilters((f) => ({ ...f, values: { ...f.values, [c]: v } }))}
                          />
                        </div>
                      ))}
                      {activeRangeColumn && (
                        <div className="flex flex-wrap items-end gap-2">
                          {amounts.length > 1 && (
                            <div className="w-full sm:w-52">
                              <SearchableSelect
                                label="Columna de monto"
                                hideLabel
                                options={amounts.map((a) => ({ value: a, label: a }))}
                                value={activeRangeColumn}
                                onChange={setRangeColumn}
                              />
                            </div>
                          )}
                          <Input
                            className="w-28"
                            inputMode="decimal"
                            placeholder="Mín"
                            aria-label={`${activeRangeColumn} mínimo`}
                            value={filters.ranges[activeRangeColumn]?.min ?? ''}
                            onChange={(e) => setRange(activeRangeColumn, 'min', e.target.value)}
                          />
                          <Input
                            className="w-28"
                            inputMode="decimal"
                            placeholder="Máx"
                            aria-label={`${activeRangeColumn} máximo`}
                            value={filters.ranges[activeRangeColumn]?.max ?? ''}
                            onChange={(e) => setRange(activeRangeColumn, 'max', e.target.value)}
                          />
                        </div>
                      )}
                      {filtersActive && (
                        <Button variant="ghost" onClick={clearFilters}>
                          Limpiar filtros
                        </Button>
                      )}
                    </div>
                    {pills.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2" data-testid="filter-pills">
                        {pills.map((p) => (
                          <FilterPill key={p.key} label={p.label} onRemove={p.onRemove} />
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-text-muted">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} aria-label="Seleccionar todos los resultados" />
                        Seleccionar todos los resultados ({filteredValid.length})
                      </label>
                      {hiddenSelected > 0 && (
                        <span className="flex flex-wrap items-center gap-2 text-xs text-text-light" data-testid="hidden-selected">
                          {hiddenSelected} fila(s) seleccionada(s) fuera de los filtros
                          <Button variant="outline" size="sm" onClick={selectOnlyFiltered}>
                            Seleccionar solo los resultados
                          </Button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {selectedRows.length > 0 && (
                  <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-primary px-5 py-3 text-primary-foreground shadow-card sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-semibold" data-testid="selection-bar">
                      {selectedRows.length} fila(s) seleccionada(s) · {contactCount} teléfono(s)
                    </span>
                    <Button variant="ghost" className="text-primary-foreground hover:bg-primary-10" onClick={() => setSelected(new Set())}>
                      Quitar selección
                    </Button>
                  </div>
                )}

                <TableContainer className="mt-3 max-h-[32rem] overflow-y-auto rounded-xl border border-neutral-50">
                  <table className="w-full min-w-[900px] text-left text-sm" data-testid="contacts-table">
                    <thead className="sticky top-0 bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                      <tr>
                        <th className="w-10 px-3 py-2" />
                        {merged.header.map((h) => (
                          <th key={h} className="px-3 py-2" aria-sort={sort?.column === h ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="flex items-center gap-1 uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                                onClick={() => setTable((t) => ({ ...t, sort: nextSort(t.sort, h) }))}
                              >
                                {h}
                                {sort?.column === h &&
                                  (sort.dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />)}
                              </button>
                              <ColumnFilterButton
                                column={h}
                                active={columnFilterActive(filters.columns[h])}
                                open={openFilter === h}
                                onOpenChange={(o) => setOpenFilter(o ? h : null)}
                                filter={filters.columns[h]}
                                onChange={(next) => setColumn(h, next)}
                                stats={openFilter === h ? openStats : null}
                                formatValue={isPhoneColumn(h) ? maskPhone : undefined}
                              />
                            </div>
                          </th>
                        ))}
                        <th className="px-3 py-2">Teléfono a enviar</th>
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
                          <td className="px-3 py-2" data-testid={`send-phone-${r.id}`}>
                            {r.valid && (
                              <SendPhoneCell row={r} phoneColumns={phoneColumns} sending={sendPhonesOf(r)} override={overrides.get(r.id)} onPick={(p) => setOverride(r.id, p)} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
                <p className="mt-2 text-xs text-text-light">
                  Mostrando {visible.length} de {filtered.length} (total {merged.rows.length})
                </p>
                <WizardNav step={2} block={step2Block} onBack={() => setStep(1)} onNext={() => setStep(3)} />
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="text-base font-semibold">Mensaje</h2>
                <p className="mt-1 text-sm text-text-light">Escribe el mensaje de WhatsApp; las variables se llenan con los datos de cada contacto.</p>
                <div className="mt-4 grid gap-6 lg:grid-cols-5">
                  <div className="lg:col-span-3">
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
                      rows={8}
                      value={template}
                      onChange={(e) => setTemplate(e.target.value)}
                      placeholder="Hola {{first_name}}, tu saldo es {{total_balance}}"
                      invalid={markers.length > 0}
                    />
                    <div className="mt-1 flex justify-between gap-3 text-xs text-text-light">
                      <span>
                        Variables {'{{columna}}'} o {'{columna}'} y expresiones como {'{{total_balance*0.8}}'}; {'\\n'} es salto de línea. Para redondear a 2 decimales usa{' '}
                        {'{{columna*1}}'}.
                      </span>
                      <span className={template.length > MAX_TEMPLATE ? 'text-error-60' : ''}>
                        {template.length}/{MAX_TEMPLATE}
                      </span>
                    </div>
                    {markers.length > 0 && <InlineMessage className="mt-2">{unknownMarkersError(markers)}</InlineMessage>}
                    {noCustomField && (
                      <div className="mt-2" data-testid="no-custom-field-warning">
                        <InlineMessage kind="warning">
                          <p>{NO_CUSTOM_FIELD_WARNING}</p>
                          {suggestions.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="text-xs text-text-light">Insertar:</span>
                              {suggestions.map((c) => (
                                <Button key={c} variant="outline" size="sm" className="font-mono" aria-label={`Insertar {{${c}}}`} onClick={() => insertVariable(c)}>
                                  {`{{${c}}}`}
                                </Button>
                              ))}
                            </div>
                          )}
                        </InlineMessage>
                      </div>
                    )}
                  </div>
                  <div className="lg:col-span-2">
                    <h3 className="text-sm font-semibold">Vista previa</h3>
                    {samples.length === 0 ? (
                      <p className="mt-2 text-sm text-text-light">Escribe el mensaje para ver cómo lo recibirán tus contactos.</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-3" data-testid="message-preview">
                        {samples.map((s) => (
                          <li key={`${s.row.id}|${s.phone}`} className="rounded-xl border border-neutral-50 bg-neutral-30 p-3">
                            <span className="font-mono text-2xs text-text-light">{maskPhone(s.phone)}</span>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{s.text}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <WizardNav step={3} block={step3Block} onBack={() => setStep(2)} onNext={() => setStep(4)} />
              </>
            )}

            {step === 4 && (
              <>
                <WizardSummary
                  campaign={campaign}
                  fileNames={files.map((f) => fileName(f.key))}
                  phoneModeLabel={phoneModeLabel(phoneMode)}
                  phoneColumns={phoneColumns}
                  summary={summary}
                  samples={samples}
                />
                {noCustomField && (
                  <div className="mt-4" data-testid="summary-no-custom-field">
                    <InlineMessage kind="warning">{NO_CUSTOM_FIELD_WARNING}</InlineMessage>
                  </div>
                )}
                {publishError && <InlineMessage className="mt-4">{publishError}</InlineMessage>}
                <WizardNav step={4} block={publishBlock} loading={publishing} onBack={() => setStep(3)} onNext={() => setConfirmOpen(true)} nextLabel="Enviar" />
              </>
            )}
          </section>
        </>
      )}

      {campaign && (
        <section id="historial" className="pernexium-card mt-4 p-6" aria-labelledby="historial-title">
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
                    <th className="px-3 py-2">Mensajes</th>
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
          title="Enviar asignación"
          description={`${campaign} · ${selectedRows.length} fila(s) · ${contactCount} mensaje(s). Tu CLI enviará el mensaje por WhatsApp en su siguiente consulta.`}
          confirmLabel={noCustomField ? 'Enviar de todos modos' : 'Enviar'}
          loading={publishing}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={publish}
        >
          {noCustomField && (
            <InlineMessage kind="warning" className="mb-3">
              Todos los contactos recibirán exactamente el mismo mensaje: tu plantilla no tiene ningún campo personalizado.
            </InlineMessage>
          )}
          {samples[0] && <p className="whitespace-pre-wrap rounded-xl bg-neutral-30 p-3 text-sm text-text-muted">{samples[0].text}</p>}
        </ConfirmDialog>
      )}
    </PageContainer>
  );
}
