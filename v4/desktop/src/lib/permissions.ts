// File: permissions
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Espejo del catálogo del backend (backend/src/lib/permissions.ts).
export const ANA_PERMISSIONS = {
  ADMIN_CONSOLE: 'ana:admin:console:manage',
  CONTACTS_UPLOAD: 'ana:contacts:list:upload',
  CONTACTS_DISTRIBUTE: 'ana:contacts:list:distribute',
  CHATS_VIEW: 'ana:chats:conversation:view',
  CHATS_TEAM_VIEW: 'ana:chats:team:view',
  CHATS_REPLY: 'ana:chats:message:reply',
  CAMPAIGN_SEND: 'ana:campaign:message:send',
} as const;

// Permisos default ON (salvo deny explícito). Espejo del backend.
export const DEFAULT_PERMISSIONS: string[] = [
  ANA_PERMISSIONS.CHATS_VIEW,
  ANA_PERMISSIONS.CHATS_REPLY,
];

import type { UserAccess } from './api';

export function can(access: UserAccess | null, perm: string): boolean {
  if (!access) return false;
  return access.isAdmin || access.permissions.includes(perm);
}
