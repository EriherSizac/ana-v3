import { render, screen, waitFor } from '@testing-library/react';
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

import { ContactsUploadView } from '@/components/contacts/ContactsUploadView';
import { ApiError } from '@/lib/api-client';

/** add-whatsapp-status-registry: aviso en la vista previa de carga de Contactos. */
const NO = { status: 'no_whatsapp', updatedAt: '2026-10-28T18:00:00.000Z', updatedBy: 'luis', source: 'cli_send', lastNoWaAt: '2026-10-28T18:00:00.000Z', noWaCount: 1 };
const tenRows = 'contact_phone,first_name\n' + Array.from({ length: 10 }, (_, i) => `52155000001${String(i).padStart(2, '0')},N${i}`).join('\n');

function setApi(lookup: (json: any) => unknown) {
  const lookups: any[] = [];
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    if (url === '/api/campaigns') return { campaigns: ['didi_vip'] };
    if (url.startsWith('/api/campaigns/didi_vip/enabled-agents')) return { agents: ['ana'], supervisors: [] };
    if (url === '/api/campaigns/didi_vip/wa-status/lookup') {
      lookups.push(init?.json);
      return lookup(init?.json);
    }
    return {};
  });
  return lookups;
}

async function preview() {
  render(<ContactsUploadView pollIntervalMs={10} pollTimeoutMs={200} />);
  await userEvent.click(await screen.findByRole('button', { name: /Campaña/ }));
  await userEvent.click(screen.getByRole('option', { name: 'didi_vip' }));
  await userEvent.click(await screen.findByRole('button', { name: /Flota/ }));
  await userEvent.click(screen.getByRole('option', { name: 'v3 (CLI)' }));
  await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
  await userEvent.upload(screen.getByLabelText('Archivo CSV'), new File([tenRows], 'c.csv', { type: 'text/csv' }));
  await screen.findByTestId('validation-summary');
  await userEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
  return screen.findByTestId('preview');
}

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('Contactos: registro de WhatsApp en la vista previa', () => {
  it('cuenta las filas marcadas sin WhatsApp y no bloquea la carga', async () => {
    const lookups = setApi(() => ({ items: { '525500000100': NO, '525500000103': NO } }));
    await preview();
    expect(await screen.findByTestId('wa-upload-notice')).toHaveTextContent('2 contactos con teléfono marcado sin WhatsApp');
    expect(lookups[0].phones).toHaveLength(10);
    expect(lookups[0].phones[0]).toBe('525500000100');
    expect(screen.getByRole('button', { name: 'Confirmar carga' })).toBeEnabled();
  });

  it('si la consulta falla, solo lo indica', async () => {
    setApi(() => {
      throw new ApiError(503, 'upstream_unavailable', 'Servicio no disponible');
    });
    await preview();
    expect(await screen.findByTestId('wa-upload-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar carga' })).toBeEnabled();
  });
});
