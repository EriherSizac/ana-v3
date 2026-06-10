// File: permissions
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Catálogo de permisos de ana. Única fuente: UI + checks + docs lo usan.
// Formato: módulo:alcance:recurso:acción (ver Implementar_roles_locales.md §0).
export const ANA_PERMISSIONS = {
  ADMIN_CONSOLE: 'ana:admin:console:manage',
  CONTACTS_UPLOAD: 'ana:contacts:list:upload',
  CONTACTS_DISTRIBUTE: 'ana:contacts:list:distribute',
  CHATS_VIEW: 'ana:chats:conversation:view',
  CHATS_TEAM_VIEW: 'ana:chats:team:view', // ver conversaciones de los agentes
  CHATS_REPLY: 'ana:chats:message:reply',
  CAMPAIGN_SEND: 'ana:campaign:message:send',
  TEAM_JOBS_VIEW: 'ana:team:jobs:view', // ver pendientes por agente de la campaña
  TEAM_JOBS_MANAGE: 'ana:team:jobs:manage', // reasignar pendientes entre agentes
} as const;

export type AnaPermission = (typeof ANA_PERMISSIONS)[keyof typeof ANA_PERMISSIONS];

// Permisos que TODO rol tiene por defecto, salvo que se desactiven explícitamente
// (deny = el rol guarda `-<permiso>` en su lista). Ver resolveUserAccess.
export const DEFAULT_PERMISSIONS: string[] = [
  ANA_PERMISSIONS.CHATS_VIEW,
  ANA_PERMISSIONS.CHATS_REPLY,
];

// Superadmin: siempre acceso total, sin importar roles externos.
export const SUPERADMIN_USERNAME = 'erick.silva';

// Un rol cuyo nombre contiene "líder/lider" obtiene capacidades de líder
// (subir y repartir contactos) aunque su almacén local esté vacío.
export const LEADER_NAME_RE = /l[ií]der/i;
