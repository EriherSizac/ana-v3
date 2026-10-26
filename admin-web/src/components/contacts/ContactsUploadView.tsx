'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
} from '@/components/ui';
import { useCampaigns } from '@/components/system/useCampaigns';
import {
  assignmentsTooLong,
  buildPlan,
  checkFileSize,
  hasReservedColumn,
  RESERVED_COLUMN_ERROR,
  unknownVariableError,
  variablesResolvingToUploadId,
  detectPhoneColumn,
  parseCsvText,
  planHash,
  previewMessage,
  validateRows,
  type Fleet,
  type Mode,
  type ParsedCsv,
  type Plan,
  type Validation,
} from '@/lib/contacts';
import type { UploadHistoryItem } from '@/lib/contacts/history';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';

const FLEET_OPTIONS = [
  { value: 'v3', label: 'v3 (CLI)' },
  { value: 'v4', label: 'v4 (desktop)' },
];
const MODE_OPTIONS = [
  { value: 'distribute', label: 'Repartir entre agentes habilitados' },
  { value: 'single', label: 'Asignar a un agente' },
];

const POLL_INTERVAL_MS = 5_000;

/** Lee el archivo como UTF-8 (FileReader: compatible con navegadores y jsdom). */
function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}
const POLL_TIMEOUT_MS = 60_000;

type Delivery =
  | { kind: 'v3'; perAgent: Array<{ agent: string; rows: number }> }
  | { kind: 'processing' }
  | { kind: 'v4'; item: UploadHistoryItem }
  | { kind: 'pending' };

export interface ContactsUploadViewProps {
  /** Solo pruebas: intervalo de sondeo. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export function ContactsUploadView({ pollIntervalMs = POLL_INTERVAL_MS, pollTimeoutMs = POLL_TIMEOUT_MS }: ContactsUploadViewProps) {
  const { campaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns();
  const [campaign, setCampaign] = useState<string | null>(null);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [mode, setMode] = useState<Mode>('distribute');
  const [agent, setAgent] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[] | null>(null);
  const [enabledError, setEnabledError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phoneChoice, setPhoneChoice] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [template, setTemplate] = useState('{mensaje}');
  const [countryCode, setCountryCode] = useState('52');
  const [preview, setPreview] = useState<{ plan: Plan; hash: string; validation: Validation; parsed: ParsedCsv } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Agentes habilitados de la campaña y flota.
  useEffect(() => {
    setEnabled(null);
    setEnabledError(null);
    setAgent(null);
    if (!campaign || !fleet) return;
    let cancelled = false;
    apiFetch<{ agents: string[] }>(`/api/campaigns/${encodeURIComponent(campaign)}/enabled-agents?fleet=${fleet}`)
      .then((r) => !cancelled && setEnabled(r.agents))
      .catch((e) => {
        if (cancelled || isRedirecting(e)) return;
        setEnabledError(e instanceof ApiError ? e.message : 'No se pudo leer el roster.');
      });
    return () => {
      cancelled = true;
    };
  }, [campaign, fleet]);

  // Los límites dependen de la flota: al cambiarla se vuelve a elegir el archivo.
  useEffect(() => {
    setFileText(null);
    setFileName(null);
    setFileError(null);
    setPhoneChoice(null);
    if (fileInput.current) fileInput.current.value = '';
  }, [fleet]);

  // Cualquier cambio de configuración invalida la vista previa.
  useEffect(() => {
    setPreview(null);
    setDelivery(null);
    setSendError(null);
  }, [campaign, fleet, mode, agent, fileText, phoneChoice, message, template, countryCode]);

  const parsed = useMemo(() => {
    if (!fileText || !fleet) return null;
    return parseCsvText(fileText, fleet);
  }, [fileText, fleet]);

  const phone = useMemo(() => {
    if (!parsed || 'error' in parsed || !fleet) return null;
    return detectPhoneColumn(parsed.header, fleet, fleet === 'v4' ? phoneChoice : null);
  }, [parsed, fleet, phoneChoice]);

  const validation = useMemo(() => {
    if (!parsed || 'error' in parsed || !phone || 'error' in phone || !fleet) return null;
    return validateRows(parsed, fleet, phone.column);
  }, [parsed, phone, fleet]);

  const hasMessageColumn = !!parsed && !('error' in parsed) && parsed.header.includes('message');
  // Columna reservada y variables que tomarían el uploadId (solo v3).
  const reservedError = fleet === 'v3' && parsed && !('error' in parsed) && hasReservedColumn(parsed.header) ? RESERVED_COLUMN_ERROR : null;
  const variableError = useMemo(() => {
    if (fleet !== 'v3' || !parsed || 'error' in parsed || reservedError) return null;
    const texts = [message, ...(validation?.valid ?? []).map((r) => r.record.message ?? '')];
    const bad = variablesResolvingToUploadId(texts, parsed.header);
    return bad.length ? unknownVariableError(bad) : null;
  }, [fleet, parsed, reservedError, message, validation]);
  const noEnabled = enabled !== null && enabled.length === 0;

  const previewBlock: string | null = (() => {
    if (!campaign || !fleet) return 'Elige campaña y flota';
    if (noEnabled || enabled === null) return 'Sin agentes habilitados';
    if (mode === 'single' && !agent) return 'Elige el agente';
    if (reservedError) return reservedError;
    if (!validation) return 'Carga un archivo válido';
    if (validation.valid.length === 0) return 'No hay filas válidas';
    if (fleet === 'v3' && !hasMessageColumn && !message.trim()) return 'Escribe el mensaje';
    if (variableError) return variableError;
    return null;
  })();

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);
    setFileText(null);
    setFileName(null);
    setPhoneChoice(null);
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
    setFileName(file.name);
    setFileText(await readFileText(file));
  };

  const makePreview = async () => {
    if (!validation || !fleet || !enabled || !parsed || 'error' in parsed) return;
    const plan = buildPlan({ fleet, mode, enabled, agent, rows: validation.valid });
    if ('error' in plan) {
      setSendError(plan.error);
      return;
    }
    setPreview({ plan, hash: await planHash(plan, validation.valid), validation, parsed });
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

  const send = async () => {
    if (!preview || !campaign || !fleet || !fileText || !fileName) return;
    setSending(true);
    setSendError(null);
    try {
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
          csv: fileText,
          ...(fleet === 'v3' ? { message } : { template, countryCode, phoneColumn: phone && 'column' in phone ? phone.column : null }),
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
        const c = campaign;
        const f = fleet;
        apiFetch<{ agents: string[] }>(`/api/campaigns/${encodeURIComponent(c)}/enabled-agents?fleet=${f}`)
          .then((r) => setEnabled(r.agents))
          .catch(() => {});
      } else {
        setSendError(e instanceof ApiError ? e.message : 'No se pudo entregar la carga.');
      }
    } finally {
      setSending(false);
    }
  };

  const tooLong = preview && fleet === 'v4' && assignmentsTooLong(preview.plan);

  return (
    <PageContainer>
      <PageHeader
        title="Contactos"
        description="Carga una lista de contactos y entrégala a los agentes habilitados de una campaña en v3 o v4."
        actions={
          <Link
            href="/contactos/historial"
            className="inline-flex h-10 items-center rounded-xl border border-neutral-60 bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Historial
          </Link>
        }
      />

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
              options={(enabled ?? []).map((a) => ({ value: a, label: a }))}
              value={agent}
              onChange={setAgent}
              disabled={!enabled || enabled.length === 0}
              emptyLabel="Elige un agente habilitado"
            />
          )}
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
            {enabled.length} agente(s) habilitado(s) en {campaign} ({fleet}).
          </p>
        )}
      </section>

      <section className="pernexium-card mt-4 p-6" aria-labelledby="archivo-title">
        <h2 id="archivo-title" className="text-base font-semibold">
          2. Archivo
        </h2>
        <p className="mt-1 text-sm text-text-light">
          CSV UTF-8 con encabezado. Límites: v3 hasta 4 MB y 20 000 filas; v4 hasta 10 MB y 50 000 filas.
        </p>
        <div className="mt-4">
          <Label htmlFor="csv-file">Archivo CSV</Label>
          <input
            ref={fileInput}
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            disabled={!fleet || noEnabled || enabled === null}
            onChange={(e) => void onFile(e)}
            className="block w-full text-sm text-text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground disabled:opacity-60"
          />
        </div>
        {fileError && <InlineMessage className="mt-3">{fileError}</InlineMessage>}
        {parsed && 'error' in parsed && <InlineMessage className="mt-3">{parsed.error}</InlineMessage>}
        {phone && 'error' in phone && fleet === 'v3' && <InlineMessage className="mt-3">{phone.error}</InlineMessage>}
        {reservedError && <InlineMessage className="mt-3">{reservedError}</InlineMessage>}
        {variableError && <InlineMessage className="mt-3">{variableError}</InlineMessage>}
        {parsed && !('error' in parsed) && fleet === 'v4' && (
          <div className="mt-4 max-w-xs">
            <SearchableSelect
              label="Columna de teléfono"
              options={parsed.header.map((h) => ({ value: h, label: h }))}
              value={phone && 'column' in phone ? phone.column : phoneChoice}
              onChange={setPhoneChoice}
              emptyLabel="Elige la columna"
            />
          </div>
        )}

        {validation && (
          <div className="mt-4" data-testid="validation-summary">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="success">{validation.valid.length} válidas</Badge>
              <Badge variant={validation.invalid.length ? 'error' : 'muted'}>{validation.invalid.length} inválidas</Badge>
              <Badge variant="outline">{validation.total} filas</Badge>
            </div>
            {validation.invalid.length > 0 && (
              <TableContainer className="mt-3 max-h-64 overflow-y-auto">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                    <tr>
                      <th className="px-3 py-2">Fila</th>
                      <th className="px-3 py-2">Causa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.invalid.slice(0, 100).map((r) => (
                      <tr key={r.rowNumber} className="border-t border-neutral-40">
                        <td className="px-3 py-1.5 font-mono text-xs">{r.rowNumber}</td>
                        <td className="px-3 py-1.5">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            )}
            {validation.invalid.length > 100 && <p className="mt-2 text-xs text-text-light">Se muestran las primeras 100 filas inválidas.</p>}
          </div>
        )}
      </section>

      <section className="pernexium-card mt-4 p-6" aria-labelledby="mensaje-title">
        <h2 id="mensaje-title" className="text-base font-semibold">
          3. Mensaje
        </h2>
        {fleet === 'v4' ? (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <Label htmlFor="template">Plantilla</Label>
              <Input id="template" value={template} onChange={(e) => setTemplate(e.target.value)} />
              <p className="mt-1 text-xs text-text-light">Variables {'{columna}'}; {'{mensaje}'} usa la columna mensaje del CSV.</p>
            </div>
            <div>
              <Label htmlFor="country">Código de país</Label>
              <Input id="country" inputMode="numeric" value={countryCode} onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Label htmlFor="message">Mensaje plantilla {hasMessageColumn ? '(opcional: el CSV ya trae columna message)' : ''}</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hola {first_name}, tu saldo es {total_balance}"
              disabled={hasMessageColumn}
            />
          </div>
        )}
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
            4. Vista previa del reparto
          </h2>
          <p className="mt-1 text-sm text-text-light">
            {preview.validation.valid.length} contactos válidos para {preview.plan.agents.length} agente(s). El CLI entrega una carga a la vez por agente, en orden de antigüedad.
          </p>
          {tooLong && (
            <InlineMessage className="mt-3">Demasiados agentes para un reparto en v4 (assignments supera 1500 caracteres). Usa menos agentes.</InlineMessage>
          )}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {preview.plan.agents.map((a) => {
              const rows = preview.validation.valid.filter((_, i) => preview.plan.assignment[i] === a).slice(0, 5);
              return (
                <div key={a} className="rounded-xl border border-neutral-50 p-4" data-testid={`preview-${a}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-primary">{a}</span>
                    <Badge>{preview.plan.counts[a] ?? 0} contactos</Badge>
                  </div>
                  <ul className="mt-2 flex flex-col gap-1">
                    {rows.map((r) => (
                      <li key={r.rowNumber} className="text-xs text-text-muted">
                        <span className="font-mono">{r.phone}</span>
                        <span className="block whitespace-pre-wrap text-text-light">
                          {previewMessage(fleet!, r.record, fleet === 'v3' ? message : template)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
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
              <InlineMessage kind="success">Carga entregada</InlineMessage>
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
          description={`${campaign} · ${fleet} · ${mode === 'distribute' ? 'Repartir' : 'Asignar a un agente'} · ${preview.validation.valid.length} contactos. Los agentes empezarán a enviar mensajes por WhatsApp.`}
          confirmLabel="Entregar"
          loading={sending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={send}
        >
          <ul className="text-sm text-text-muted">
            {preview.plan.agents.map((a) => (
              <li key={a}>
                <span className="font-mono">{a}</span>: {preview.plan.counts[a] ?? 0}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </PageContainer>
  );
}
