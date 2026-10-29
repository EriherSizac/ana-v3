'use client';

import { useMemo } from 'react';
import { useWaLookup } from '@/components/workspace/useWaStatus';
import { normalizeWaPhone } from '@/lib/wa-status';

/** Máximo de filas que se verifican en la vista previa (10 consultas de 2000). */
export const WA_UPLOAD_MAX_ROWS = 20_000;

/**
 * Aviso informativo en la vista previa de una carga de Contactos
 * (add-whatsapp-status-registry D10): cuántas filas tienen el teléfono marcado
 * sin WhatsApp en el registro. Nunca bloquea la carga.
 */
export function WaUploadNotice({ campaign, phones }: { campaign: string; phones: readonly string[] }) {
  const tooMany = phones.length > WA_UPLOAD_MAX_ROWS;
  const normalized = useMemo(() => phones.map((p) => normalizeWaPhone(p)), [phones]);
  const unique = useMemo(() => (tooMany ? [] : [...new Set(normalized.filter((p): p is string => !!p))].sort()), [normalized, tooMany]);
  const { map, state } = useWaLookup(tooMany ? null : `/api/campaigns/${encodeURIComponent(campaign)}/wa-status/lookup`, unique);
  const noWa = useMemo(() => normalized.filter((p) => p && map[p]?.status === 'no_whatsapp').length, [normalized, map]);

  if (tooMany) return <p className="mt-2 text-xs text-text-light">Demasiadas filas para verificar el registro de WhatsApp.</p>;
  if (state === 'loading') return <p className="mt-2 text-xs text-text-light">Verificando registro de WhatsApp…</p>;
  if (state === 'error') return <p className="mt-2 text-xs text-text-light" data-testid="wa-upload-error">No se pudo verificar el registro de WhatsApp (no impide la carga).</p>;
  if (state !== 'ready' || noWa === 0) return null;
  return (
    <p className="mt-3 rounded-xl bg-error-10 px-4 py-2 text-sm text-error-70" role="status" data-testid="wa-upload-notice">
      {noWa === 1 ? '1 contacto con teléfono marcado' : `${noWa} contactos con teléfono marcado`} sin WhatsApp. Puedes enviar la carga igual.
    </p>
  );
}
