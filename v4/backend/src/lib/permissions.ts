// File: permissions
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Catálogo de permisos de ana. Única fuente: UI + checks + docs lo usan.
// Formato: módulo:alcance:recurso:acción (ver Implementar_roles_locales.md §0).
export const ANA_PERMISSIONS = {
  ADMIN_CONSOLE: 'ana:admin:console:manage',
  // Gestionar excepciones de agentes (deshabilitar/rehabilitar) en sus campañas.
  AGENTS_MANAGE: 'ana:admin:agents:manage',
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
// Insensible a acentos: normaliza y quita diacríticos (maneja "Líder", "Lider",
// y acentos descompuestos que algunas APIs devuelven → "Líder").
export const isLeaderRole = (name?: string): boolean =>
  /lider/.test(
    (name ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase(),
  );

/** Normaliza un nombre de rol: NFD, sin diacríticos, minúsculas (igual que isLeaderRole). */
export const normalizeRoleName = (name?: string): string =>
  (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Un rol cuyo nombre contiene "agente" ("Agente <Campaña>") es rol de agente:
// otorga ana:campaign:message:send por defecto (deny `-perm` lo quita).
export const isAgentRole = (name?: string): boolean => /agente/.test(normalizeRoleName(name));

// Un rol cuyo nombre contiene "supervisor" ("Supervisor <Campaña>") carga y
// reparte contactos de sus campañas y puede recibirlos (add-supervisor-contact-access D1).
// En Pernexium el supervisor es el rol "Líder <Campaña>" (decisión del usuario 2026-10-26);
// también se acepta un nombre con "supervisor".
export const isSupervisorRole = (name?: string): boolean => /supervisor|lider/.test(normalizeRoleName(name));

/**
 * Rol de superadmin (v4-enforce-permissions D7): sin diacríticos, en
 * minúsculas y sin espacios, guiones ni guiones bajos contiene "superadmin"
 * ("Superadmin", "Súper Admin", "super-admin"). "Administrador X" no cuenta.
 */
export const isSuperadminRole = (name?: string): boolean =>
  normalizeRoleName(name).replace(/[\s_-]+/g, '').includes('superadmin');

/** Rol Developer (misma regla que ANA Admin): sin acentos ni mayúsculas contiene "developer". */
export const isDeveloperRole = (name?: string): boolean => normalizeRoleName(name).includes('developer');

/**
 * Permiso de cada ruta para los chequeos NORMALES (sujetos a
 * PERMISSIONS_ENFORCED, design D2). Los chequeos explícitos (consola admin,
 * presign CSV, equipo, "ver como") no dependen del flag y no están aquí.
 */
export const ROUTE_PERMISSIONS: Readonly<Record<string, AnaPermission>> = {
  'GET /conversations': ANA_PERMISSIONS.CHATS_VIEW,
  'GET /conversations/{chatId}/messages': ANA_PERMISSIONS.CHATS_VIEW,
  'GET /media/url': ANA_PERMISSIONS.CHATS_VIEW,
  'GET /jobs/poll': ANA_PERMISSIONS.CAMPAIGN_SEND,
  'POST /jobs/ack': ANA_PERMISSIONS.CAMPAIGN_SEND,
  'POST /jobs/claim': ANA_PERMISSIONS.CAMPAIGN_SEND,
  'POST /interactions/report': ANA_PERMISSIONS.CAMPAIGN_SEND,
  'POST /interactions/open': ANA_PERMISSIONS.CHATS_REPLY,
  'POST /interactions/manual': ANA_PERMISSIONS.CHATS_REPLY,
};

/**
 * Filtra una lista de permisos para el almacén local: acepta grants (`perm`) y
 * denies (`-perm`) solo de permisos del catálogo.
 */
export function sanitizeRolePermissions(permissions: string[]): string[] {
  const valid = new Set<string>(Object.values(ANA_PERMISSIONS));
  return permissions.filter((p) => {
    if (typeof p !== 'string') return false;
    const bare = p.startsWith('-') ? p.slice(1) : p;
    return valid.has(bare);
  });
}
