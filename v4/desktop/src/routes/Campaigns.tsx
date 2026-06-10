// File: Campaigns
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { uploadCsv, getCampaigns, type UserAccess } from '../lib/api';
import { can, ANA_PERMISSIONS } from '../lib/permissions';
import type { SendProgress } from '../types/ana';

// Sube el CSV de contactos a S3 → csvTrigger genera los send-jobs.
export function Campaigns({ access }: { access: UserAccess | null }) {
  const canDistribute = can(access, ANA_PERMISSIONS.CONTACTS_DISTRIBUTE);
  // Campañas desde el backend (PostgreSQL). Fallback a las del rol.
  const [campaignOptions, setCampaignOptions] = useState<string[]>(
    (access?.campaigns ?? []).filter((c) => c !== '*'),
  );
  useEffect(() => {
    void getCampaigns()
      .then((cs) => {
        if (cs.length) setCampaignOptions(cs);
      })
      .catch(() => {});
  }, []);

  const [file, setFile] = useState<File | null>(null);
  const [template, setTemplate] = useState(
    'Hola {nombre}, tu saldo es {saldo}. Realiza tu pago hoy.',
  );
  const [phoneColumn, setPhoneColumn] = useState('telefono');
  const [countryCode, setCountryCode] = useState('52');
  const [distribute, setDistribute] = useState(false);
  const [campaign, setCampaign] = useState(campaignOptions[0] ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<SendProgress>({ phase: 'idle' });

  // Default de campaña cuando cargan las opciones.
  useEffect(() => {
    if (!campaign && campaignOptions[0]) setCampaign(campaignOptions[0]);
  }, [campaignOptions]);

  // Progreso de envío reportado por el main (1 archivo a la vez + rate limit).
  useEffect(() => {
    const off = window.ana.onWaProgress(setProgress);
    return off;
  }, []);

  async function upload() {
    if (!file) return;
    setSending(true);
    setStatus(null);
    try {
      await uploadCsv(file, {
        filename: file.name,
        template,
        countryCode,
        phoneColumn,
        campaignId: `${file.name}-${countryCode}`,
        distribute: distribute && canDistribute,
        campaign: distribute ? campaign : undefined,
      });
      setStatus(
        distribute && canDistribute
          ? `CSV subido. Contactos se repartirán entre los agentes activos de "${campaign}".`
          : 'CSV subido. Los envíos se ejecutarán al recoger los jobs.',
      );
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? e}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold">Campaña de envío</h1>
      <p className="mt-1 text-sm text-text-light">
        Sube un CSV de contactos. Usa <code className="font-mono">{'{columna}'}</code> en la
        plantilla para interpolar; saldo/monto se formatean como moneda MXN.
      </p>

      <div className="pernexium-card mt-6 space-y-4 p-6">
        <div>
          <label className="block text-sm font-semibold text-text-muted">CSV de contactos</label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-text-muted">Columna teléfono</label>
            <input
              value={phoneColumn}
              onChange={(e) => setPhoneColumn(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-text-muted">Lada país</label>
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-text-muted">Plantilla</label>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
          />
        </div>

        {canDistribute && (
          <div className="rounded-xl bg-primary-light-90 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-text-muted">
              <input
                type="checkbox"
                checked={distribute}
                onChange={(e) => setDistribute(e.target.checked)}
              />
              Repartir contactos entre los agentes (líder)
            </label>
            {distribute && (
              <div className="mt-3">
                <label className="block text-xs text-text-light">Campaña destino</label>
                {campaignOptions.length > 0 ? (
                  <select
                    value={campaign}
                    onChange={(e) => setCampaign(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-neutral-50 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                  >
                    {campaignOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={campaign}
                    onChange={(e) => setCampaign(e.target.value)}
                    placeholder="nombre de campaña"
                    className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                  />
                )}
              </div>
            )}
          </div>
        )}

        <Button onClick={upload} disabled={!file || sending}>
          {sending ? 'Subiendo…' : 'Subir y disparar envíos'}
        </Button>

        {status && (
          <div className="rounded-xl bg-primary-light-90 px-4 py-2 text-sm text-text-muted">
            {status}
          </div>
        )}

        {progress.phase !== 'idle' && progress.total ? (
          <ProgressBar p={progress} />
        ) : null}
      </div>
    </main>
  );
}

function ProgressBar({ p }: { p: SendProgress }) {
  const total = p.total ?? 0;
  const done = p.done ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const waiting = p.phase === 'waiting';
  const fileDone = p.phase === 'fileDone';
  const secs = Math.ceil((p.waitMs ?? 0) / 1000);

  return (
    <div className="space-y-2 rounded-2xl bg-neutral-30 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-text-muted">
          {fileDone ? 'Archivo completado' : 'Enviando'}
          {p.campaignId ? ` · ${p.campaignId}` : ''}
        </span>
        <span className="text-text-light">
          {done}/{total}
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-50">
        <div
          className={`h-full transition-all ${fileDone ? 'bg-secondary' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-light">
        <span>
          Enviados <span className="font-semibold text-secondary">{p.sent ?? 0}</span>
        </span>
        <span>
          Fallidos <span className="font-semibold text-error-70">{p.failed ?? 0}</span>
        </span>
        {waiting && (
          <span className="text-text-muted">
            Pausa anti-bloqueo: siguiente en {secs}s
          </span>
        )}
      </div>
    </div>
  );
}
