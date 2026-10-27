import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRow, UsersResponse } from '@/lib/agents';
import { resetNavigation, setLocation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));
vi.mock('@/lib/auth-client', () => ({ hasSession: async () => true, logout: vi.fn(), currentIdToken: vi.fn() }));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import { AgentsView } from '@/components/agents/AgentsView';
import { ConsoleGate } from '@/components/system/ConsoleGate';
import { ApiError } from '@/lib/api-client';

const now = new Date().toISOString();

const ana: UserRow = {
  username: 'ana.lopez',
  name: 'Ana López',
  email: 'ana@ejemplo.mx',
  enabled: true,
  status: 'CONFIRMED',
  roles: [{ roleName: 'Agente DIDI VIP', campaign: 'didi_vip' }],
  fleets: { v3: { state: 'agent', override: null }, v4: { state: 'agent', override: null, lastSeen: 1761400000000 } },
};
const luis: UserRow = {
  username: 'luis',
  name: null,
  email: 'luis@ejemplo.mx',
  enabled: true,
  status: 'CONFIRMED',
  roles: [{ roleName: 'Líder DIDI VIP', campaign: 'didi_vip' }],
  fleets: {
    v3: { state: 'not_agent', reason: 'Sin rol con permiso de envío en la campaña' },
    v4: { state: 'not_agent', reason: 'Sin rol con permiso de envío en la campaña' },
  },
};

const listing = (over: Partial<UsersResponse> = {}, users: UserRow[] = [ana, luis]): UsersResponse => ({
  users,
  total: users.length,
  page: 1,
  pageSize: 50,
  rolesAvailable: true,
  campaign: 'didi_vip',
  fleets: { v3: { available: true, generatedAt: now }, v4: { available: true, generatedAt: now } },
  inactiveOverrides: { v3: [], v4: [] },
  ...over,
});

const noCampaign = (users: UserRow[] = [ana, luis]): UsersResponse => ({
  ...listing({}, users.map(({ fleets: _f, ...u }) => u)),
  campaign: null,
  fleets: null,
  inactiveOverrides: null,
});

type Handler = (url: string, init?: { method?: string; json?: unknown }) => unknown;
function setApi(handler: Handler) {
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: unknown }) => {
    if (url === '/api/campaigns') return { campaigns: ['didi_vip', 'zendere'] };
    return handler(url, init);
  });
}

async function chooseCampaign(name = 'didi_vip') {
  await userEvent.click(await screen.findByRole('button', { name: /Campaña/ }));
  await userEvent.click(screen.getByRole('option', { name }));
}

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('/agentes', () => {
  it('usuario con solo carga de contactos ve "Sin acceso" y la sección no aparece en la navegación', async () => {
    setLocation('/agentes');
    apiFetch.mockResolvedValue({
      username: 'carga.only',
      permissions: ['ana:contacts:list:upload'],
      campaigns: ['didi_vip'],
      roleNames: ['Carga'],
      isAdmin: false,
      isLeader: false,
      isDeveloper: false,
    });
    render(
      <ConsoleGate>
        <AgentsView />
      </ConsoleGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Secciones' })).queryByRole('link', { name: 'Agentes' })).toBeNull();
  });

  it('búsqueda envía `search` y la tabla muestra los resultados', async () => {
    setApi((url) => (url.includes('search=lopez') ? noCampaign([ana]) : noCampaign()));
    render(<AgentsView />);
    expect(await screen.findByText('luis')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Buscar'), 'lopez');
    await waitFor(() => expect(screen.queryByText('luis')).toBeNull());
    expect(screen.getByText('ana.lopez')).toBeInTheDocument();
  });

  it('muestra Skeleton mientras carga', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    render(<AgentsView />);
    expect(screen.getByTestId('skeleton-rows')).toBeInTheDocument();
  });

  it('API de Roles caída → aviso "Roles no disponibles" sin bloquear la lista', async () => {
    setApi(() => ({ ...noCampaign([{ ...ana, roles: null, fleets: undefined }]), rolesAvailable: false }));
    render(<AgentsView />);
    expect(await screen.findByText(/Roles no disponibles: la API de Roles/)).toBeInTheDocument();
    expect(screen.getByText('ana.lopez')).toBeInTheDocument();
  });

  it('elegir campaña muestra estado en v3 y v4 y la última actividad', async () => {
    setApi((url) => (url.includes('campaign=didi_vip') ? listing() : noCampaign()));
    render(<AgentsView />);
    await chooseCampaign();
    const v3 = await screen.findByTestId('state-v3-ana.lopez');
    expect(v3).toHaveTextContent('Agente');
    expect(screen.getByTestId('state-v4-ana.lopez')).toHaveTextContent(/Actividad:/);
  });

  it('supervisora: insignia "Supervisor" junto al estado y se deshabilita igual que un agente', async () => {
    const sara: UserRow = {
      username: 'sara',
      name: 'Sara',
      email: null,
      enabled: true,
      status: 'CONFIRMED',
      roles: [{ roleName: 'Supervisor DIDI VIP', campaign: 'didi_vip' }],
      fleets: { v3: { state: 'agent', override: null, kind: 'supervisor' }, v4: { state: 'agent', override: null, kind: 'supervisor', lastSeen: null } },
    };
    let disabled = false;
    setApi((url) => {
      if (url === '/api/campaigns/didi_vip/agents') {
        disabled = true;
        return { fleet: 'v3', roster: {} };
      }
      if (!url.includes('campaign=')) return noCampaign([sara]);
      return listing({}, [
        disabled ? { ...sara, fleets: { ...sara.fleets!, v3: { state: 'disabled', kind: 'supervisor', override: { enabled: false, updatedAt: now, updatedBy: 'lider.didi' } } } } : sara,
      ]);
    });
    render(<AgentsView />);
    await chooseCampaign();
    const v3 = await screen.findByTestId('state-v3-sara');
    expect(v3).toHaveTextContent('Agente');
    expect(within(v3).getByText('Supervisor')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Deshabilitar en v3' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deshabilitar' }));
    await waitFor(() => expect(screen.getByTestId('state-v3-sara')).toHaveTextContent('Deshabilitado'));
    expect(within(screen.getByTestId('state-v3-sara')).getByText('Supervisor')).toBeInTheDocument();
  });

  it('"No es agente": sin control de habilitar y con motivo', async () => {
    setApi((url) => (url.includes('campaign=') ? listing() : noCampaign()));
    render(<AgentsView />);
    await chooseCampaign();
    const row = await screen.findByTestId('row-luis');
    expect(within(row).getAllByText('Sin rol con permiso de envío en la campaña').length).toBeGreaterThan(0);
    expect(within(row).queryByRole('button', { name: /Rehabilitar|Habilitar/ })).toBeNull();
  });

  it('una flota no disponible: "No disponible" con reintentar; la otra normal', async () => {
    let calls = 0;
    setApi((url) => {
      if (!url.includes('campaign=')) return noCampaign();
      calls++;
      return calls === 1
        ? listing({ fleets: { v3: { available: false, generatedAt: null }, v4: { available: true, generatedAt: now } } }, [
            { ...ana, fleets: { v3: { state: 'unavailable' }, v4: ana.fleets!.v4 } },
          ])
        : listing({}, [ana]);
    });
    render(<AgentsView />);
    await chooseCampaign();
    const v3 = await screen.findByTestId('state-v3-ana.lopez');
    expect(v3).toHaveTextContent('No disponible');
    expect(screen.getByTestId('state-v4-ana.lopez')).toHaveTextContent('Agente');
    await userEvent.click(within(v3).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByTestId('state-v3-ana.lopez')).toHaveTextContent('Agente'));
  });

  it('sincronización atrasada (> 30 min) → aviso con fecha', async () => {
    const old = new Date(Date.now() - 45 * 60_000).toISOString();
    setApi((url) => (url.includes('campaign=') ? listing({ fleets: { v3: { available: true, generatedAt: old }, v4: { available: true, generatedAt: now } } }) : noCampaign()));
    render(<AgentsView />);
    await chooseCampaign();
    expect(await screen.findByText(/Lista de agentes desactualizada desde/)).toBeInTheDocument();
  });

  it('deshabilitar en v3 con ConfirmDialog destructivo → la fila muestra "Deshabilitado" con autor', async () => {
    let disabled = false;
    setApi((url, init) => {
      if (url === '/api/campaigns/didi_vip/agents') {
        expect(init?.json).toEqual({ fleet: 'v3', agents: [{ username: 'ana.lopez', enabled: false }] });
        disabled = true;
        return { fleet: 'v3', roster: {} };
      }
      if (!url.includes('campaign=')) return noCampaign();
      return listing({}, [
        disabled
          ? { ...ana, fleets: { ...ana.fleets!, v3: { state: 'disabled', override: { enabled: false, updatedAt: now, updatedBy: 'lider.didi' } } } }
          : ana,
      ]);
    });
    render(<AgentsView />);
    await chooseCampaign();
    await userEvent.click(await screen.findByRole('button', { name: 'Deshabilitar en v3' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Deshabilitar en v3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deshabilitar' }));
    await waitFor(() => expect(screen.getByTestId('state-v3-ana.lopez')).toHaveTextContent('Deshabilitado'));
    expect(screen.getByTestId('state-v3-ana.lopez')).toHaveTextContent('lider.didi');
    expect(screen.getByRole('button', { name: 'Rehabilitar en v3' })).toBeInTheDocument();
  });

  it('error al aplicar → mensaje inline en la fila', async () => {
    setApi((url) => {
      if (url === '/api/campaigns/didi_vip/agents') throw new ApiError(409, 'conflict', 'No es agente de la campaña');
      return url.includes('campaign=') ? listing({}, [ana]) : noCampaign();
    });
    render(<AgentsView />);
    await chooseCampaign();
    await userEvent.click(await screen.findByRole('button', { name: 'Deshabilitar en v4' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deshabilitar' }));
    expect(await within(screen.getByTestId('row-ana.lopez')).findByRole('alert')).toHaveTextContent('v4: No es agente de la campaña');
  });

  it('acción masiva en ambas flotas con fallo parcial: resumen por flota', async () => {
    const users = Array.from({ length: 10 }, (_, i) => ({ ...ana, username: `agente${i}`, name: null, email: null }));
    setApi((url, init) => {
      if (url === '/api/campaigns/didi_vip/agents') {
        const body = init?.json as { fleet: string; agents: unknown[] };
        expect(body.agents).toHaveLength(10);
        if (body.fleet === 'v4') throw new ApiError(503, 'upstream_unavailable', 'El servicio no está disponible. Intenta de nuevo.');
        return { fleet: 'v3', roster: {} };
      }
      return url.includes('campaign=') ? listing({}, users) : noCampaign(users);
    });
    render(<AgentsView />);
    await chooseCampaign();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar todos' }));
    expect(screen.getByText('10 seleccionados')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Deshabilitar' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('10 agente(s)');
    expect(dialog).toHaveTextContent('v3 y v4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deshabilitar' }));
    const outcome = await screen.findByTestId('bulk-outcome');
    expect(outcome).toHaveTextContent('v3: 10 aplicados, 0 fallidos');
    expect(outcome).toHaveTextContent('v4: 0 aplicados, 10 fallidos');
  });

  it('"Excepciones sin efecto" lista aparte las excepciones de quienes ya no son agentes', async () => {
    setApi((url) =>
      url.includes('campaign=')
        ? listing({ inactiveOverrides: { v3: [{ username: 'viejo.agente', enabled: false, updatedAt: now, updatedBy: 'erick.silva' }], v4: [] } }, [ana])
        : noCampaign(),
    );
    render(<AgentsView />);
    await chooseCampaign();
    const section = await screen.findByRole('region', { name: 'Excepciones sin efecto' });
    expect(within(section).getByText('viejo.agente')).toBeInTheDocument();
    expect(within(section).getByText('erick.silva')).toBeInTheDocument();
    expect(screen.queryByTestId('row-viejo.agente')).toBeNull();
  });

  it('detalle de usuario sin controles de directorio', async () => {
    setApi((url) => {
      if (url.startsWith('/api/users/')) return { roles: [{ roleName: 'Agente DIDI VIP', campaign: 'didi_vip', permissions: [] }] };
      return noCampaign();
    });
    render(<AgentsView />);
    await userEvent.click(await screen.findByText('ana.lopez'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Agente DIDI VIP')).toBeInTheDocument();
    const buttons = within(dialog).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(buttons).toEqual(['Cerrar']);
    expect(dialog).not.toHaveTextContent(/Crear|Editar|Borrar|Resetear|contraseña nueva/);
  });
});
