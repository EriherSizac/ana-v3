'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Badge, Button, InlineMessage, Skeleton } from '@/components/ui';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';
import { mxDateTime, type LegacyChat, type LegacyMessage } from '@/lib/legacy';
import { cn } from '@/lib/cn';

/**
 * Conversación legada en solo lectura. `body` se renderiza SIEMPRE como nodo
 * de texto de React (nunca HTML); los saltos de línea se conservan con CSS.
 */
export function LegacyChatView({ campaign, agent, phone, onBack }: { campaign: string; agent: string; phone: string; onBack: () => void }) {
  const [chat, setChat] = useState<LegacyChat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshed = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChat(
        await apiFetch<LegacyChat>(
          `/api/campaigns/${encodeURIComponent(campaign)}/legacy-chats/${encodeURIComponent(agent)}/${encodeURIComponent(phone)}`,
        ),
      );
    } catch (e) {
      if (isRedirecting(e)) return;
      setChat(null);
      setError(e instanceof ApiError && e.status === 404 ? 'Conversación no encontrada' : e instanceof ApiError ? e.message : 'No se pudo cargar la conversación.');
    } finally {
      setLoading(false);
    }
  }, [campaign, agent, phone]);

  useEffect(() => {
    refreshed.current = false;
    void load();
  }, [load]);

  /** Una URL firmada vencida: se vuelve a pedir la conversación (URLs nuevas), una vez por carga. */
  const onMediaError = useCallback(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    void load();
  }, [load]);

  return (
    <section className="pernexium-card p-4 sm:p-6" aria-labelledby="chat-title" data-testid="legacy-chat">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver
        </Button>
        <h2 id="chat-title" className="text-base font-semibold">
          <span className="font-mono">{phone}</span> · {agent}
        </h2>
        <Badge variant="muted">Legacy</Badge>
      </div>
      {loading && !chat ? (
        <div className="flex flex-col gap-3" data-testid="chat-skeleton">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={cn('h-10', i % 2 ? 'ml-auto w-1/2' : 'w-2/3')} />
          ))}
        </div>
      ) : error ? (
        <InlineMessage>{error}</InlineMessage>
      ) : chat && chat.messages.length === 0 ? (
        <p className="text-sm text-text-light">La conversación no tiene mensajes.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {chat?.messages.map((m, i) => (
            <MessageItem key={`${m.id ?? 'm'}-${i}`} message={m} onMediaError={onMediaError} />
          ))}
        </ol>
      )}
    </section>
  );
}

function MessageItem({ message: m, onMediaError }: { message: LegacyMessage; onMediaError: () => void }) {
  const mine = m.from === 'me';
  return (
    <li className={cn('max-w-[85%] rounded-xl px-4 py-2', mine ? 'ml-auto bg-primary-light-90' : 'bg-neutral-30')} data-testid="legacy-message">
      <p className="text-2xs uppercase tracking-wider text-text-light">
        {mine ? 'Agente' : m.from === 'them' ? 'Contacto' : (m.from ?? '—')} · {mxDateTime(m.timestamp)}
      </p>
      {m.body ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text">{m.body}</p> : null}
      <Media message={m} onMediaError={onMediaError} />
    </li>
  );
}

function Media({ message: m, onMediaError }: { message: LegacyMessage; onMediaError: () => void }) {
  if (!m.media) {
    // El mensaje tenía multimedia pero la referencia falta o es de otra campaña.
    return m.hasMedia ? <p className="mt-1 text-xs italic text-text-light">Multimedia no disponible</p> : null;
  }
  const { url, kind, filename, contentType } = m.media;
  if (kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- URL prefirmada externa de corta duración
    return <img src={url} alt={`Imagen ${filename}`} onError={onMediaError} className="mt-2 max-h-80 rounded-lg" />;
  }
  if (kind === 'audio') return <audio controls src={url} onError={onMediaError} className="mt-2 w-full" aria-label={`Audio ${filename}`} />;
  if (kind === 'video') return <video controls src={url} onError={onMediaError} className="mt-2 max-h-80 w-full rounded-lg" aria-label={`Video ${filename}`} />;
  return (
    <a href={url} download={filename} rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-primary underline">
      Descargar {filename} ({contentType})
    </a>
  );
}
