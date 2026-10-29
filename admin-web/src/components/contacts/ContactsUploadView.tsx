'use client';

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  ConfirmDialog,
  InlineMessage,
  Input,
  Label,
  PageContainer,
  PageHeader,
  SearchableSelect,
  Skeleton,
  TableContainer,
  Textarea,
  Toggle,
} from '@/components/ui';
import { useCampaigns } from '@/components/system/useCampaigns';
import { StaleNotice } from '@/components/system/Realtime';
import { useRealtimeRefresh } from '@/lib/realtime/RealtimeProvider';
import { assignmentsTooLong, checkFileSize, DELIMITER_LABEL, LIMITS, usesSendColumn, V3_INLINE_MAX_BYTES, V4_SEND_COLUMN, type Fleet, type Mode } from '@/lib/contacts';
import type { CheckSummary, PlanSummary, Progress, ReadSummary } from '@/lib/contacts/pipeline';
import { CancelledError, createContactsProcessor, type ContactsProcessor } from '@/lib/contacts/processor';
import type { UploadHistoryItem } from '@/lib/contacts/history';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';
import { WaUploadNotice } from './WaUploadNotice';

const FLEET_OPTIONS = [
  { value: 'v3', label: 'v3 (CLI)' },
  { value: 'v4', label: 'v4 (desktop)' },
];
const MODE_OPTIONS = [
  { value: 'distribute', label: 'Repartir entre agentes habilitados' },
  { value: 'single', label: 'Asignar a un agente' },
];

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 60_000;
/** Líneas del texto pegado que se muestran como muestra (el texto completo no se pinta). */
const PASTE_PREVIEW_LINES = 3;
const PASTE_PREVIEW_CHARS = 160;

const enabledUrl = (campaign: string, fleet: Fleet, includeSupervisors: boolean) =>
  `/api/campaigns/${encodeURIComponent(campaign)}/enabled-agents?fleet=${fleet}${includeSupervisors ? '&includeSupervisors=1' : ''}`;

type EnabledResponse = { agents: string[]; supervisors?: string[] };

/** Lee los bytes del archivo (FileReader: compatible con navegadores y jsdom). */
function readFileBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

const formatBytes = (n: number): string => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Resumen del texto pegado sin guardarlo en el estado de React: líneas, tamaño y primeras líneas. */
function pasteInfo(text: string): { lines: number; bytes: number; sample: string[] } {
  let lines = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lines++;
  if (text && !text.endsWith('\n')) lines++;
  const head = text.slice(0, PASTE_PREVIEW_CHARS * PASTE_PREVIEW_LINES * 2).split(/\r?\n/, PASTE_PREVIEW_LINES);
  return {
    lines,
    bytes: new Blob([text]).size,
    sample: head.map((l) => (l.length > PASTE_PREVIEW_CHARS ? `${l.slice(0, PASTE_PREVIEW_CHARS)}…` : l).replace(/\t/g, ' │ ')),
  };
}

const PHASE_LABEL: Record<Progress['phase'], string> = { lectura: 'Lectura', validación: 'Validación', reparto: 'Reparto' };

type Delivery =
  | { kind: 'v3'; perAgent: Array<{ agent: string; rows: number }> }
  | { kind: 'processing' }
  | { kind: 'v4'; item: UploadHistoryItem }
  | { kind: 'pending' };

export interface ContactsUploadViewProps {
  /** Solo pruebas: intervalo de sondeo. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Solo pruebas: procesador (Worker falso). */
  createProcessor?: () => ContactsProcessor;
}

export function ContactsUploadView({ pollIntervalMs = POLL_INTERVAL_MS, pollTimeoutMs = POLL_TIMEOUT_MS, createProcessor = createContactsProcessor }: ContactsUploadViewProps) {
  const { campaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns();
  const [campaign, setCampaign] = useState<string | null>(null);
  // add-supervisor-contact-access: v3 preseleccionada.
  const [fleet, setFleet] = useState<Fleet | null>('v3');
  const [includeSupervisors, setIncludeSupervisors] = useState(false);
  const [supervisors, setSupervisors] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('distribute');
  const [agent, setAgent] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[] | null>(null);
  const [enabledError, setEnabledError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // support-crm-base-upload: "Archivo" o "Pegar desde Excel".
  const [source, setSource] = useState<'file' | 'paste'>('file');
  // El texto pegado no vive en el estado (megabytes): solo su resumen.
  const [pasted, setPasted] = useState<{ lines: number; bytes: number; sample: string[] } | null>(null);
  const [typed, setTyped] = useState(false);
  const pastedText = useRef<string | null>(null);
  const pasteArea = useRef<HTMLTextAreaElement>(null);
  const [read, setRead] = useState<ReadSummary | null>(null);
  const [check, setCheck] = useState<CheckSummary | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [phoneChoice, setPhoneChoice] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState('52');
  const [preview, setPreview] = useState<PlanSummary | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStep, setSendStep] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  // Sube al recibir un aviso realtime: vuelve a leer los destinatarios habilitados.
  const [rosterVersion, setRosterVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const processor = useRef<ContactsProcessor | null>(null);
  const proc = (): ContactsProcessor => (processor.current ??= createProcessor());

  useEffect(
    () => () => {
      processor.current?.dispose();
      processor.current = null;
    },
    [],
  );

  // Destinatarios habilitados de la campaña y flota (con supervisores si el toggle está encendido).
  useEffect(() => {
    setEnabled(null);
    setSupervisors([]);
    setEnabledError(null);
    setAgent(null);
    if (!campaign || !fleet) return;
    let cancelled = false;
    apiFetch<EnabledResponse>(enabledUrl(campaign, fleet, includeSupervisors))
      .then((r) => {
        if (cancelled) return;
        setEnabled(r.agents);
        setSupervisors(r.supervisors ?? []);
      })
      .catch((e) => {
        if (cancelled || isRedirecting(e)) return;
        setEnabledError(e instanceof ApiError ? e.message : 'No se pudo leer el roster.');
      });
    return () => {
      cancelled = true;
    };
  }, [campaign, fleet, includeSupervisors, rosterVersion]);

  const clearData = () => {
    processor.current?.cancel();
    setProgress(null);
    setFileError(null);
    setRead(null);
    setCheck(null);
    setFileName(null);
    setPhoneChoice(null);
  };

  // Los límites dependen de la flota: al cambiarla se vuelve a elegir el archivo.
  useEffect(() => {
    clearData();
    if (fileInput.current) fileInput.current.value = '';
  }, [fleet]);

  // Cualquier cambio de configuración invalida la vista previa.
  useEffect(() => {
    setPreview(null);
    setDelivery(null);
    setSendError(null);
  }, [campaign, fleet, mode, agent, read, check, countryCode, includeSupervisors]);

  /** Ejecuta una fase en el Worker con progreso; `null` si se canceló. */
  const runPhase = async <T,>(fn: (p: ContactsProcessor) => Promise<T>): Promise<T | null> => {
    try {
      return await fn(proc());
    } catch (e) {
      if (e instanceof CancelledError) return null;
      setFileError(e instanceof Error ? e.message : 'No se pudo procesar el archivo');
      return null;
    } finally {
      setProgress(null);
    }
  };

  const validate = async (choice: string | null) => {
    setCheck(null);
    setProgress({ phase: 'validación', done: 0, total: 1 });
    const res = await runPhase((p) => p.check(choice, setProgress));
    if (!res) return;
    if ('error' in res) setFileError(res.error);
    else setCheck(res);
  };

  /** Lee (archivo o texto) y valida en el Worker. */
  const load = async (input: { bytes?: Uint8Array; text?: string; what: string }, name: string) => {
    if (!fleet) return;
    setProgress({ phase: 'lectura', done: 0, total: 1 });
    const res = await runPhase((p) => p.read({ fleet, ...input }, setProgress));
    if (!res) return;
    if ('error' in res) {
      setFileError(res.error);
      return;
    }
    setFileName(name);
    setRead(res);
    await validate(null);
  };

  const cancelProcessing = () => {
    processor.current?.cancel();
    setProgress(null);
    setRead(null);
    setCheck(null);
    setFileName(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const switchSource = (next: 'file' | 'paste') => {
    if (next === source) return;
    clearData();
    pastedText.current = null;
    setPasted(null);
    setTyped(false);
    setSource(next);
  };

  // Pegado: el texto se toma del portapapeles y no se pinta en el área de texto.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    pastedText.current = text;
    if (pasteArea.current) pasteArea.current.value = '';
    setTyped(false);
    setPasted(pasteInfo(text));
  };

  const clearPaste = () => {
    pastedText.current = null;
    setPasted(null);
    setTyped(false);
    if (pasteArea.current) pasteArea.current.value = '';
    clearData();
  };

  /** Texto pegado de Excel (TSV): mismas reglas y límites que un archivo. */
  const applyPasted = () => {
    clearData();
    if (!fleet) return;
    const text = pastedText.current ?? pasteArea.current?.value ?? '';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
    void load({ text, what: 'El texto pegado' }, `pegado-excel-${stamp}.csv`);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    clearData();
    if (!file || !fleet) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('El archivo debe ser .csv');
      return;
    }
    const sizeError = checkFileSize(file.size, fleet);
    if (sizeError) {
      setFileError(sizeError);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setProgress({ phase: 'lectura', done: 0, total: 1 });
    let bytes: Uint8Array;
    try {
      bytes = await readFileBytes(file);
    } catch {
      setProgress(null);
      setFileError('No se pudo leer el archivo');
      return;
    }
    await load({ bytes, what: 'El archivo' }, file.name);
  };

  const onPhoneChoice = (v: string | null) => {
    setPhoneChoice(v);
    void validate(v);
  };

  const reservedError = check?.reservedError ?? null;
  const variableError = check?.variableError ?? null;
  const sendColumnBlock = check?.sendColumnError ?? null;
  const phoneColumn = check?.phoneColumn ?? null;
  const noEnabled = enabled !== null && enabled.length === 0;
  const busy = progress !== null;

  const previewBlock: string | null = (() => {
    if (!campaign || !fleet) return 'Elige campaña y flota';
    if (noEnabled || enabled === null) return 'Sin agentes habilitados';
    if (mode === 'single' && !agent) return 'Elige el agente';
    if (busy) return 'Procesando el archivo';
    if (reservedError) return reservedError;
    if (sendColumnBlock) return sendColumnBlock;
    if (!check || !phoneColumn) return 'Carga un archivo válido';
    if (check.validCount === 0) return 'No hay filas válidas';
    if (variableError) return variableError;
    return null;
  })();

  const makePreview = async () => {
    if (!check || !fleet || !enabled) return;
    setProgress({ phase: 'reparto', done: 0, total: check.validCount });
    const res = await runPhase((p) => p.plan({ mode, enabled, agent }, setProgress));
    if (!res) return;
    if ('error' in res) {
      setSendError(res.error);
      return;
    }
    setPreview(res);
  };

  const pollV4 = async (srcKey: string) => {
    const start = Date.now();
    while (Date.now() - start < pollTimeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      try {
        const res = await apiFetch<{ items: UploadHistoryItem[] }>(
          `/api/campaigns/${encodeURIComponent(campaign!)}/uploads?fleet=v4&srcKey=${encodeURIComponent(srcKey)}`,
        );
        if (res.items[0]) {
          setDelivery({ kind: 'v4', item: res.items[0] });
          return;
        }
      } catch (e) {
        if (isRedirecting(e)) return;
      }
    }
    setDelivery({ kind: 'pending' });
  };

  /** Carga v3 grande: URL firmada y PUT directo a S3 (el BFF no recibe el archivo). */
  const uploadLarge = async (blob: Blob): Promise<{ uploadId: string; sourceKey: string }> => {
    setSendStep('Subiendo archivo…');
    const signed = await apiFetch<{ uploadId: string; sourceKey: string; url: string; headers?: Record<string, string> }>(
      `/api/campaigns/${encodeURIComponent(campaign!)}/uploads/presign`,
      { method: 'POST', json: { fleet: 'v3', bytes: blob.size } },
    );
    let put: Response;
    try {
      put = await fetch(signed.url, { method: 'PUT', body: blob, headers: signed.headers ?? { 'Content-Type': 'text/csv' } });
    } catch {
      throw new ApiError(502, 'upstream_unavailable', 'No se pudo subir el archivo. Intenta de nuevo.');
    }
    if (!put.ok) throw new ApiError(502, 'upstream_unavailable', 'No se pudo subir el archivo. Intenta de nuevo.');
    setSendStep('Repartiendo…');
    return { uploadId: signed.uploadId, sourceKey: signed.sourceKey };
  };

  const send = async () => {
    if (!preview || !campaign || !fleet || !fileName) return;
    setSending(true);
    setSendError(null);
    try {
      const payload = preview.payload;
      const data = payload.kind === 's3' ? await uploadLarge(payload.blob) : { csv: payload.csv };
      const res = await apiFetch<
        | { fleet: 'v3'; manifest: { perAgent: Array<{ agent: string; rows: number }> } }
        | { fleet: 'v4'; status: 'processing'; srcKey: string }
      >(`/api/campaigns/${encodeURIComponent(campaign)}/uploads`, {
        method: 'POST',
        json: {
          fleet,
          mode,
          agent,
          fileName,
          ...data,
          includeSupervisors,
          ...(fleet === 'v4' ? { countryCode, phoneColumn } : {}),
          plan: { agents: preview.plan.agents, counts: preview.plan.counts, hash: preview.hash },
        },
      });
      setConfirmOpen(false);
      if (res.fleet === 'v3') {
        setDelivery({ kind: 'v3', perAgent: res.manifest.perAgent.map((p) => ({ agent: p.agent, rows: p.rows })) });
      } else {
        setDelivery({ kind: 'processing' });
        void pollV4(res.srcKey);
      }
    } catch (e) {
      if (isRedirecting(e)) return;
      setConfirmOpen(false);
      if (e instanceof ApiError && e.status === 409) {
        setPreview(null);
        setSendError('El roster cambió; revisa la nueva vista previa');
        // Recarga los habilitados para la nueva vista previa.
        apiFetch<EnabledResponse>(enabledUrl(campaign, fleet, includeSupervisors))
          .then((r) => {
            setEnabled(r.agents);
            setSupervisors(r.supervisors ?? []);
          })
          .catch(() => {});
      } else {
        setSendError(e instanceof ApiError ? e.message : 'No se pudo entregar la carga.');
      }
    } finally {
      setSending(false);
      setSendStep(null);
    }
  };

  const tooLong = preview && fleet === 'v4' && assignmentsTooLong(preview.plan);
  const isSupervisor = (u: string) => supervisors.includes(u);
  const labelOf = (u: string) => (isSupervisor(u) ? `${u} (Supervisor)` : u);

  // Recarga en vivo (add-realtime-admin-web): con una carga en curso en el
  // asistente (archivo, agente elegido, envío o confirmación) → aviso en lugar de recargar.
  const live = useRealtimeRefresh({
    types: ['uploads.changed', 'review.changed', 'roster.changed'],
    campaign,
    reload: () => setRosterVersion((v) => v + 1),
    isDirty: () => read !== null || busy || agent !== null || sending || confirmOpen,
  });

  const pct = progress ? Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100)) : 0;
  const inputsDisabled = !fleet || noEnabled || enabled === null || busy;

  return (
    <PageContainer>
      <PageHeader
        title="Contactos"
        description="Carga una lista de contactos y repártela entre los agentes habilitados de una campaña en v3 o v4. Cada agente escribe su mensaje en Mi asignación."
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

      <section className="pernexium-card p-6" aria-labelledby="destino-title">
        <h2 id="destino-title" className="text-base font-semibold">
          1. Destino
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {campaignsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <SearchableSelect label="Campaña" options={campaigns.map((c) => ({ value: c, label: c }))} value={campaign} onChange={setCampaign} />
          )}
          <SearchableSelect label="Flota" options={FLEET_OPTIONS} value={fleet} onChange={(v) => setFleet(v as Fleet)} />
          <SearchableSelect label="Modo" options={MODE_OPTIONS} value={mode} onChange={(v) => setMode(v as Mode)} />
          {mode === 'single' && (
            <SearchableSelect
              label="Agente"
              options={(enabled ?? []).map((a) => ({ value: a, label: labelOf(a) }))}
              value={agent}
              onChange={setAgent}
              disabled={!enabled || enabled.length === 0}
              emptyLabel="Elige un agente habilitado"
            />
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Toggle checked={includeSupervisors} label="Incluir supervisores" onChange={() => setIncludeSupervisors((v) => !v)} />
          <span className="text-sm text-text-muted">Incluir supervisores</span>
          <span className="text-xs text-text-light">Los supervisores habilitados también reciben contactos.</span>
        </div>
        {campaignsError && <InlineMessage className="mt-3">{campaignsError}</InlineMessage>}
        {enabledError && <InlineMessage className="mt-3">{enabledError}</InlineMessage>}
        {campaign && fleet && enabled === null && !enabledError && <Skeleton className="mt-3 h-4 w-64" />}
        {noEnabled && (
          <InlineMessage className="mt-3">
            No hay agentes habilitados en esta campaña para {fleet}.{' '}
            <Link href="/agentes" className="font-semibold underline">
              Ir a Agentes
            </Link>
          </InlineMessage>
        )}
        {enabled && enabled.length > 0 && (
          <p className="mt-3 text-xs text-text-light">
            {enabled.length} destinatario(s) habilitado(s) en {campaign} ({fleet}){supervisors.length > 0 ? `, ${supervisors.length} supervisor(es)` : ''}.
          </p>
        )}
      </section>

      <section className="pernexium-card mt-4 p-6" aria-labelledby="archivo-title">
        <h2 id="archivo-title" className="text-base font-semibold">
          2. Archivo
        </h2>
        <p className="mt-1 text-sm text-text-light">
          CSV con encabezado (UTF-8 o Windows-1252; coma, punto y coma o tabulador), por ejemplo la base del CRM tal cual. Límites: v3 hasta{' '}
          {LIMITS.v3.label} y {LIMITS.v3.maxRows.toLocaleString('es-MX')} filas (más de 4 MB se sube directo a almacenamiento); v4 hasta {LIMITS.v4.label} y{' '}
          {LIMITS.v4.maxRows.toLocaleString('es-MX')} filas (máximo del procesador de v4).
        </p>
        <div className="mt-4 inline-flex rounded-xl border border-neutral-50 p-1" role="tablist" aria-label="Origen de los contactos">
          {(
            [
              ['file', 'Archivo'],
              ['paste', 'Pegar'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={source === value}
              onClick={() => switchSource(value)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
                source === value ? 'bg-primary text-primary-foreground' : 'text-text-muted hover:bg-primary-light-90'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {source === 'file' ? (
          <div className="mt-4" role="tabpanel">
            <Label htmlFor="csv-file">Archivo CSV</Label>
            <input
              ref={fileInput}
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              disabled={inputsDisabled}
              onChange={(e) => void onFile(e)}
              className="block w-full text-sm text-text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground disabled:opacity-60"
            />
          </div>
        ) : (
          <div className="mt-4" role="tabpanel">
            <Label htmlFor="paste-area">Pegar desde Excel</Label>
            <Textarea
              ref={pasteArea}
              id="paste-area"
              rows={pasted ? 2 : 8}
              defaultValue=""
              onPaste={onPaste}
              onChange={(e) => setTyped(e.target.value.trim() !== '')}
              disabled={inputsDisabled}
              placeholder={pasted ? 'Pega de nuevo para reemplazar los datos' : 'Copia en Excel el rango con la fila de encabezados y pégalo aquí'}
              className="font-mono text-xs"
            />
            {pasted && (
              <div className="mt-2 rounded-xl border border-neutral-50 p-3" data-testid="paste-summary">
                <p className="text-xs font-semibold text-text-muted">
                  Datos pegados: {pasted.lines.toLocaleString('es-MX')} líneas · {formatBytes(pasted.bytes)}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs text-text-light">
                  {pasted.sample.map((l, i) => (
                    <li key={i} className="truncate">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={applyPasted} disabled={(!pasted && !typed) || inputsDisabled}>
                Usar datos pegados
              </Button>
              {pasted && (
                <Button variant="ghost" onClick={clearPaste} disabled={busy}>
                  Quitar datos pegados
                </Button>
              )}
              <span className="text-xs text-text-light">La primera fila debe ser el encabezado. Mismos límites que un archivo.</span>
            </div>
          </div>
        )}
        {progress && (
          <div className="mt-4 max-w-xl" data-testid="processing">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>
                {PHASE_LABEL[progress.phase]} · {pct}%
                {progress.total > 1 ? ` (${progress.done.toLocaleString('es-MX')} de ${progress.total.toLocaleString('es-MX')} filas)` : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={cancelProcessing}>
                Cancelar
              </Button>
            </div>
            <div
              role="progressbar"
              aria-label={`Procesando: ${PHASE_LABEL[progress.phase]}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-40"
            >
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {fileError && <InlineMessage className="mt-3">{fileError}</InlineMessage>}
        {read && (
          <div className="mt-3 flex flex-col gap-1 text-xs text-text-light" data-testid="read-summary">
            <span>
              {read.rows} filas · {read.header.length} columnas · Delimitador: {DELIMITER_LABEL[read.delimiter]}
              {read.encoding ? ` · Codificación: ${read.encoding}` : ''}
            </span>
            {read.phoneColumns.length > 0 && <span>Columnas de teléfono: {read.phoneColumns.join(', ')}</span>}
            {read.joinedFields > 0 && <span>{read.joinedFields} campo(s) con salto de línea se unieron en una sola línea.</span>}
            {read.convertedDates > 0 && <span>{read.convertedDates} fecha(s) de Excel convertidas a dd/mm/aaaa.</span>}
            {read.renamed.length > 0 && <span>Columnas renombradas: {read.renamed.join(', ')}</span>}
            {fleet === 'v3' && read.bytes > V3_INLINE_MAX_BYTES && <span>Archivo grande: se sube directo a almacenamiento al confirmar.</span>}
          </div>
        )}
        {check?.phoneError && fleet === 'v3' && <InlineMessage className="mt-3">{check.phoneError}</InlineMessage>}
        {reservedError && <InlineMessage className="mt-3">{reservedError}</InlineMessage>}
        {variableError && <InlineMessage className="mt-3">{variableError}</InlineMessage>}
        {read && fleet === 'v4' && (
          <div className="mt-4 max-w-xs">
            <SearchableSelect
              label="Columna de teléfono"
              options={read.header.map((h) => ({ value: h, label: h }))}
              value={phoneColumn ?? phoneChoice}
              onChange={onPhoneChoice}
              disabled={busy}
              emptyLabel="Elige la columna"
            />
            {phoneColumn && usesSendColumn(phoneColumn) && (
              <p className="mt-1 text-xs text-text-light">
                Si {phoneColumn} está vacío se usa el siguiente telefono_N con número; v4 recibe la columna {V4_SEND_COLUMN}.
              </p>
            )}
          </div>
        )}
        {sendColumnBlock && <InlineMessage className="mt-3">{sendColumnBlock}</InlineMessage>}

        {check && phoneColumn && (
          <div className="mt-4" data-testid="validation-summary">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="success">{check.validCount} válidas</Badge>
              <Badge variant={check.invalidCount ? 'error' : 'muted'}>{check.invalidCount} inválidas</Badge>
              <Badge variant="outline">{check.total} filas</Badge>
            </div>
            <p className="mt-2 text-xs text-text-light">
              Los duplicados se detectan por crédito (id_credito): un mismo teléfono con créditos distintos se conserva. Las filas sin crédito se comparan por teléfono.
            </p>
            {check.invalid.length > 0 && (
              <TableContainer className="mt-3 max-h-64 overflow-y-auto">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                    <tr>
                      <th className="px-3 py-2">Fila</th>
                      <th className="px-3 py-2">Causa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.invalid.map((r) => (
                      <tr key={r.rowNumber} className="border-t border-neutral-40">
                        <td className="px-3 py-1.5 font-mono text-xs">{r.rowNumber}</td>
                        <td className="px-3 py-1.5">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            )}
            {check.invalidCount > check.invalid.length && <p className="mt-2 text-xs text-text-light">Se muestran las primeras 100 filas inválidas.</p>}
          </div>
        )}

        {fleet === 'v4' && (
          <div className="mt-4 max-w-xs">
            <Label htmlFor="country">Código de país</Label>
            <Input id="country" inputMode="numeric" value={countryCode} onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
        )}
        <p className="mt-4 text-xs text-text-light">
          El mensaje lo escribe cada agente al revisar su asignación ({fleet === 'v4' ? 'desktop v4' : 'Mi asignación en ANA Admin'}).
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void makePreview()} disabled={!!previewBlock}>
            Vista previa
          </Button>
          {previewBlock && <span className="text-xs text-text-light">{previewBlock}</span>}
        </div>
      </section>

      {sendError && <InlineMessage className="mt-4">{sendError}</InlineMessage>}

      {preview && (
        <section className="pernexium-card mt-4 p-6" aria-labelledby="preview-title" data-testid="preview">
          <h2 id="preview-title" className="text-base font-semibold">
            3. Vista previa del reparto
          </h2>
          <p className="mt-1 text-sm text-text-light">
            {preview.validCount} contactos válidos para {preview.plan.agents.length} agente(s). El CLI entrega una carga a la vez por agente, en orden de antigüedad.
          </p>
          {campaign && <WaUploadNotice campaign={campaign} phones={preview.phones} />}
          {tooLong && (
            <InlineMessage className="mt-3">Demasiados agentes para un reparto en v4 (assignments supera 1500 caracteres). Usa menos agentes.</InlineMessage>
          )}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {preview.plan.agents.map((a) => (
              <div key={a} className="rounded-xl border border-neutral-50 p-4" data-testid={`preview-${a}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">{a}</span>
                    {isSupervisor(a) && <Badge variant="secondary">Supervisor</Badge>}
                  </span>
                  <Badge>{preview.plan.counts[a] ?? 0} contactos</Badge>
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {(preview.samples[a] ?? []).map((r) => (
                    <li key={r.rowNumber} className="text-xs text-text-muted">
                      <span className="font-mono">{r.phone}</span>
                      {r.name && <span className="ml-2 text-text-light">{r.name}</span>}
                      {r.credit && <span className="ml-2 text-text-light">· crédito {r.credit}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <Button className="mt-4" onClick={() => setConfirmOpen(true)} disabled={!!tooLong || !!delivery}>
            Confirmar carga
          </Button>
        </section>
      )}

      {delivery && (
        <section className="pernexium-card mt-4 p-6" aria-live="polite" data-testid="delivery">
          {delivery.kind === 'v3' && (
            <>
              <InlineMessage kind="success">Carga entregada. Cada agente la verá en Mi asignación para escribir su mensaje y publicarla.</InlineMessage>
              <ul className="mt-3 text-sm">
                {delivery.perAgent.map((p) => (
                  <li key={p.agent}>
                    <span className="font-mono">{p.agent}</span>: {p.rows} contactos
                  </li>
                ))}
              </ul>
            </>
          )}
          {delivery.kind === 'processing' && (
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded-full" />
              <span className="text-sm text-text-muted">Procesando</span>
            </div>
          )}
          {delivery.kind === 'v4' && (
            <>
              <InlineMessage kind={delivery.item.status === 'processed' ? 'success' : 'error'}>
                {delivery.item.status === 'processed' ? `Carga procesada: ${delivery.item.validRows ?? 0} contactos` : `Carga rechazada (${delivery.item.reason ?? 'sin causa'})`}
              </InlineMessage>
              <ul className="mt-3 text-sm">
                {delivery.item.perAgent.map((p) => (
                  <li key={p.agent}>
                    <span className="font-mono">{p.agent}</span>: {p.rows} jobs
                  </li>
                ))}
              </ul>
            </>
          )}
          {delivery.kind === 'pending' && (
            <InlineMessage kind="success">
              Sigue en proceso; revisa el{' '}
              <Link href="/contactos/historial" className="font-semibold underline">
                historial
              </Link>
            </InlineMessage>
          )}
        </section>
      )}

      {preview && campaign && fleet && (
        <ConfirmDialog
          open={confirmOpen}
          title="Confirmar carga"
          description={`${campaign} · ${fleet} · ${mode === 'distribute' ? 'Repartir' : 'Asignar a un agente'} · ${preview.validCount} contactos. Los agentes empezarán a enviar mensajes por WhatsApp.`}
          confirmLabel={sendStep ?? 'Entregar'}
          loading={sending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={send}
        >
          <ul className="text-sm text-text-muted">
            {preview.plan.agents.map((a) => (
              <li key={a}>
                <span className="font-mono">{labelOf(a)}</span>: {preview.plan.counts[a] ?? 0}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </PageContainer>
  );
}
