import type { Access } from './access';

// Historial legacy (add-legacy-chat-history): tipos y regla de acceso.

/** Sección y rutas: admins, o líderes (el alcance por campaña lo aplica withAccess/v3). */
export const legacyAllowed = (a: Pick<Access, 'isAdmin' | 'isLeader'>): boolean => a.isAdmin || a.isLeader;

export interface LegacyConversation {
  agent: string;
  phone: string;
  totalMessages: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
}

export interface LegacySearchResult {
  total: number;
  page: number;
  conversations: LegacyConversation[];
}

export interface LegacyMedia {
  url: string;
  contentType: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  filename: string;
}

export interface LegacyMessage {
  id: string | null;
  timestamp: string | null;
  from: string | null;
  body: string | null;
  media: LegacyMedia | null;
  hasMedia?: boolean;
}

export interface LegacyChat {
  campaign: string;
  agent: string;
  phone: string;
  messages: LegacyMessage[];
}

const fmt = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });

/** Fecha/hora en America/Mexico_City (o el texto original si no es fecha). */
export function mxDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : fmt.format(d);
}
