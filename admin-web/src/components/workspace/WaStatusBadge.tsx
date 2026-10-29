'use client';

import { Badge, Button } from '@/components/ui';
import { maskPhone } from '@/lib/workspace';
import { waBadgeText, type WaMap } from '@/lib/wa-status';

/**
 * Estado de WhatsApp de una fila de Mi asignación (add-whatsapp-status-registry):
 * una insignia por teléfono con registro y "Marcar con WhatsApp" si alguno está
 * marcado sin WhatsApp. Sin registros no muestra nada.
 */
export function WaStatusBadge({
  rowId,
  phones,
  map,
  onMark,
  disabled = false,
}: {
  rowId: string;
  /** Teléfonos normalizados de la fila (`rowWaPhones`). */
  phones: readonly string[];
  map: WaMap;
  /** Pide marcar con WhatsApp los teléfonos marcados sin WhatsApp de la fila. */
  onMark?: (phones: string[]) => void;
  disabled?: boolean;
}) {
  const withRecord = phones.filter((p) => map[p]);
  if (withRecord.length === 0) return null;
  const noWa = withRecord.filter((p) => map[p]!.status === 'no_whatsapp');
  const prefix = withRecord.length > 1 || phones.length > 1;
  return (
    <div className="flex flex-col items-start gap-1" data-testid={`wa-status-${rowId}`}>
      {withRecord.map((p) => {
        const rec = map[p]!;
        return (
          <Badge key={p} variant={rec.status === 'no_whatsapp' ? 'error' : 'success'} title={rec.noWaCount > 1 ? `Marcado sin WhatsApp ${rec.noWaCount} veces` : undefined}>
            {prefix && <span className="font-mono">{maskPhone(p)}</span>}
            {waBadgeText(rec)}
          </Badge>
        );
      })}
      {noWa.length > 0 && onMark && (
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onMark(noWa)} aria-label={`Marcar con WhatsApp fila ${rowId}`}>
          Marcar con WhatsApp
        </Button>
      )}
    </div>
  );
}
