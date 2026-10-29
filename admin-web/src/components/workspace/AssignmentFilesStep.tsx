'use client';

import { FileSpreadsheet, RefreshCw } from 'lucide-react';
import { Badge, Button, InlineMessage, Skeleton } from '@/components/ui';
import { formatDate } from '@/lib/agents';
import { cn } from '@/lib/cn';
import type { PendingFile } from '@/lib/workspace';
import { MAX_SOURCE_AGE_DAYS, sourceDate } from '@/lib/workspace/wizard';

const sizeLabel = (n: number | null) => (n == null ? '—' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/** Paso 1: pendientes de los últimos 3 meses como tarjetas seleccionables (se pueden combinar). */
export function AssignmentFilesStep({
  pending,
  error,
  hiddenOld,
  checkedKeys,
  onToggle,
  onRefresh,
}: {
  pending: PendingFile[] | null;
  error: string | null;
  hiddenOld: number;
  checkedKeys: readonly string[];
  onToggle: (key: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Archivo de asignación</h2>
          <p className="mt-1 text-sm text-text-light">
            Elige uno o más archivos; el más reciente viene marcado. Solo se ofrecen asignaciones de los últimos {MAX_SOURCE_AGE_DAYS} días.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Actualizar
        </Button>
      </div>

      {error && <InlineMessage className="mt-4">{error}</InlineMessage>}
      {pending === null && !error && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="pending-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      )}
      {pending && pending.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-neutral-60 bg-neutral-30 p-6 text-center">
          <p className="text-sm font-semibold text-text-muted">Sin asignaciones pendientes</p>
          <p className="mt-1 text-xs text-text-light">Cuando tu supervisor te asigne contactos aparecerán aquí.</p>
        </div>
      )}
      {pending && pending.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="pending-files">
          {pending.map((p, i) => {
            const checked = checkedKeys.includes(p.key);
            const date = sourceDate(p);
            return (
              <li key={p.key}>
                <label
                  className={cn(
                    'flex h-full cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-secondary',
                    checked ? 'border-primary bg-primary-light-90' : 'border-neutral-50 bg-white hover:bg-neutral-30',
                  )}
                >
                  <input type="checkbox" className="mt-1" aria-label={`Seleccionar ${p.fileName}`} checked={checked} onChange={() => onToggle(p.key)} />
                  <FileSpreadsheet className={cn('mt-0.5 h-5 w-5 shrink-0', checked ? 'text-primary' : 'text-text-light')} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-xs text-text-muted">{p.fileName}</span>
                      {i === 0 && <Badge variant="outline">Más reciente</Badge>}
                    </span>
                    <span className="mt-1 block text-sm font-semibold text-primary">{date === null ? 'Sin fecha' : formatDate(new Date(date).toISOString())}</span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-light">
                      <span>{p.rows == null ? 'Filas: —' : `${p.rows.toLocaleString('es-MX')} fila(s)`}</span>
                      <span>{sizeLabel(p.size)}</span>
                      {p.uploadIds && p.uploadIds.length > 0 && <span className="font-mono">Carga: {p.uploadIds.join(', ')}</span>}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {hiddenOld > 0 && (
        <p className="mt-3 text-xs text-text-light" data-testid="hidden-old">
          {hiddenOld} archivo(s) con más de 3 meses no se muestran y no se pueden enviar.
        </p>
      )}
    </div>
  );
}
