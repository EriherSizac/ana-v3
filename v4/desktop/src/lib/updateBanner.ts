// File: Textos del aviso de actualización a media sesión (add-in-session-updates).
// Created: 2026-10-29
// Updated: 2026-10-29
// Author: Erick Hernández Silva

/** Lo mínimo de `UpdateStatus` que usa el aviso (sin depender de los tipos globales). */
export interface SessionUpdateLike {
  phase: string;
  version?: string;
  percent?: number;
  message?: string;
  waitingForJob?: boolean;
  secondsLeft?: number;
  inSession?: boolean;
}

export interface UpdateBannerView {
  tone: 'info' | 'error';
  title: string;
  detail: string;
  /** Barra de progreso (descarga). */
  percent?: number;
}

/** ¿El estado va al aviso no bloqueante (y no a la pantalla de arranque)? */
export const isSessionUpdate = (s: SessionUpdateLike | null | undefined): boolean => !!s?.inSession;

/**
 * Estado del updater a media sesión → textos del aviso. Obligatorio: nunca
 * ofrece posponer ni cerrar. null = sin aviso.
 */
export function updateBannerView(s: SessionUpdateLike | null | undefined): UpdateBannerView | null {
  if (!s?.inSession) return null;
  const v = s.version ? ` ${s.version}` : '';
  const title = `Nueva versión${v} — se actualizará automáticamente`;
  switch (s.phase) {
    case 'downloading': {
      const percent = Math.max(0, Math.min(100, Math.round(s.percent ?? 0)));
      return {
        tone: 'info',
        title,
        detail: `Descargando actualización… ${percent}% · Puedes seguir respondiendo chats; no se inician envíos nuevos.`,
        percent,
      };
    }
    case 'installing':
      return {
        tone: 'info',
        title,
        detail: s.waitingForJob ? 'Terminando el envío en curso…' : 'Instalando… la app se cerrará y volverá a abrirse sola.',
      };
    case 'restarting':
      return { tone: 'info', title, detail: `Reiniciando para actualizar en ${s.secondsLeft ?? 0} s` };
    case 'error':
      return {
        tone: 'error',
        title: `No se pudo actualizar${v}`,
        detail: `${s.message ?? 'Error desconocido'} · Los envíos continúan; se reintentará en 30 min.`,
      };
    default:
      return null;
  }
}
