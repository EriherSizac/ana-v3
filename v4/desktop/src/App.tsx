// File: App
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import { Login } from './routes/Login';
import { Chats } from './routes/Chats';
import { Campaigns } from './routes/Campaigns';
import { AdminRolePerms } from './routes/AdminRolePerms';
import { UpdateGate } from './routes/UpdateGate';
import { hasSession, logout, pushTokenToMain } from './lib/auth';
import { getMe, type UserAccess } from './lib/api';
import { can, ANA_PERMISSIONS } from './lib/permissions';

type Tab = 'chats' | 'campaigns' | 'admin';
export type WaStatus = 'idle' | 'qr' | 'authenticated' | 'connected' | 'disconnected';

export function App() {
  // Gate de auto-update: bloquea TODO hasta estar al día (o continuar offline).
  // En dev (Vite) no hay feed → se salta.
  const [updated, setUpdated] = useState(import.meta.env.DEV);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('chats');
  // Estado de WhatsApp vive aquí (App siempre montado) → no se pierde al
  // cambiar de tab. Chats lo recibe por props.
  const [waStatus, setWaStatus] = useState<WaStatus>('idle');
  const [qr, setQr] = useState<string | null>(null);

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

  async function onLogin() {
    await loadAccess();
    setAuthed(true);
  }

  // Antes que nada: forzar actualización.
  if (!updated) return <UpdateGate onReady={() => setUpdated(true)} />;
  if (authed === null) return <div className="min-h-screen bg-neutral-30" />;
  if (!authed) return <Login onDone={onLogin} />;

  const canUpload = can(access, ANA_PERMISSIONS.CONTACTS_UPLOAD);
  const isAdmin = !!access?.isAdmin;

  return (
    <div className="min-h-screen overflow-x-hidden bg-neutral-30">
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
          <NavPill active={tab === 'chats'} onClick={() => setTab('chats')}>
            Chats
          </NavPill>
          {canUpload && (
            <NavPill active={tab === 'campaigns'} onClick={() => setTab('campaigns')}>
              Campañas
            </NavPill>
          )}
          {isAdmin && (
            <NavPill active={tab === 'admin'} onClick={() => setTab('admin')}>
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

      {tab === 'admin' && isAdmin ? (
        <AdminRolePerms />
      ) : tab === 'campaigns' && canUpload ? (
        <Campaigns access={access} />
      ) : (
        <Chats access={access} waStatus={waStatus} qr={qr} />
      )}
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
