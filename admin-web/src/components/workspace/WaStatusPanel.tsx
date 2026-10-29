'use client';

import { Button, ConfirmDialog, InlineMessage } from '@/components/ui';
import { WA_FILTER_OPTIONS, type WaFilter, type WaRowState } from '@/lib/wa-status';
import type { PhoneMode } from '@/lib/workspace';
import type { WaStatusApi } from './useWaStatus';

const countFor = (f: WaFilter, counts: Record<WaRowState, number>): number | null =>
  f === 'has' ? counts.yes : f === 'no' ? counts.no : f === 'unknown' ? counts.unknown : null;

/**
 * Panel de WhatsApp del paso Contactos (add-whatsapp-status-registry): estado de
 * la consulta, filtro (Todos / Con WhatsApp / Sin WhatsApp / Sin dato), aviso de
 * filas seleccionadas marcadas sin WhatsApp con acción en lote, nota de teléfonos
 * cambiados en modo "Primer teléfono válido" y el diálogo de confirmación.
 */
export function WaStatusPanel({
  wa,
  filter,
  onFilter,
  counts,
  selectedNoPhones,
  selectedNoRows,
  changedRows,
  phoneMode,
}: {
  wa: WaStatusApi;
  filter: WaFilter;
  onFilter: (f: WaFilter) => void;
  /** Conteo de filas válidas por clasificación. */
  counts: Record<WaRowState, number>;
  /** Teléfonos marcados sin WhatsApp de las filas seleccionadas. */
  selectedNoPhones: readonly string[];
  /** Filas seleccionadas clasificadas "Sin WhatsApp". */
  selectedNoRows: number;
  /** Filas seleccionadas cuyo teléfono cambió por la elección automática. */
  changedRows: number;
  phoneMode: PhoneMode;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2" data-testid="wa-panel">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Filtro WhatsApp" className="inline-flex flex-wrap rounded-xl border border-neutral-50 bg-white p-1">
          {WA_FILTER_OPTIONS.map((o) => {
            const n = countFor(o.value, counts);
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={filter === o.value}
                onClick={() => onFilter(o.value)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
                  filter === o.value ? 'bg-primary text-primary-foreground shadow-card' : 'text-text-muted hover:bg-neutral-40'
                }`}
              >
                {o.label}
                {n !== null && wa.state === 'ready' ? ` (${n})` : ''}
              </button>
            );
          })}
        </div>
        {wa.state === 'loading' && <span className="text-xs text-text-light">Verificando registro de WhatsApp…</span>}
        {wa.state === 'error' && (
          <span className="flex items-center gap-2 text-xs text-text-light" data-testid="wa-lookup-error">
            No se pudo verificar el registro de WhatsApp.
            <Button variant="ghost" size="sm" onClick={wa.retry}>
              Reintentar
            </Button>
          </span>
        )}
      </div>

      {selectedNoRows > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-error-10 px-4 py-2 text-sm text-error-70 sm:flex-row sm:items-center sm:justify-between" role="status" data-testid="wa-warning">
          <span>
            {selectedNoRows === 1 ? '1 contacto fue marcado' : `${selectedNoRows} contactos fueron marcados`} sin WhatsApp en algún momento
            {phoneMode === 'all' ? '; en "Todos los seleccionados" también se les enviará.' : '.'}
          </span>
          <Button variant="outline" size="sm" disabled={wa.marking} onClick={() => wa.request(selectedNoPhones)}>
            Marcar seleccionados con WhatsApp
          </Button>
        </div>
      )}
      {phoneMode === 'first' && changedRows > 0 && (
        <p className="text-xs text-text-light" data-testid="wa-skip-note">
          {changedRows === 1 ? 'En 1 fila' : `En ${changedRows} filas`} se usará el siguiente teléfono porque el primero está marcado sin WhatsApp.
        </p>
      )}
      {wa.markError && <InlineMessage>{wa.markError}</InlineMessage>}

      <ConfirmDialog
        open={wa.pending !== null}
        title="Marcar con WhatsApp"
        description={`${wa.pending?.length ?? 0} teléfono(s) quedarán registrados con WhatsApp a tu nombre. El CLI volverá a enviarles normalmente.`}
        confirmLabel="Marcar con WhatsApp"
        loading={wa.marking}
        onCancel={wa.cancel}
        onConfirm={wa.confirm}
      />
    </div>
  );
}
