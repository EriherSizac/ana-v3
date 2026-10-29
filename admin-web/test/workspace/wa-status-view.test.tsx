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

import { MyAssignmentView } from '@/components/workspace/MyAssignmentView';
import { ApiError } from '@/lib/api-client';

/** add-whatsapp-status-registry: registro de WhatsApp en "Mi asignación". */
const K1 = 'assignments/agents/prueba/ana.lopez-contacts-T1.csv';
const CSV = 'phone_number,first_name\n5215500000001,Ana\n5215500000002,Beto\n5215500000003,Carla\n';
const NO = (by = 'luis') => ({ status: 'no_whatsapp', updatedAt: '2026-10-28T18:00:00.000Z', updatedBy: by, source: 'cli_send', lastNoWaAt: '2026-10-28T18:00:00.000Z', noWaCount: 1 });
const YES = { status: 'has_whatsapp', updatedAt: '2026-10-28T18:00:00.000Z', updatedBy: 'ana.lopez', source: 'agent_manual', lastNoWaAt: null, noWaCount: 0 };

type Call = { url: string; init?: { method?: string; json?: any } };
function setApi(opts: { csv?: string; items?: Record<string, unknown>; lookup?: () => unknown; mark?: (json: any) => unknown } = {}) {
  const calls: Call[] = [];
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    calls.push({ url, init });
    if (url === '/api/agent/campaigns') return { campaigns: ['prueba'] };
    if (url.endsWith('/publications')) return { items: [] };
    if (url === '/api/agent/wa-status/prueba/lookup') return opts.lookup ? opts.lookup() : { items: opts.items ?? {} };
    if (url === '/api/agent/wa-status/prueba') return opts.mark ? opts.mark(init?.json) : { updated: init?.json?.phones?.length ?? 0, rejected: [] };
    if (url.includes('/file?key=')) return { key: K1, etag: '"e1"', csv: opts.csv ?? CSV };
    if (/^\/api\/agent\/assignments\/[^/]+$/.test(url)) return { items: [{ key: K1, fileName: 'f.csv', lastModified: new Date().toISOString(), size: 1, etag: '"e1"' }] };
    return {};
  });
  return calls;
}

async function loadContacts() {
  render(<MyAssignmentView />);
  await screen.findByTestId('pending-files');
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  return screen.findByTestId('contacts-table');
}
const visibleNames = () => screen.getAllByTestId(/^row-/).map((r) => within(r).queryByText(/^(Ana|Beto|Carla)$/)?.textContent);

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe('Mi asignación: registro de WhatsApp', () => {
  it('insignias por fila, aviso de seleccionados y filtro combinado con la búsqueda', async () => {
    const calls = setApi({ items: { '525500000001': NO(), '525500000003': NO('erick'), '525500000002': YES } });
    await loadContacts();
    expect(await screen.findByTestId('wa-status-0:0')).toHaveTextContent('Sin WhatsApp (marcado el 28/10/2026 por luis)');
    expect(screen.getByTestId('wa-status-0:1')).toHaveTextContent('Con WhatsApp');
    expect(screen.getByTestId('wa-warning')).toHaveTextContent('2 contactos fueron marcados sin WhatsApp en algún momento');
    const lookup = calls.find((c) => c.url.endsWith('/lookup'))!;
    expect(lookup.init).toMatchObject({ method: 'POST', json: { phones: ['525500000001', '525500000002', '525500000003'] } });

    await userEvent.click(screen.getByRole('radio', { name: 'Sin WhatsApp (2)' }));
    expect(visibleNames()).toEqual(['Ana', 'Carla']);
    await userEvent.type(screen.getByLabelText('Buscar contactos'), 'Carla');
    expect(visibleNames()).toEqual(['Carla']);
    await userEvent.clear(screen.getByLabelText('Buscar contactos'));
    await userEvent.click(screen.getByRole('radio', { name: 'Con WhatsApp (1)' }));
    expect(visibleNames()).toEqual(['Beto']);
    await userEvent.click(screen.getByRole('radio', { name: 'Todos' }));
    expect(visibleNames()).toHaveLength(3);

    // Quitar de la selección las filas marcadas apaga el aviso.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar fila 0:0' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar fila 0:2' }));
    expect(screen.queryByTestId('wa-warning')).toBeNull();
  });

  it('"Marcar con WhatsApp" por fila: confirmación, actualización inmediata y POST con el teléfono', async () => {
    let release: (v: unknown) => void = () => {};
    const calls = setApi({ items: { '525500000001': NO() }, mark: () => new Promise((r) => (release = r)) });
    await loadContacts();
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar con WhatsApp fila 0:0' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('1 teléfono(s)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar con WhatsApp' }));
    // Optimista: antes de que responda el backend.
    expect(screen.getByTestId('wa-status-0:0')).toHaveTextContent('Con WhatsApp');
    expect(screen.queryByTestId('wa-warning')).toBeNull();
    release({ updated: 1, rejected: [] });
    const mark = calls.find((c) => c.url === '/api/agent/wa-status/prueba')!;
    expect(mark.init).toEqual({ method: 'POST', json: { phones: ['525500000001'], status: 'has_whatsapp' } });
  });

  it('si la marca falla, la fila vuelve a "Sin WhatsApp" con el error', async () => {
    setApi({
      items: { '525500000001': NO() },
      mark: () => {
        throw new ApiError(503, 'upstream_unavailable', 'Servicio no disponible');
      },
    });
    await loadContacts();
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar con WhatsApp fila 0:0' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar con WhatsApp' }));
    expect(await screen.findByText('No se pudo guardar la marca de WhatsApp; intenta de nuevo.')).toBeInTheDocument();
    expect(screen.getByTestId('wa-status-0:0')).toHaveTextContent('Sin WhatsApp (marcado el 28/10/2026 por luis)');
  });

  it('marca en lote de los seleccionados', async () => {
    const calls = setApi({ items: { '525500000001': NO(), '525500000003': NO() } });
    await loadContacts();
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar seleccionados con WhatsApp' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 teléfono(s)');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar con WhatsApp' }));
    await waitFor(() => expect(screen.queryByTestId('wa-warning')).toBeNull());
    const mark = calls.find((c) => c.url === '/api/agent/wa-status/prueba')!;
    expect(mark.init?.json.phones.sort()).toEqual(['525500000001', '525500000003']);
  });

  it('modo primer teléfono: salta el teléfono marcado y lo indica', async () => {
    setApi({ csv: 'telefono_1,telefono_2,first_name\n5215500000001,5215500000002,Ana\n5215500000003,,Beto\n', items: { '525500000001': NO() } });
    await loadContacts();
    expect(await screen.findByTestId('wa-skip-note')).toHaveTextContent('En 1 fila se usará el siguiente teléfono');
    expect(screen.getByTestId('send-phone-0:0')).toHaveTextContent('**0002');
    // "Todos los seleccionados": sin elección automática, solo el aviso.
    await userEvent.click(screen.getByRole('radio', { name: 'Todos los seleccionados' }));
    expect(screen.queryByTestId('wa-skip-note')).toBeNull();
    expect(screen.getByTestId('wa-warning')).toHaveTextContent('también se les enviará');
  });

  it('si la consulta falla, la tabla sigue usable y se puede reintentar', async () => {
    let fail = true;
    setApi({
      lookup: () => {
        if (fail) throw new ApiError(503, 'upstream_unavailable', 'Servicio no disponible');
        return { items: { '525500000002': NO() } };
      },
    });
    await loadContacts();
    expect(await screen.findByTestId('wa-lookup-error')).toBeInTheDocument();
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('3 fila(s)');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('wa-status-0:1')).toHaveTextContent('Sin WhatsApp');
  });
});
