// File: Bloquea la app hasta que el auto-update termine. Estados:
// Created: 2026-06-10
// Updated: 2026-10-29
// Author: Erick Hernández Silva

import { useCallback, useEffect, useState } from 'react';
import type { UpdateBypassStatus, UpdateStatus } from '../types/ana';
import { Button } from '../ui/Button';

const RETRY_EVERY_S = 60;

/**
 * Bloquea la app hasta que el auto-update termine. Estados:
 *  - checking/downloading/installing → pantalla bloqueante (no se puede usar).
 *  - none → desbloquea (onReady). `bypass` si fue por acceso de emergencia.
 *  - error → "No se pudo verificar la actualización", el mensaje, "Reintentar"
 *    y reintento automático cada 60 s. NO hay "continuar sin actualizar": la
 *    única salida es el acceso de emergencia de Sistemas (contraseña maestra,
 *    verificada en el main; solo si el build trae el hash configurado).
 */
export function UpdateGate({ onReady }: { onReady: (bypass: boolean) => void }) {
  const [st, setSt] = useState<UpdateStatus>({ phase: 'checking' });
  const [countdown, setCountdown] = useState(RETRY_EVERY_S);
  const [bypass, setBypass] = useState<UpdateBypassStatus | null>(null);
  const [showBypass, setShowBypass] = useState(false);

  useEffect(() => {
    const off = window.ana.onUpdateStatus((s) => {
      setSt(s);
      if (s.phase === 'none') onReady(!!s.bypass);
    });
    // Listener ya montado → ahora sí pide el check (evita perder el evento).
    void window.ana.checkUpdates();
    return off;
  }, [onReady]);

  const retry = useCallback(() => {
    setCountdown(RETRY_EVERY_S);
    setSt({ phase: 'checking' });
    void window.ana.retryUpdate();
  }, []);

  // En error: reintento automático cada 60 s + estado del acceso de emergencia.
  useEffect(() => {
    if (st.phase !== 'error') return;
    setCountdown(RETRY_EVERY_S);
    void window.ana.getUpdateBypassStatus().then(setBypass);
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          void window.ana.retryUpdate();
          return RETRY_EVERY_S;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [st.phase]);

  const label: Record<UpdateStatus['phase'], string> = {
    checking: 'Buscando actualizaciones…',
    downloading: `Descargando actualización… ${st.percent ?? 0}%`,
    installing: st.waitingForJob ? 'Terminando el envío en curso…' : 'Instalando y reiniciando…',
    restarting: `Reiniciando en ${st.secondsLeft ?? 0} s…`,
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
            <p className="break-words text-xs text-white/70">{st.message}</p>
            <Button variant="outline" className="mt-3" onClick={retry}>
              Reintentar
            </Button>
            <p className="mt-2 text-xs text-white/60">
              Se reintenta solo en {countdown} s.
            </p>
            {bypass?.available && (
              <button
                type="button"
                onClick={() => setShowBypass(true)}
                className="mt-6 text-xs text-white/60 underline hover:text-white"
              >
                Acceso de emergencia (Sistemas)
              </button>
            )}
          </div>
        )}
      </div>

      {showBypass && st.phase === 'error' && (
        <BypassModal
          status={bypass}
          onStatus={setBypass}
          onClose={() => setShowBypass(false)}
        />
      )}
    </div>
  );
}

/** Pide la contraseña maestra de Sistemas; el main la verifica (scrypt) y desbloquea. */
function BypassModal({
  status,
  onStatus,
  onClose,
}: {
  status: UpdateBypassStatus | null;
  onStatus: (s: UpdateBypassStatus) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lockedMsg = (until: number) =>
    `Demasiados intentos. Bloqueado hasta las ${new Date(until).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    })}.`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.ana.tryUpdateBypass(password);
      setPassword('');
      if (r.ok) return; // el main emite `none` + bypass → la app se desbloquea
      onStatus(r);
      setError(
        r.reason === 'locked'
          ? lockedMsg(r.lockedUntil)
          : r.reason === 'unavailable'
            ? 'El acceso de emergencia no está disponible.'
            : `Contraseña incorrecta. Intentos restantes: ${r.attemptsLeft}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const locked = !!status?.locked;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <form
        onSubmit={submit}
        aria-label="Acceso de emergencia"
        className="pernexium-card w-full max-w-sm p-6 text-left"
      >
        <h2 className="text-lg font-bold text-primary">Acceso de emergencia</h2>
        <p className="mt-1 text-xs text-text-light">
          Solo para el equipo de Sistemas. Permite usar esta versión sin actualizar únicamente
          hasta cerrar la app. El uso queda registrado.
        </p>
        <label className="mt-4 block text-sm font-semibold text-text-muted" htmlFor="bypass-pw">
          Contraseña maestra
        </label>
        <input
          id="bypass-pw"
          type="password"
          autoComplete="off"
          autoFocus
          disabled={locked || busy}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border border-neutral-60 px-3 py-2 text-sm"
        />
        {(error || locked) && (
          <div className="mt-3 rounded-xl bg-error-10 px-3 py-2 text-xs text-error-70">
            {error ?? lockedMsg(status!.lockedUntil)}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={locked || busy || !password}>
            Desbloquear
          </Button>
        </div>
      </form>
    </div>
  );
}
