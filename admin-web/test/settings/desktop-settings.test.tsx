import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));
vi.mock('@/lib/auth-client', () => ({ hasSession: async () => true, logout: vi.fn(), currentIdToken: vi.fn() }));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import { DesktopSettingsSection } from '@/components/settings/DesktopSettingsSection';
import { ApiError } from '@/lib/api-client';

const setting = (over: Record<string, unknown>) => ({
  description: 'desc',
  updatedBy: null,
  updatedAt: null,
  ...over,
});
const VIEW = (version = 0, over: Record<string, Record<string, unknown>> = {}) => ({
  version,
  settings: [
    setting({ key: 'sendMinGapSeconds', label: 'Separación mínima entre mensajes (segundos)', type: 'integer', min: 60, max: 600, default: 120, value: 120, ...over.sendMinGapSeconds }),
    setting({ key: 'sendMaxPerWindow', label: 'Máximo de mensajes por ventana', type: 'integer', min: 1, max: 20, default: 7, value: 7, ...over.sendMaxPerWindow }),
    setting({ key: 'sendWindowMinutes', label: 'Ventana de envío (minutos)', type: 'integer', min: 5, max: 60, default: 20, value: 20 }),
    setting({ key: 'openChatInteraction', label: 'Registrar "Atención WhatsApp" al abrir un chat', type: 'boolean', default: false, value: false }),
  ],
});

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('Configuración → Desktop v4', () => {
  it('Developer abre la página: Skeleton y luego "Separación mínima…" en 120 y por defecto 120', async () => {
    let resolve!: (v: unknown) => void;
    apiFetch.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<DesktopSettingsSection />);
    expect(screen.getByTestId('desktop-settings-skeleton')).toBeInTheDocument();
    resolve(VIEW());
    const row = await screen.findByTestId('desktop-setting-sendMinGapSeconds');
    expect(within(row).getByRole('heading', { name: 'Separación mínima entre mensajes (segundos)' })).toBeInTheDocument();
    expect(within(row).getByRole('textbox')).toHaveValue('120');
    expect(row).toHaveTextContent('Por defecto: 120');
    expect(row).toHaveTextContent('Sin cambios');
    expect(screen.getByRole('heading', { name: 'Desktop v4' })).toBeInTheDocument();
  });

  it('bajar el máximo por ventana de 7 a 5: ConfirmDialog con anterior y nuevo; queda 5 con autor', async () => {
    let sent: any = null;
    apiFetch.mockImplementation(async (_url: string, init?: { method?: string; json?: any }) => {
      if (init?.method === 'PUT') {
        sent = init.json;
        return VIEW(1, { sendMaxPerWindow: { value: 5, updatedBy: 'dev.uno', updatedAt: '2026-10-26T15:00:00Z' } });
      }
      return VIEW(0);
    });
    render(<DesktopSettingsSection />);
    const row = await screen.findByTestId('desktop-setting-sendMaxPerWindow');
    const input = within(row).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('De 7 a 5');
    expect(dialog).toHaveTextContent('hasta 5 minutos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(within(screen.getByTestId('desktop-setting-sendMaxPerWindow')).getByRole('textbox')).toHaveValue('5'));
    expect(screen.getByTestId('desktop-setting-sendMaxPerWindow')).toHaveTextContent('dev.uno');
    expect(sent).toEqual({ version: 0, values: { sendMaxPerWindow: 5 } });
  });

  it('valor fuera de límites: muestra 60 a 600 y no permite guardar', async () => {
    apiFetch.mockResolvedValue(VIEW());
    render(<DesktopSettingsSection />);
    const row = await screen.findByTestId('desktop-setting-sendMinGapSeconds');
    const input = within(row).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '10');
    expect(row).toHaveTextContent('Permitido: 60 a 600');
    expect(within(row).getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('conflicto 409: mensaje y conserva el valor anterior', async () => {
    apiFetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') throw new ApiError(409, 'conflict', 'x');
      return VIEW(2);
    });
    render(<DesktopSettingsSection />);
    const toggle = await screen.findByRole('switch', { name: 'Registrar "Atención WhatsApp" al abrir un chat' });
    await userEvent.click(toggle);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('La configuración cambió; recarga para ver el valor actual')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Registrar "Atención WhatsApp" al abrir un chat' })).toHaveAttribute('aria-checked', 'false');
  });
});
