// File: lista
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import {
  getConversationsPage,
  getMessagesPage,
  markConversationRead,
  getMediaUrl,
  maskPhone,
  reportChatOpen,
  reportManualInteraction,
  type Conversation,
  type Message,
  type UserAccess,
} from '../lib/api';
import { canReply, teamPanel } from '../lib/permissions';
import { shouldReportOpen } from '../lib/chatOpen';
import { TeamViewer } from './TeamViewer';
import { SearchableSelect } from '../ui/SearchableSelect';
import { Toggle } from '../ui/Toggle';
import type { WaStatus } from '../App';
import {
  clearUnread,
  mergeConversations,
  prependMessages,
  refreshConversations,
} from '../lib/chatPages';

export function Chats({
  access,
  waStatus,
  qr,
}: {
  access: UserAccess | null;
  waStatus: WaStatus; // estado WA en App (persiste entre tabs)
  qr: string | null;
}) {
  // Panel de equipo según permisos (v4-enforce-permissions): "Ver como",
  // pendientes y "Mover" se deciden dentro de TeamViewer.
  const showTeamPanel = teamPanel(access).show;
  // Sin ana:chats:message:reply: sin campo, adjunto ni "Registrar gestión".
  const mayReply = canReply(access);
  // Registro de apertura de chat solo con openChatInteraction (default false).
  const [openChatInteraction, setOpenChatInteraction] = useState(false);
  useEffect(() => {
    void window.ana.getSettings().then((s) => setOpenChatInteraction(s.openChatInteraction === true));
    return window.ana.onSettings((s) => setOpenChatInteraction(s.openChatInteraction === true));
  }, []);

  const [convos, setConvos] = useState<Conversation[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  // Paginación: lista ("Cargar más") e hilo ("Ver mensajes anteriores").
  const [convNext, setConvNext] = useState<string | undefined>(undefined);
  const convPages = useRef(0); // páginas de la lista ya cargadas
  const [convError, setConvError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [msgNext, setMsgNext] = useState<string | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  // Altura del hilo antes de anteponer mensajes (para conservar la posición).
  const keepScrollFrom = useRef<number | null>(null);
  const [reply, setReply] = useState('');
  // Envío manual en curso: deshabilita campo/botones (evita doble Enter).
  const [replySending, setReplySending] = useState(false);
  const replySendingRef = useRef(false);
  // Error del último envío manual ("No se envió: <motivo>") y archivo a reintentar.
  const [replyError, setReplyError] = useState<string | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [waError, setWaError] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seg desde que se inició la conexión
  // null = mis propias conversaciones; un operatorId = ver a ese agente.
  const [viewOperator, setViewOperator] = useState<string | null>(null);
  const viewingOther = viewOperator !== null;
  const [showInteraction, setShowInteraction] = useState(false);

  // qr/status llegan por props (App). Aquí solo errores + apagar "conectando".
  useEffect(() => {
    const off = window.ana.onWaEvent((d) => {
      if (d.type === 'qr') {
        setConnecting(false);
        setWaLoading(null);
      } else if (d.type === 'status') {
        setConnecting(false);
        if (d.status === 'connected' || d.status === 'disconnected') setWaLoading(null);
      } else if (d.type === 'loading') {
        setWaLoading(d.message ?? null);
        setWaError(null);
      } else if (d.type === 'error' || d.type === 'conflict') {
        setWaError(d.error);
        setWaLoading(null);
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

  // Mensaje entrante → actualiza lista e hilo EN SITIO (sin pasar por null:
  // eso vaciaba toda la UI a skeletons y se veía como un refresh completo).
  useEffect(() => {
    const off = window.ana.onWaMessage((d) => {
      void refreshConvosSilent();
      if (!viewOperator && d?.chatId && d.chatId === activeRef.current) {
        appendMessage(d);
      }
    });
    return off;
  }, [viewOperator]);

  // Envío de campaña exitoso → la conversación de ese contacto aparece o sube.
  useEffect(() => {
    const off = window.ana.onWaSent((d) => {
      if (d?.success && !viewOperator) void refreshConvosSilent();
    });
    return off;
  }, [viewOperator]);

  /** Re-consulta la primera página sin vaciar la lista (nada de skeletons). */
  async function refreshConvosSilent() {
    try {
      const page = await getConversationsPage(viewOperator ?? undefined);
      setConvos((prev) => (prev ? refreshConversations(page.conversations, prev) : page.conversations));
      // Con una sola página cargada, el token es el de la página nueva.
      if (convPages.current <= 1) setConvNext(page.nextToken);
      setConvError(false);
    } catch {
      /* conserva lo que ya se ve */
    }
  }

  /** "Cargar más": agrega la página siguiente al final sin repetir. */
  async function loadMoreConvos() {
    if (!convNext || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getConversationsPage(viewOperator ?? undefined, convNext);
      setConvos((prev) => mergeConversations(prev ?? [], page.conversations));
      setConvNext(page.nextToken);
      convPages.current += 1;
    } catch {
      setConvError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  /** "Ver mensajes anteriores": antepone la página previa conservando la posición. */
  async function loadOlderMessages() {
    if (!active || !msgNext || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await getMessagesPage(active, viewOperator ?? undefined, msgNext);
      keepScrollFrom.current = threadRef.current?.scrollHeight ?? null;
      setMessages((prev) => prependMessages(page.messages, prev ?? []));
      setMsgNext(page.nextToken);
    } catch {
      /* se puede reintentar con el mismo botón */
    } finally {
      setLoadingOlder(false);
    }
  }

  // Tras anteponer mensajes, compensa el scroll para no mover la vista de lectura.
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el && keepScrollFrom.current !== null) {
      el.scrollTop += el.scrollHeight - keepScrollFrom.current;
      keepScrollFrom.current = null;
    }
  }, [messages]);

  /** Agrega un mensaje al hilo abierto (dedupe por id). */
  function appendMessage(m: Message) {
    setMessages((prev) => {
      if (!prev) return prev;
      if (prev.some((x) => x.id === m.id)) return prev;
      return [...prev, m];
    });
  }

  // Recarga al cambiar de operador visto (yo / un agente)
  useEffect(() => {
    setActive(null);
    setMessages(null);
    void loadConvos();
  }, [viewOperator]);

  async function loadConvos() {
    setConvos(null);
    setConvError(false);
    setConvNext(undefined);
    convPages.current = 0;
    try {
      const page = await getConversationsPage(viewOperator ?? undefined);
      setConvos(page.conversations);
      setConvNext(page.nextToken);
      convPages.current = 1;
    } catch {
      setConvos([]);
      setConvError(true);
    }
  }

  async function openChat(chatId: string) {
    setActive(chatId);
    setMessages(null);
    setShowInteraction(false); // cierra el modal de gestión al cambiar de chat
    setReplyError(null);
    setFailedFile(null);
    setMsgNext(undefined);
    // Solo en mi sesión: registra atención en el CRM (como la ventana de v3) y
    // marca la conversación como leída (sin bloquear la UI; errores ignorados).
    if (!viewingOther) {
      if (shouldReportOpen({ openChatInteraction }, viewingOther)) void reportChatOpen(chatId);
      void markConversationRead(chatId);
      setConvos((prev) => (prev ? clearUnread(prev, chatId) : prev));
    }
    try {
      const page = await getMessagesPage(chatId, viewOperator ?? undefined);
      setMessages(page.messages);
      setMsgNext(page.nextToken);
    } catch {
      setMessages([]);
    }
  }

  /** Marca el envío manual en curso (ref = guardia síncrona contra doble Enter). */
  function beginReplySend(): boolean {
    if (replySendingRef.current) return false;
    replySendingRef.current = true;
    setReplySending(true);
    setReplyError(null);
    return true;
  }
  function endReplySend() {
    replySendingRef.current = false;
    setReplySending(false);
  }

  async function sendReply() {
    if (!active || !reply.trim() || viewingOther || !mayReply) return; // solo respondo en mi sesión
    if (!beginReplySend()) return;
    const body = reply.trim();
    stopTyping();
    try {
      const res = await window.ana.sendReply(active, body);
      if (res.ok) {
        // Solo al confirmar se limpia el campo.
        setReply('');
        // Append en sitio (sin recargar el hilo → sin parpadeo de skeletons).
        if (res.message) appendMessage(res.message);
        void refreshConvosSilent();
      } else {
        setReplyError(`No se envió: ${res.error ?? 'error desconocido'}`);
      }
    } catch (e: any) {
      setReplyError(`No se envió: ${e?.message ?? String(e)}`);
    } finally {
      endReplySend();
    }
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
    if (!beginReplySend()) return;
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await window.ana.sendMedia(active, {
        dataBase64,
        mimetype: file.type || 'application/octet-stream',
        filename: file.name,
        caption: reply.trim() || undefined,
      });
      if (res.ok) {
        setReply('');
        setFailedFile(null);
        if (res.message) appendMessage(res.message);
        void refreshConvosSilent();
      } else {
        // Conserva texto (pie) y archivo para reintentar.
        setFailedFile(file);
        setReplyError(`No se envió: ${res.error ?? 'error desconocido'}`);
      }
    } catch (e: any) {
      setFailedFile(file);
      setReplyError(`No se envió: ${e?.message ?? String(e)}`);
    } finally {
      endReplySend();
    }
  }

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* lista */}
      <aside className="w-64 shrink-0 border-r border-neutral-50 bg-white sm:w-72 lg:w-80">
        <div className="flex items-center justify-between border-b border-neutral-50 px-4 py-3">
          <span className="text-sm font-semibold">Conversaciones</span>
          {!viewingOther && <WaBadge status={waStatus} />}
        </div>

        {showTeamPanel && (
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
            {waLoading && !qr && (
              <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-50 border-t-secondary" />
                {waLoading}
              </div>
            )}
            {connecting && !qr && !waLoading && (
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
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{maskPhone(c.chatId)}</span>
                      {(c.unreadCount ?? 0) > 0 && (
                        <span
                          className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-white"
                          aria-label={`${c.unreadCount} no leídos`}
                        >
                          {c.unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-1 text-xs text-text-light">
                      {c.lastMessage ?? ''}
                    </span>
                  </button>
                </li>
              ))}
          {convError && (
            <li className="space-y-2 px-4 py-3 text-xs text-error-70">
              <p>No se pudieron cargar las conversaciones</p>
              <Button variant="outline" onClick={() => void (convos?.length ? loadMoreConvos() : loadConvos())}>
                Reintentar
              </Button>
            </li>
          )}
          {convos !== null && convNext && !convError && (
            <li className="px-4 py-3">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMoreConvos()}
                className="w-full text-center text-xs font-semibold text-primary hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'Cargando…' : 'Cargar más'}
              </button>
            </li>
          )}
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
            <header className="flex items-center justify-between border-b border-neutral-50 bg-white px-5 py-3">
              <span className="text-sm font-semibold">{maskPhone(active)}</span>
              {!viewingOther && mayReply && (
                <button
                  onClick={() => setShowInteraction(true)}
                  className="rounded-lg border border-neutral-50 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-light-90"
                >
                  Registrar gestión
                </button>
              )}
            </header>
            <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto p-5">
              {messages !== null && msgNext && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={loadingOlder}
                    onClick={() => void loadOlderMessages()}
                    className="rounded-full border border-neutral-50 bg-white px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-light-90 disabled:opacity-50"
                  >
                    {loadingOlder ? 'Cargando…' : 'Ver mensajes anteriores'}
                  </button>
                </div>
              )}
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
            ) : !mayReply ? (
              <div className="border-t border-neutral-50 bg-neutral-30 px-5 py-3 text-xs text-text-light">
                No tienes permiso para responder.
              </div>
            ) : (
              <div className="border-t border-neutral-50 bg-white p-3">
                {(replyError || failedFile) && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    {replyError && <span className="text-error-70">{replyError}</span>}
                    {failedFile && (
                      <>
                        <span className="rounded-full bg-neutral-30 px-2 py-0.5 text-text-muted">
                          📎 {failedFile.name}
                        </span>
                        <button
                          type="button"
                          disabled={replySending}
                          onClick={() => void sendFile(failedFile)}
                          className="font-semibold text-primary hover:underline disabled:opacity-50"
                        >
                          Reintentar
                        </button>
                        <button
                          type="button"
                          disabled={replySending}
                          onClick={() => {
                            setFailedFile(null);
                            setReplyError(null);
                          }}
                          className="text-text-light hover:underline disabled:opacity-50"
                        >
                          Quitar
                        </button>
                      </>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <label
                    className={`rounded-xl border border-neutral-50 px-3 py-2 text-sm text-text-muted ${
                      replySending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-neutral-30'
                    }`}
                    title="Adjuntar imagen o archivo"
                  >
                    📎
                    <input
                      type="file"
                      // Mismos tipos que acepta el main (ipc/guard.ts): imagen, audio, video o PDF.
                      accept="image/*,audio/*,video/*,application/pdf"
                      className="hidden"
                      disabled={replySending}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void sendFile(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <input
                    value={reply}
                    disabled={replySending}
                    onChange={(e) => onReplyChange(e.target.value)}
                    onBlur={stopTyping}
                    onKeyDown={(e) => e.key === 'Enter' && void sendReply()}
                    placeholder="Escribe un mensaje…"
                    className="min-w-0 flex-1 rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary disabled:opacity-60"
                  />
                  <Button onClick={() => void sendReply()} disabled={replySending}>
                    {replySending ? 'Enviando…' : 'Enviar'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {showInteraction && active && (
        <InteractionModal chatId={active} onClose={() => setShowInteraction(false)} />
      )}
    </div>
  );
}

/** Modal para registrar una gestión manual en el CRM (resultado + promesa). */
function InteractionModal({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [subdictamen, setSubdictamen] = useState('Promesa de pago');
  const [contactable, setContactable] = useState(true);
  const [comments, setComments] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [promiseAmount, setPromiseAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Un requestId por apertura del modal: un doble clic o un reintento tras un
  // error registran una sola gestión en el CRM.
  const [requestId] = useState(() => crypto.randomUUID());

  const SUBDICTAMENES = [
    'Promesa de pago',
    'Negociación',
    'No contactado',
    'Número equivocado',
    'Se niega a pagar',
    'Ya pagó',
    'Otro',
  ];

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await reportManualInteraction({
        chatId,
        subdictamen,
        contactable,
        comments: comments.trim() || undefined,
        promiseDate: promiseDate || undefined,
        promiseAmount: promiseAmount ? Number(promiseAmount) : undefined,
        requestId,
      });
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Error al registrar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-base font-bold">Registrar gestión</h2>

        <div>
          <label className="block text-xs font-semibold text-text-muted">Resultado</label>
          <div className="mt-1">
            <SearchableSelect
              value={subdictamen}
              onChange={setSubdictamen}
              options={SUBDICTAMENES}
              placeholder="Buscar resultado…"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-text-muted">Se logró contacto</span>
          <Toggle checked={contactable} onChange={setContactable} />
        </div>

        {subdictamen === 'Promesa de pago' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted">Fecha promesa</label>
              <input
                type="date"
                value={promiseDate}
                onChange={(e) => setPromiseDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted">Monto</label>
              <input
                type="number"
                inputMode="decimal"
                value={promiseAmount}
                onChange={(e) => setPromiseAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-text-muted">Comentarios</label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
          />
        </div>

        {err && <div className="rounded-xl bg-error-10 px-3 py-2 text-xs text-error-70">{err}</div>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-text-light hover:bg-neutral-30"
          >
            Cancelar
          </button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Guardando…' : 'Registrar'}
          </Button>
        </div>
      </div>
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
