// File: Decisión pura del permiso de respuesta manual en el main (v4-enforce-permissions D5).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

export const REPLY_PERMISSION = 'ana:chats:message:reply';
export const NO_REPLY_ERROR = 'sin permiso para responder';
export const UNKNOWN_ACCESS_ERROR = 'No se pudo verificar el permiso para responder';

export interface MainAccess {
  isAdmin: boolean;
  permissions: string[];
}

/**
 * ¿Se permite un envío manual (texto o archivo)? Admin o
 * `ana:chats:message:reply`. Sin acceso conocido (no se pudo leer `/me`) no se
 * envía: el main reintenta leerlo antes de decidir.
 */
export function decideReply(access: MainAccess | null): { ok: true } | { ok: false; error: string } {
  if (!access) return { ok: false, error: UNKNOWN_ACCESS_ERROR };
  if (access.isAdmin || access.permissions.includes(REPLY_PERMISSION)) return { ok: true };
  return { ok: false, error: NO_REPLY_ERROR };
}
