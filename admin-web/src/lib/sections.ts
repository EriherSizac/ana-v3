import { hasPermission, PERMISSIONS, type Access } from './access';

/**
 * Registro de secciones de la consola. Cada change que agrega una sección la
 * declara aquí con el permiso que exige; la navegación y el gate por URL usan
 * este registro (el BFF vuelve a autorizar cada llamada).
 */
export interface Section {
  href: string;
  label: string;
  description: string;
  isAllowed: (access: Access) => boolean;
}

export const SECTIONS: Section[] = [
  {
    href: '/agentes',
    label: 'Agentes',
    description: 'Usuarios del pool, sus roles y su estado de agente por campaña en v3 y v4.',
    isAllowed: (a) => hasPermission(a, PERMISSIONS.AGENTS_MANAGE),
  },
];

/** Secciones visibles para el acceso dado. */
export function allowedSections(access: Access, sections: readonly Section[] = SECTIONS): Section[] {
  return sections.filter((s) => s.isAllowed(access));
}

/** Sección a la que pertenece una ruta (prefijo más largo). */
export function sectionForPath(pathname: string, sections: readonly Section[] = SECTIONS): Section | undefined {
  return [...sections]
    .sort((a, b) => b.href.length - a.href.length)
    .find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
}
