// File: App
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import { Login } from './routes/Login';
import { Chats } from './routes/Chats';
import { Campaigns } from './routes/Campaigns';
import { Assignment } from './routes/Assignment';
import { AdminRolePerms } from './routes/AdminRolePerms';
import { UpdateGate } from './routes/UpdateGate';
import { FloatingProgress } from './ui/FloatingProgress';
import {
  hasSession,
  logout,
  pushTokenToMain,
  installTokenBridge,
  onSessionExpired,
  SESSION_EXPIRED_MESSAGE,
} from './lib/auth';
import { getMe, type UserAccess } from './lib/api';
import { visibleTabs, type Tab } from './lib/permissions';
import type { UpdateStatus } from './types/ana';

export type WaStatus = 'idle' | 'qr' | 'authenticated' | 'connected' | 'disconnected';

export function App() {
  // Gate de auto-update: bloquea TODO hasta estar al día (o acceso de
  // emergencia de Sistemas). En dev (Vite) no hay feed → se salta.
  const [updated, setUpdated] = useState(import.meta.env.DEV);
  // Acceso de emergencia usado en esta sesión → banner persistente.
  const [bypassed, setBypassed] = useState(false);
  // Aviso en el login cuando la sesión no se pudo renovar.
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('chats');
  // Estado de WhatsApp vive aquí (App siempre montado) → no se pierde al
  // cambiar de tab. Chats lo recibe por props.
  const [waStatus, setWaStatus] = useState<WaStatus>('idle');
  const [qr, setQr] = useState<string | null>(null);
  // Update encontrado a media sesión (chequeo periódico): overlay bloqueante.
  const [midUpdate, setMidUpdate] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const off = window.ana.onUpdateStatus((s) => {
      // Solo bloquea cuando ya hay algo en curso (descarga/instalación).
      if (s.phase === 'downloading' || s.phase === 'installing') setMidUpdate(s);
      else setMidUpdate(null);
    });
    return off;
  }, []);

  useEffect(() => {
    // Tras refresh, recupera el estado vivo del main (no reconectar a ciegas).
    void window.ana.getWaState().then((s) => {
      setWaStatus(s.status as WaStatus);
      setQr(s.qr);
    });
    const off = window.ana.onWaEvent((d) => {
      if (d.type === 'qr') {
        setQr(d.qr);
        setWaStatus('qr');
      } else if (d.type === 'status') {
        setWaStatus(d.status);
        if (d.status === 'connected') setQr(null);
      }
    });
    return off;
  }, []);

  useEffect(() => {
    // Responde las solicitudes de token del main y vuelve al login si la
    // sesión no se puede renovar (sin borrar WhatsApp local).
    installTokenBridge();
    return onSessionExpired(() => {
      setAccess(null);
      setLoginNotice(SESSION_EXPIRED_MESSAGE);
      setAuthed(false);
    });
  }, []);

  useEffect(() => {
    void hasSession().then(async (ok) => {
      if (ok) {
        await pushTokenToMain(); // re-hidratar token al main tras refresh
        await loadAccess();
      }
      setAuthed(ok);
    });
  }, []);

  async function loadAccess() {
    try {
      const me = await getMe();
      setAccess(me);
      setAccessError(null);
      console.log('[ana] /me →', me); // diagnóstico
      // Registra la campaña del agente en el main (heartbeat → reparto del líder).
      const campaign = me.campaigns.find((c) => c !== '*') ?? me.campaigns[0];
      if (campaign) await window.ana.registerAgent(campaign);
    } catch (e: any) {
      setAccess(null);
      setAccessError(e?.message ?? String(e));
      console.error('[ana] /me falló', e);
    }
  }

  // Actualización de acceso forzada (add-realtime-v4-desktop): relee /me y
  // recalcula pestañas sin reiniciar la app.
  useEffect(() => window.ana.onAccessRefresh?.(() => void loadAccess()), []);

  async function onLogin() {
    setLoginNotice(null);
    await loadAccess();
    setAuthed(true);
  }

  // Update encontrado a media sesión → overlay bloqueante mientras instala.
  if (midUpdate) return <UpdatingOverlay st={midUpdate} />;
  // Antes que nada: forzar actualización.
  if (!updated)
    return (
      <UpdateGate
        onReady={(bypass) => {
          setBypassed(bypass);
          setUpdated(true);
        }}
      />
    );
  const banner = bypassed ? <BypassBanner /> : null;
  if (authed === null) return <div className="min-h-screen bg-neutral-30">{banner}</div>;
  if (!authed)
    return (
      <>
        {banner}
        <Login onDone={onLogin} notice={loginNotice} />
      </>
    );

  // Pestañas según permisos (v4-enforce-permissions); sin /me, ninguna.
  const tabs = visibleTabs(access);
  const current: Tab | null = tabs.includes(tab) ? tab : (tabs[0] ?? null);

  return (
    <div className="min-h-screen overflow-x-hidden bg-neutral-30">
      {banner}
      <header className="pernexium-gradient sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-white/10 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-heading text-lg font-bold tracking-wide text-white">
            PERNEXIUM
          </span>
          <span className="hidden rounded-full bg-white/15 px-2 py-0.5 text-xs text-white sm:inline">
            ana
          </span>
          {access && (
            <span className="hidden max-w-[140px] truncate text-xs text-white/70 md:inline">
              {access.username}
              {access.isAdmin ? ' · admin' : access.isLeader ? ' · líder' : ''}
            </span>
          )}
          {accessError && (
            <span className="truncate rounded-full bg-error-60 px-2 py-0.5 text-xs text-white">
              /me: {accessError}
            </span>
          )}
        </div>
        <nav className="flex shrink-0 items-center gap-1">
          {tabs.includes('chats') && (
            <NavPill active={current === 'chats'} onClick={() => setTab('chats')}>
              Chats
            </NavPill>
          )}
          {tabs.includes('assignment') && (
            <NavPill active={current === 'assignment'} onClick={() => setTab('assignment')}>
              Mi asignación
            </NavPill>
          )}
          {tabs.includes('campaigns') && (
            <NavPill active={current === 'campaigns'} onClick={() => setTab('campaigns')}>
              Campañas
            </NavPill>
          )}
          {tabs.includes('admin') && (
            <NavPill active={current === 'admin'} onClick={() => setTab('admin')}>
              Admin
            </NavPill>
          )}
          <button
            onClick={async () => {
              await logout();
              setAuthed(false);
            }}
            className="ml-2 rounded-full px-3 py-1 text-sm text-white/80 hover:bg-white/10"
          >
            Salir
          </button>
        </nav>
      </header>

      {current === 'admin' ? (
        <AdminRolePerms />
      ) : current === 'campaigns' ? (
        <Campaigns access={access} />
      ) : current === 'assignment' ? (
        <Assignment />
      ) : current === 'chats' ? (
        <Chats access={access} waStatus={waStatus} qr={qr} />
      ) : (
        <main className="mx-auto max-w-xl px-4 py-12 text-center text-sm text-text-light">
          {accessError ? 'No se pudo cargar tu acceso.' : 'Tu rol no tiene secciones habilitadas en ana.'}
        </main>
      )}

      {/* Progreso del batch en curso, visible en cualquier tab. */}
      <FloatingProgress />
    </div>
  );
}

/** Overlay bloqueante cuando se actualiza a media sesión (chequeo periódico). */
function UpdatingOverlay({ st }: { st: UpdateStatus }) {
  return (
    <div className="pernexium-gradient flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <span className="font-heading text-3xl font-black tracking-wide text-white">PERNEXIUM</span>
      <span className="mt-1 rounded-full bg-white/15 px-3 py-0.5 text-sm text-white">ana</span>
      <div className="mt-10 w-full max-w-sm">
        <p className="text-sm font-semibold text-white">
          {st.phase === 'installing' && st.waitingForJob
            ? 'Terminando el envío en curso…'
            : st.phase === 'installing'
            ? 'Instalando actualización y reiniciando…'
            : `Descargando actualización… ${st.percent ?? 0}%`}
        </p>
        {st.phase === 'downloading' && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/20">
            <div className="h-full bg-white transition-all" style={{ width: `${st.percent ?? 0}%` }} />
          </div>
        )}
        <p className="mt-3 text-xs text-white/70">La app se reiniciará sola al terminar.</p>
      </div>
    </div>
  );
}

/** Banner persistente: la app corre sin actualizar por acceso de emergencia. */
function BypassBanner() {
  return (
    <div
      role="alert"
      className="sticky top-0 z-40 bg-error-60 px-3 py-1 text-center text-xs font-semibold text-white"
    >
      Sin actualizar — acceso de emergencia
    </div>
  );
}

function NavPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors ${
        active ? 'bg-white text-primary' : 'text-white/80 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}
