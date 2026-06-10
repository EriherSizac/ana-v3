// File: Bloquea la app hasta que el auto-update termine. Estados:
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../types/ana';
import { Button } from '../ui/Button';

/**
 * Bloquea la app hasta que el auto-update termine. Estados:
 *  - checking/downloading/installing → pantalla bloqueante (no se puede usar).
 *  - none → desbloquea (onReady).
 *  - error → offline / sin feed; ofrece continuar (si no, la app sería inservible).
 */
export function UpdateGate({ onReady }: { onReady: () => void }) {
  const [st, setSt] = useState<UpdateStatus>({ phase: 'checking' });

  useEffect(() => {
    const off = window.ana.onUpdateStatus((s) => {
      setSt(s);
      if (s.phase === 'none') onReady();
    });
    // Listener ya montado → ahora sí pide el check (evita perder el evento).
    void window.ana.checkUpdates();
    return off;
  }, [onReady]);

  const label: Record<UpdateStatus['phase'], string> = {
    checking: 'Buscando actualizaciones…',
    downloading: `Descargando actualización… ${st.percent ?? 0}%`,
    installing: 'Instalando y reiniciando…',
    none: 'Listo',
    error: 'No se pudo verificar la actualización',
  };

  return (
    <div className="pernexium-gradient flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <span className="font-heading text-3xl font-black tracking-wide text-white">
        PERNEXIUM
      </span>
      <span className="mt-1 rounded-full bg-white/15 px-3 py-0.5 text-sm text-white">ana</span>

      <div className="mt-10 w-full max-w-sm">
        <p className="text-sm font-semibold text-white">{label[st.phase]}</p>

        {st.phase === 'downloading' && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full bg-white transition-all"
              style={{ width: `${st.percent ?? 0}%` }}
            />
          </div>
        )}

        {(st.phase === 'checking' || st.phase === 'installing') && (
          <div className="mt-4 flex justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </div>
        )}

        {st.phase === 'error' && (
          <div className="mt-4">
            <p className="text-xs text-white/70">{st.message}</p>
            <Button variant="outline" className="mt-3" onClick={onReady}>
              Continuar sin actualizar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
