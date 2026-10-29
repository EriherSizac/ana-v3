'use client';

import type { ReactNode } from 'react';
import { MessageSquareText } from 'lucide-react';
import { Badge } from '@/components/ui';
import { maskPhone, type MergedRow } from '@/lib/workspace';
import type { PlanSummary } from '@/lib/workspace/wizard';

function Stat({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-neutral-50 bg-neutral-30 p-4">
      <span className="block text-2xs uppercase tracking-wider text-text-light">{label}</span>
      <span className="jost mt-1 block text-2xl font-bold text-primary" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/** Paso 4: lo que se va a publicar (mismos números que devuelve v3 al publicar). */
export function WizardSummary({
  campaign,
  fileNames,
  phoneModeLabel,
  phoneColumns,
  summary,
  samples,
}: {
  campaign: string;
  fileNames: readonly string[];
  phoneModeLabel: string;
  phoneColumns: readonly string[];
  summary: PlanSummary;
  samples: ReadonlyArray<{ row: MergedRow; phone: string; text: string }>;
}) {
  return (
    <div data-testid="wizard-summary">
      <h2 className="text-base font-semibold">Resumen y envío</h2>
      <p className="mt-1 text-sm text-text-light">Revisa antes de enviar: tu CLI enviará estos mensajes por WhatsApp en su siguiente consulta.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Contactos seleccionados" value={summary.selected.toLocaleString('es-MX')} testId="summary-selected" />
        <Stat label="Mensajes a enviar" value={summary.messages.toLocaleString('es-MX')} testId="summary-messages" />
        <Stat label="Filas excluidas" value={summary.excluded.reduce((n, e) => n + e.count, 0).toLocaleString('es-MX')} testId="summary-excluded" />
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-light">Campaña</dt>
          <dd className="font-semibold text-text-muted">{campaign}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-light">Teléfonos</dt>
          <dd className="text-text-muted" data-testid="summary-phone-mode">
            {phoneModeLabel} · {phoneColumns.join(' → ')}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-text-light">Archivos</dt>
          <dd className="mt-1 flex flex-wrap gap-2">
            {fileNames.map((f) => (
              <Badge key={f} variant="outline" className="font-mono">
                {f}
              </Badge>
            ))}
          </dd>
        </div>
      </dl>

      {summary.excluded.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Filas que no se envían</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-text-muted" data-testid="summary-excluded-reasons">
            {summary.excluded.map((e) => (
              <li key={e.reason} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-40 px-3 py-1.5">
                <span>{e.reason}</span>
                <Badge variant="muted">{e.count}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-sm font-semibold">Ejemplos de mensajes</h3>
        <ul className="mt-2 grid gap-3 lg:grid-cols-3" data-testid="summary-samples">
          {samples.map((s) => (
            <li key={`${s.row.id}|${s.phone}`} className="rounded-xl border border-neutral-50 bg-white p-3 shadow-card">
              <span className="flex items-center gap-2 text-2xs uppercase tracking-wider text-text-light">
                <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-mono normal-case">{maskPhone(s.phone)}</span>
              </span>
              <p className="mt-2 whitespace-pre-wrap text-sm text-text-muted">{s.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
