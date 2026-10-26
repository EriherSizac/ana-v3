import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Access } from '@/lib/access';
import type { Section } from '@/lib/sections';
import { resetNavigation, router, setLocation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));

const hasSession = vi.fn();
const logout = vi.fn();
vi.mock('@/lib/auth-client', () => ({
  hasSession: () => hasSession(),
  logout: () => logout(),
  currentIdToken: vi.fn(),
}));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import { AccessContext } from '@/components/system/AccessContext';
import { AppHeader } from '@/components/system/AppHeader';
import { ConsoleGate } from '@/components/system/ConsoleGate';
import { HomeView } from '@/components/system/HomeView';
import { ApiError } from '@/lib/api-client';
import NotFound from '@/app/not-found';

const SECTIONS: Section[] = [
  { href: '/agentes', label: 'Agentes', description: 'Gestiona agentes', isAllowed: (a) => a.isAdmin || a.permissions.includes('ana:admin:agents:manage') },
  { href: '/contactos', label: 'Contactos', description: 'Carga contactos', isAllowed: (a) => a.isAdmin || a.permissions.includes('ana:contacts:list:upload') },
  { href: '/configuracion', label: 'Configuración', description: 'CLI', isAllowed: (a) => a.isDeveloper },
];

const base: Access = {
  username: 'lider.didi',
  permissions: ['ana:contacts:list:upload'],
  campaigns: ['didi_vip'],
  roleNames: ['Líder Didi'],
  isAdmin: false,
  isLeader: true,
  isDeveloper: false,
};
const agent: Access = { ...base, username: 'agente.1', permissions: ['ana:chats:conversation:view', 'ana:chats:message:reply'], isLeader: false };

describe('ConsoleGate', () => {
  beforeEach(() => {
    resetNavigation();
    hasSession.mockReset();
    apiFetch.mockReset();
    logout.mockReset();
  });

  it('muestra Skeleton mientras resuelve y redirige a /login?next= sin sesión', async () => {
    setLocation('/agentes');
    let resolve!: (v: boolean) => void;
    hasSession.mockReturnValue(new Promise<boolean>((r) => (resolve = r)));
    render(
      <ConsoleGate sections={SECTIONS}>
        <p>datos protegidos</p>
      </ConsoleGate>,
    );
    expect(screen.getByTestId('gate-skeleton')).toBeInTheDocument();
    resolve(false);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fagentes'));
    expect(screen.queryByText('datos protegidos')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('un agente sin permisos ve "Sin acceso" con su username', async () => {
    hasSession.mockResolvedValue(true);
    apiFetch.mockResolvedValue(agent);
    render(
      <ConsoleGate sections={SECTIONS}>
        <p>inicio</p>
      </ConsoleGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(screen.getAllByText('agente.1').length).toBeGreaterThan(0);
    expect(screen.queryByText('inicio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('URL directa a una sección sin permiso → "Sin acceso"', async () => {
    setLocation('/agentes');
    hasSession.mockResolvedValue(true);
    apiFetch.mockResolvedValue(base);
    render(
      <ConsoleGate sections={SECTIONS}>
        <p>tabla de agentes</p>
      </ConsoleGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(screen.queryByText('tabla de agentes')).toBeNull();
  });

  it('líder ve el shell con las secciones que habilitan sus permisos', async () => {
    setLocation('/contactos');
    hasSession.mockResolvedValue(true);
    apiFetch.mockResolvedValue(base);
    render(
      <ConsoleGate sections={SECTIONS}>
        <p>carga</p>
      </ConsoleGate>,
    );
    expect(await screen.findByText('carga')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Secciones' });
    expect(within(nav).getByRole('link', { name: 'Contactos' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 'Agentes' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Configuración' })).toBeNull();
  });

  it('v4 caído → mensaje y reintento', async () => {
    hasSession.mockResolvedValue(true);
    apiFetch.mockRejectedValueOnce(new ApiError(503, 'access_unavailable', 'No se pudo verificar tu acceso. Intenta de nuevo.'));
    apiFetch.mockResolvedValueOnce(base);
    render(
      <ConsoleGate sections={SECTIONS}>
        <p>inicio</p>
      </ConsoleGate>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo verificar tu acceso');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('inicio')).toBeInTheDocument();
  });
});

describe('AppHeader', () => {
  beforeEach(() => {
    resetNavigation();
    logout.mockReset();
  });

  it('marca, sub-marca y navegación filtrada', () => {
    render(<AppHeader username="admin.x" sections={SECTIONS.slice(0, 2)} />);
    expect(screen.getByText('PERNEXIUM')).toBeInTheDocument();
    expect(screen.getByText('ANA Admin')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Secciones' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Inicio', 'Agentes', 'Contactos']);
  });

  it('hamburguesa con aria-label abre el panel móvil', async () => {
    render(<AppHeader username="admin.x" sections={SECTIONS.slice(0, 1)} />);
    const burger = screen.getByRole('button', { name: 'Abrir menú de navegación' });
    await userEvent.click(burger);
    expect(screen.getByRole('navigation', { name: 'Secciones (móvil)' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Secciones (móvil)' })).toBeNull();
  });

  it('Tab recorre los controles en orden', async () => {
    render(<AppHeader username="admin.x" sections={SECTIONS.slice(0, 1)} />);
    await userEvent.tab();
    expect(screen.getByRole('link', { name: /PERNEXIUM/ })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Agentes' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Menú de usuario admin.x' })).toHaveFocus();
  });

  it('Cerrar sesión pide confirmación con advertencia y redirige a /login', async () => {
    logout.mockResolvedValue(undefined);
    render(<AppHeader username="admin.x" sections={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Menú de usuario admin.x' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('también se cerrará en las demás apps Pernexium');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar sesión' }));
    expect(logout).toHaveBeenCalled();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });
});

describe('páginas de sistema', () => {
  it('inicio resume solo las secciones permitidas', () => {
    render(
      <AccessContext.Provider value={base}>
        <HomeView sections={SECTIONS} />
      </AccessContext.Provider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ANA Admin');
    expect(screen.getByRole('link', { name: /Contactos/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Agentes/ })).toBeNull();
  });

  it('ruta inexistente → "No encontrado" con enlace al inicio', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: 'No encontrado' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('main')).toHaveClass('mx-auto', 'px-4', 'py-8', 'sm:px-6', 'lg:px-8', 'lg:py-10');
  });
});
