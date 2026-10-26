// File: Fusión pura de páginas de conversaciones y mensajes (sin duplicar ids).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/** "Cargar más": agrega `next` al final de `current` sin repetir chatId. */
export function mergeConversations<T extends { chatId: string }>(current: T[], next: T[]): T[] {
  const seen = new Set(current.map((c) => c.chatId));
  return [...current, ...next.filter((c) => !seen.has(c.chatId))];
}

/**
 * Recarga silenciosa: la primera página nueva (más reciente) manda; se
 * conservan después las ya cargadas de páginas siguientes que no vinieron.
 */
export function refreshConversations<T extends { chatId: string }>(fresh: T[], current: T[]): T[] {
  const seen = new Set(fresh.map((c) => c.chatId));
  return [...fresh, ...current.filter((c) => !seen.has(c.chatId))];
}

/** "Ver mensajes anteriores": antepone `older` a `current` sin repetir id. */
export function prependMessages<T extends { id: string }>(older: T[], current: T[]): T[] {
  const seen = new Set(current.map((m) => m.id));
  return [...older.filter((m) => !seen.has(m.id)), ...current];
}

/** Quita el conteo de no leídos de una conversación (al abrirla). */
export function clearUnread<T extends { chatId: string; unreadCount?: number }>(list: T[], chatId: string): T[] {
  return list.map((c) => (c.chatId === chatId && c.unreadCount ? { ...c, unreadCount: 0 } : c));
}
