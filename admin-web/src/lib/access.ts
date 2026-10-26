// Tipos y reglas de acceso compartidos por cliente y BFF. La AUTORIZACIÓN real
// siempre se decide en el servidor (src/server/access); en el cliente estas
// funciones solo filtran navegación y acciones visibles.

export const PERMISSIONS = {
  ADMIN_CONSOLE: 'ana:admin:console:manage',
  AGENTS_MANAGE: 'ana:admin:agents:manage',
  CONTACTS_UPLOAD: 'ana:contacts:list:upload',
  CONTACTS_DISTRIBUTE: 'ana:contacts:list:distribute',
} as const;

/** Permisos que, además de admin/Developer, dan entrada a la consola. */
export const ENTRY_PERMISSIONS: readonly string[] = [PERMISSIONS.AGENTS_MANAGE, PERMISSIONS.CONTACTS_UPLOAD];

/** Acceso efectivo expuesto por `GET /api/me`. */
export interface Access {
  username: string;
  permissions: string[];
  campaigns: string[];
  roleNames: string[];
  isAdmin: boolean;
  isLeader: boolean;
  isDeveloper: boolean;
}

/** Normaliza como `isLeaderRole` de v4: NFD, sin diacríticos, minúsculas. */
export function normalizeRoleName(name: string | undefined | null): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export const isDeveloperRole = (name?: string | null): boolean => /developer/.test(normalizeRoleName(name));

export const isDeveloper = (roleNames: readonly string[]): boolean => roleNames.some((r) => isDeveloperRole(r));

/** ¿Puede entrar a la consola? */
export function canEnter(access: Pick<Access, 'isAdmin' | 'isDeveloper' | 'permissions'>): boolean {
  return access.isAdmin || access.isDeveloper || access.permissions.some((p) => ENTRY_PERMISSIONS.includes(p));
}

/** ¿Tiene el permiso? Admin tiene todos. */
export function hasPermission(access: Pick<Access, 'isAdmin' | 'permissions'>, perm: string): boolean {
  return access.isAdmin || access.permissions.includes(perm);
}

/** ¿La campaña está en su alcance? Admin y `*` pasan. */
export function inCampaignScope(access: Pick<Access, 'isAdmin' | 'campaigns'>, campaign: string): boolean {
  return access.isAdmin || access.campaigns.includes('*') || access.campaigns.includes(campaign);
}
