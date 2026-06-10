// File: lista
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import {
  getConversations,
  getMessages,
  getMediaUrl,
  maskPhone,
  type Conversation,
  type Message,
  type UserAccess,
} from '../lib/api';
import { can, ANA_PERMISSIONS } from '../lib/permissions';
import { TeamViewer } from './TeamViewer';
import type { WaStatus } from '../App';

export function Chats({
  access,
  waStatus,
  qr,
}: {
  access: UserAccess | null;
  waStatus: WaStatus; // estado WA en App (persiste entre tabs)
  qr: string | null;
}) {
  const canTeamView = can(access, ANA_PERMISSIONS.CHATS_TEAM_VIEW);

  const [convos, setConvos] = useState<Conversation[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState('');
  const [waError, setWaError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seg desde que se inició la conexión
  // null = mis propias conversaciones; un operatorId = ver a ese agente.
  const [viewOperator, setViewOperator] = useState<string | null>(null);
  const viewingOther = viewOperator !== null;

  // qr/status llegan por props (App). Aquí solo errores + apagar "conectando".
  useEffect(() => {
    const off = window.ana.onWaEvent((d) => {
      if (d.type === 'qr' || d.type === 'status') setConnecting(false);
      else if (d.type === 'error') {
        setWaError(d.error);
        setConnecting(false);
      }
    });
    return off;
  }, []);

  // Contador de segundos mientras conecta
  useEffect(() => {
    if (!connecting) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [connecting]);

  // active accesible desde listeners sin cerrar valores viejos.
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Mensaje entrante → refresca la lista y, si es del chat abierto, el hilo.
  useEffect(() => {
    const off = window.ana.onWaMessage((d) => {
      void loadConvos();
      if (!viewOperator && d?.chatId && d.chatId === activeRef.current) {
        void openChat(d.chatId); // recarga el hilo en vivo
      }
    });
    return off;
  }, [viewOperator]);

  // Recarga al cambiar de operador visto (yo / un agente)
  useEffect(() => {
    setActive(null);
    setMessages(null);
    void loadConvos();
  }, [viewOperator]);

  async function loadConvos() {
    setConvos(null);
    try {
      setConvos(await getConversations(viewOperator ?? undefined));
    } catch {
      setConvos([]);
    }
  }

  async function openChat(chatId: string) {
    setActive(chatId);
    setMessages(null);
    try {
      setMessages(await getMessages(chatId, viewOperator ?? undefined));
    } catch {
      setMessages([]);
    }
  }

  async function sendReply() {
    if (!active || !reply.trim() || viewingOther) return; // solo respondo en mi sesión
    const body = reply.trim();
    setReply('');
    stopTyping();
    await window.ana.sendReply(active, body);
    await openChat(active);
  }

  // Typing en vivo: el contacto ve "escribiendo…" mientras compones.
  // WhatsApp expira el typing a los pocos segundos → lo refrescamos cada ~2s.
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  function onReplyChange(v: string) {
    setReply(v);
    if (!active || viewingOther) return;
    const now = Date.now();
    if (now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now;
      void window.ana.setTyping(active, true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 4000); // sin teclear → para
  }
  function stopTyping() {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (active) void window.ana.setTyping(active, false);
    lastTypingSent.current = 0;
  }

  async function sendFile(file: File) {
    if (!active || viewingOther) return;
    const dataBase64 = await fileToBase64(file);
    await window.ana.sendMedia(active, {
      dataBase64,
      mimetype: file.type || 'application/octet-stream',
      filename: file.name,
      caption: reply.trim() || undefined,
    });
    setReply('');
    await openChat(active);
  }

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* lista */}
      <aside className="w-64 shrink-0 border-r border-neutral-50 bg-white sm:w-72 lg:w-80">
        <div className="flex items-center justify-between border-b border-neutral-50 px-4 py-3">
          <span className="text-sm font-semibold">Conversaciones</span>
          {!viewingOther && <WaBadge status={waStatus} />}
        </div>

        {canTeamView && (
          <TeamViewer access={access} value={viewOperator} onChange={setViewOperator} />
        )}

        {!viewingOther && waStatus !== 'connected' && (
          <div className="space-y-2 border-b border-neutral-50 p-4">
            {qr ? (
              <img src={qr} alt="Escanea el QR con WhatsApp" className="mx-auto h-44 w-44" />
            ) : (
              <Button
                className="w-full"
                disabled={connecting}
                onClick={async () => {
                  setWaError(null);
                  setConnecting(true);
                  await window.ana.startWhatsApp();
                }}
              >
                {connecting ? `Iniciando… ${elapsed}s` : 'Conectar WhatsApp'}
              </Button>
            )}
            {connecting && !qr && (
              <p className="text-center text-xs text-text-light">
                Puede tardar unos segundos…
              </p>
            )}
            {!qr && (
              <button
                onClick={async () => {
                  setWaError(null);
                  setConnecting(true);
                  await window.ana.resetWhatsApp();
                }}
                className="w-full text-center text-xs text-text-light hover:underline"
              >
                Limpiar sesión y reconectar
              </button>
            )}
            {waError && (
              <div className="rounded-xl bg-error-10 px-3 py-2 text-xs text-error-70">
                {waError}
              </div>
            )}
          </div>
        )}

        <ul className="overflow-y-auto">
          {convos === null
            ? Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="flex gap-3 px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                </li>
              ))
            : convos.map((c) => (
                <li key={c.chatId}>
                  <button
                    onClick={() => openChat(c.chatId)}
                    className={`flex w-full flex-col items-start px-4 py-3 text-left hover:bg-neutral-30 ${
                      active === c.chatId ? 'bg-primary-light-90' : ''
                    }`}
                  >
                    <span className="text-sm font-semibold">{maskPhone(c.chatId)}</span>
                    <span className="line-clamp-1 text-xs text-text-light">
                      {c.lastMessage ?? ''}
                    </span>
                  </button>
                </li>
              ))}
        </ul>
      </aside>

      {/* hilo */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-text-light">
            Selecciona una conversación
          </div>
        ) : (
          <>
            <header className="border-b border-neutral-50 bg-white px-5 py-3 text-sm font-semibold">
              {maskPhone(active)}
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-5">
              {messages === null ? (
                <Skeleton className="h-4 w-48" />
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`w-fit max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                      m.fromMe
                        ? 'ml-auto bg-primary text-primary-foreground'
                        : 'bg-white border border-neutral-50'
                    }`}
                  >
                    {m.mediaKey && <MediaBubble mediaKey={m.mediaKey} mimetype={m.mimetype} />}
                    {m.body}
                  </div>
                ))
              )}
            </div>
            {viewingOther ? (
              <div className="border-t border-neutral-50 bg-neutral-30 px-5 py-3 text-xs text-text-light">
                Solo lectura — esta conversación es de otro agente; no puedes
                responder desde su sesión.
              </div>
            ) : (
              <div className="flex items-center gap-2 border-t border-neutral-50 bg-white p-3">
                <label
                  className="cursor-pointer rounded-xl border border-neutral-50 px-3 py-2 text-sm text-text-muted hover:bg-neutral-30"
                  title="Adjuntar imagen o archivo"
                >
                  📎
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void sendFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                <input
                  value={reply}
                  onChange={(e) => onReplyChange(e.target.value)}
                  onBlur={stopTyping}
                  onKeyDown={(e) => e.key === 'Enter' && sendReply()}
                  placeholder="Escribe un mensaje…"
                  className="min-w-0 flex-1 rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                />
                <Button onClick={sendReply}>Enviar</Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// Lee un File a base64 puro (sin el prefijo data:...;base64,).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function MediaBubble({ mediaKey, mimetype }: { mediaKey: string; mimetype?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [full, setFull] = useState(false); // visor de imagen a pantalla

  useEffect(() => {
    let cancel = false;
    void getMediaUrl(mediaKey)
      .then((u) => !cancel && setUrl(u))
      .catch(() => !cancel && setErr(true));
    return () => {
      cancel = true;
    };
  }, [mediaKey]);

  if (err) return <div className="text-xs text-text-light">media no disponible</div>;
  if (!url) return <Skeleton className="h-32 w-40" />;
  if (mimetype?.startsWith('image/')) {
    return (
      <>
        <img
          src={url}
          alt="media"
          onClick={() => setFull(true)}
          className="mb-1 max-h-60 cursor-zoom-in rounded-xl"
        />
        {full && (
          <div
            onClick={() => setFull(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          >
            <img src={url} alt="media" className="max-h-full max-w-full rounded-lg" />
          </div>
        )}
      </>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block underline">
      Descargar archivo
    </a>
  );
}

function WaBadge({ status }: { status: WaStatus }) {
  const label: Record<WaStatus, string> = {
    idle: 'Desconectado',
    qr: 'Escanea QR',
    authenticated: 'Autenticando…',
    connected: 'Conectado',
    disconnected: 'Desconectado',
  };
  const color = status === 'connected' ? 'bg-secondary' : 'bg-neutral-60';
  return (
    <span className="flex items-center gap-1 text-xs text-text-light">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label[status]}
    </span>
  );
}
