// File: Progreso flotante del envío en curso (visible en cualquier tab).
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import type { SendProgress } from '../types/ana';

/**
 * Tarjeta flotante (abajo-derecha) con el progreso del batch en curso:
 * enviados/total, fallidos, y countdown de la pausa anti-bloqueo. Escucha
 * `wa:progress` del main → aparece sola al enviar, se oculta al terminar.
 */
export function FloatingProgress() {
  const [p, setP] = useState<SendProgress>({ phase: 'idle' });
  const [hidden, setHidden] = useState(false);

  useEffect(() => window.ana.onWaProgress(setP), []);

  // Reaparece en cada nuevo batch (sale de idle).
  useEffect(() => {
    if (p.phase === 'sending' || p.phase === 'waiting') setHidden(false);
  }, [p.phase]);

  if (hidden || p.phase === 'idle' || !p.total) return null;

  const total = p.total ?? 0;
  const done = p.done ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const waiting = p.phase === 'waiting';
  const fileDone = p.phase === 'fileDone';
  const secs = Math.ceil((p.waitMs ?? 0) / 1000);
  const mins = Math.floor(secs / 60);
  const wait = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-2xl border border-neutral-50 bg-white p-3 shadow-xl">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-muted">
          {fileDone ? 'Lote completado' : waiting ? 'En pausa' : 'Enviando'}
        </span>
        <button
          onClick={() => setHidden(true)}
          className="text-text-light hover:text-text-muted"
          title="Ocultar"
        >
          ✕
        </button>
      </div>

      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-neutral-50">
        <div
          className={`h-full transition-all ${fileDone ? 'bg-secondary' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-light">
        <span>
          {done}/{total}
        </span>
        <span>
          Enviados <span className="font-semibold text-secondary">{p.sent ?? 0}</span>
        </span>
        {(p.failed ?? 0) > 0 && (
          <span>
            Fallidos <span className="font-semibold text-error-70">{p.failed}</span>
          </span>
        )}
      </div>

      {waiting && (
        <div className="mt-1 text-xs text-text-muted">
          Pausa anti-bloqueo · siguiente en {wait}
        </div>
      )}
      {p.phone && !waiting && (
        <div className="mt-1 truncate text-xs text-text-light">Último: {p.phone}</div>
      )}
    </div>
  );
}
