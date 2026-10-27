'use client';

// File: Indicador "En vivo" y aviso "Hay cambios nuevos" del canal realtime (add-realtime-admin-web).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useRealtimeStatus } from '@/lib/realtime/RealtimeProvider';

/** "En vivo" con el canal activo; "Sin actualizaciones en vivo" inactivo o deshabilitado. No bloquea nada. */
export function RealtimeIndicator({ className }: { className?: string }) {
  const status = useRealtimeStatus();
  if (status === null) return null;
  const live = status === 'active';
  return (
    <Badge
      variant={live ? 'default' : 'muted'}
      className={cn('hidden sm:inline-flex', className)}
      data-testid="realtime-indicator"
      title={live ? 'Las secciones se actualizan solas' : 'Recarga la sección para ver cambios de otros'}
    >
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', live ? 'animate-pulse bg-secondary' : 'bg-text-light-muted')}
      />
      {live ? 'En vivo' : 'Sin actualizaciones en vivo'}
    </Badge>
  );
}

/** Aviso que reemplaza la recarga cuando hay trabajo sin guardar. */
export function StaleNotice({ stale, onRefresh, className }: { stale: boolean; onRefresh: () => void; className?: string }) {
  if (!stale) return null;
  return (
    <div
      role="status"
      className={cn(
        'mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-light-90 px-4 py-2 text-sm text-primary',
        className,
      )}
    >
      <span>Hay cambios nuevos ·</span>
      <Button size="sm" variant="outline" onClick={onRefresh}>
        Actualizar
      </Button>
    </div>
  );
}
