// File: Aviso no bloqueante de actualización a media sesión (add-in-session-updates).
// Created: 2026-10-29
// Updated: 2026-10-29
// Author: Erick Hernández Silva

import { updateBannerView, type SessionUpdateLike } from '../lib/updateBanner';

/**
 * Franja fija bajo el encabezado: versión nueva, estado y progreso. Sin botón
 * de cerrar ni "Más tarde" (la actualización es obligatoria); el resto de la
 * app sigue usable, incluidas las respuestas manuales.
 */
export function UpdateBanner({ st }: { st: SessionUpdateLike | null }) {
  const view = updateBannerView(st);
  if (!view) return null;
  const error = view.tone === 'error';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-14 z-20 border-b px-4 py-2 ${
        error ? 'border-error-10 bg-error-10 text-error-70' : 'border-primary-light-50 bg-primary-light-90 text-primary'
      }`}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
        <span className="shrink-0 text-sm font-semibold">{view.title}</span>
        <span className={`min-w-0 flex-1 text-xs ${error ? '' : 'text-text-muted'}`}>{view.detail}</span>
        {view.percent !== undefined && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white sm:w-40">
            <div className="h-full bg-primary transition-all" style={{ width: `${view.percent}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
