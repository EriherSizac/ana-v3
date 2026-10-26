import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, setLocation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));
vi.mock('@/lib/auth-client', () => ({ hasSession: async () => true, logout: vi.fn(), currentIdToken: vi.fn() }));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import { ConsoleGate } from '@/components/system/ConsoleGate';
import { CliSettingsView } from '@/components/settings/CliSettingsView';
import { ApiError } from '@/lib/api-client';

const VIEW = {
  settings: { noWhatsappConsultRegistration: false },
  catalog: [{ key: 'noWhatsappConsultRegistration', type: 'boolean', default: false, description: 'Ofrece registrar el subdictamen.' }],
  updatedAt: null,
  updatedBy: null,
};

const me = (over: Record<string, unknown>) => ({
  username: 'u',
  permissions: ['ana:contacts:list:upload'],
  campaigns: ['didi_vip'],
  roleNames: [],
  isAdmin: false,
  isLeader: true,
  isDeveloper: false,
  ...over,
});

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('/configuracion', () => {
  it('líder sin Developer: "Sin acceso" y sin "Configuración" en la navegación', async () => {
    setLocation('/configuracion');
    apiFetch.mockResolvedValue(me({}));
    render(
      <ConsoleGate>
        <CliSettingsView />
      </ConsoleGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Secciones' })).queryByRole('link', { name: 'Configuración' })).toBeNull();
  });

  it('Developer: la navegación incluye "Configuración"', async () => {
    setLocation('/');
    apiFetch.mockResolvedValue(me({ permissions: [], isLeader: false, isDeveloper: true, roleNames: ['Developer'] }));
    render(
      <ConsoleGate>
        <p>inicio</p>
      </ConsoleGate>,
    );
    expect(await within(await screen.findByRole('navigation', { name: 'Secciones' })).findByRole('link', { name: 'Configuración' })).toBeInTheDocument();
  });

  it('primera vez: Skeleton, flag desactivado, por defecto Desactivado y "Sin cambios"', async () => {
    let resolve!: (v: unknown) => void;
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<CliSettingsView />);
    expect(screen.getByTestId('settings-skeleton')).toBeInTheDocument();
    resolve(VIEW);
    const row = await screen.findByTestId('setting-noWhatsappConsultRegistration');
    expect(row).toHaveTextContent('Registrar consulta de números sin WhatsApp');
    expect(row).toHaveTextContent('Desactivado');
    expect(row).toHaveTextContent('Por defecto: Desactivado');
    expect(within(row).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('settings-audit')).toHaveTextContent('Sin cambios');
  });

  it('activar y confirmar: valor activado con autor y fecha', async () => {
    apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: unknown }) => {
      if (init?.method === 'POST') {
        expect(init.json).toEqual({ settings: { noWhatsappConsultRegistration: true } });
        return { ...VIEW, settings: { noWhatsappConsultRegistration: true }, updatedAt: '2026-10-26T16:00:00Z', updatedBy: 'erick.silva' };
      }
      return VIEW;
    });
    render(<CliSettingsView />);
    await userEvent.click(await screen.findByRole('switch'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('aplica a todos los CLIs v3 en hasta 5 minutos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Activar' }));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByTestId('settings-audit')).toHaveTextContent('erick.silva');
  });

  it('conflicto 409: mensaje y conserva el valor anterior', async () => {
    apiFetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') throw new ApiError(409, 'conflict', 'x');
      return VIEW;
    });
    render(<CliSettingsView />);
    await userEvent.click(await screen.findByRole('switch'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activar' }));
    expect(await screen.findByText('La configuración cambió; recarga para ver el valor actual')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});
