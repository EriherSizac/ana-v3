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

import { MyAssignmentView } from '@/components/workspace/MyAssignmentView';
import { ConsoleGate } from '@/components/system/ConsoleGate';
import { ApiError } from '@/lib/api-client';

/** add-agent-workspace 2.4: escenarios de specs/admin-web/agent-workspace. */
const K1 = 'assignments/agents/prueba/ana.lopez-contacts-T1.csv';
const K2 = 'assignments/agents/prueba/ana.lopez-contacts-T2.csv';
const CSV1 = 'phone_number,first_name\n5215500000001,Ana\n5215500000002,Beto\n5215500000003,Ana María\n';
const CSV2 = 'phone_number,first_name,total_balance\n5215500000004,Carla,300\n';

type Handler = (url: string, init?: { method?: string; json?: any }) => unknown;
function setApi(opts: { campaigns?: string[]; pending?: unknown[]; files?: Record<string, string>; publications?: unknown[]; handler?: Handler } = {}) {
  const { campaigns = ['prueba'], files = { [K1]: CSV1, [K2]: CSV2 }, publications = [] } = opts;
  let pending = opts.pending ?? [
    { key: K2, fileName: 'ana.lopez-contacts-T2.csv', lastModified: '2026-10-26T11:00:00Z', size: 60, etag: '"e2"' },
    { key: K1, fileName: 'ana.lopez-contacts-T1.csv', lastModified: '2026-10-26T10:00:00Z', size: 80, etag: '"e1"' },
  ];
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    const h = opts.handler?.(url, init);
    if (h !== undefined) {
      if (h && typeof h === 'object' && 'pending' in (h as object)) pending = (h as { pending: unknown[] }).pending;
      else return h;
    }
    if (url === '/api/agent/campaigns') return { campaigns };
    if (url.endsWith('/publications')) return { items: publications };
    const f = url.match(/\/file\?key=(.+)$/);
    if (f) {
      const key = decodeURIComponent(f[1]!);
      return { key, etag: key === K1 ? '"e1"' : '"e2"', csv: files[key] };
    }
    if (/^\/api\/agent\/assignments\/[^/]+$/.test(url)) return { items: pending };
    return {};
  });
}

async function pick(label: RegExp, option: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.click(screen.getByRole('option', { name: option }));
}

async function loadAll() {
  render(<MyAssignmentView />);
  await screen.findByTestId('pending-files');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T1.csv' }));
  await userEvent.click(screen.getByRole('button', { name: /Cargar seleccionados \(2\)/ }));
  return screen.findByTestId('contacts-table');
}

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('/mi-asignacion', () => {
  it('agente con solo envío: la navegación muestra solo "Mi asignación"', async () => {
    setLocation('/mi-asignacion');
    apiFetch.mockImplementation(async (url: string) =>
      url === '/api/me'
        ? { username: 'ana.lopez', permissions: ['ana:campaign:message:send'], campaigns: ['prueba'], roleNames: ['Agente Prueba'], isAdmin: false, isLeader: false, isDeveloper: false }
        : url === '/api/agent/campaigns'
          ? { campaigns: [] }
          : {},
    );
    render(
      <ConsoleGate>
        <MyAssignmentView />
      </ConsoleGate>,
    );
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Mi asignación' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Contactos' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Agentes' })).toBeNull();
  });

  it('sin permiso de envío → "Sin acceso"', async () => {
    setLocation('/mi-asignacion');
    apiFetch.mockResolvedValue({ username: 'u', permissions: ['ana:contacts:list:upload'], campaigns: [], roleNames: [], isAdmin: false, isLeader: false, isDeveloper: false });
    render(
      <ConsoleGate>
        <MyAssignmentView />
      </ConsoleGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
  });

  it('sin campañas habilitadas → aviso', async () => {
    setApi({ campaigns: [] });
    render(<MyAssignmentView />);
    expect(await screen.findByText('No estás habilitado como agente v3 en ninguna campaña')).toBeInTheDocument();
  });

  it('dos campañas: no preselecciona; al elegir lista los pendientes con el más reciente marcado', async () => {
    setApi({ campaigns: ['prueba', 'zendere'] });
    render(<MyAssignmentView />);
    expect(await screen.findByRole('button', { name: /Campaña/ })).not.toHaveTextContent('prueba');
    await pick(/Campaña/, 'prueba');
    await screen.findByTestId('pending-files');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T2.csv' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T1.csv' })).not.toBeChecked();
  });

  it('sin pendientes → "Sin asignaciones pendientes"; Skeleton mientras carga', async () => {
    let release!: () => void;
    setApi({
      pending: [],
      handler: (url) => (/assignments\/prueba$/.test(url) ? new Promise((r) => (release = () => r({ items: [] }))) : undefined),
    });
    render(<MyAssignmentView />);
    await waitFor(() => expect(screen.getByTestId('skeleton-rows')).toBeInTheDocument());
    release();
    expect(await screen.findByText('Sin asignaciones pendientes')).toBeInTheDocument();
  });

  it('combina dos archivos: unión de columnas y teléfonos enmascarados', async () => {
    setApi();
    const table = await loadAll();
    const heads = within(table).getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(heads).toEqual(expect.arrayContaining(['phone_number', 'first_name', 'total_balance', 'Vista previa']));
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(table).toHaveTextContent('**0004');
    expect(table).not.toHaveTextContent('5215500000004');
  });

  it('búsqueda + "Seleccionar todos los resultados" opera solo sobre lo filtrado', async () => {
    setApi();
    await loadAll();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.queryByText(/fila\(s\) seleccionada/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Buscar contactos'), 'Ana');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.getByText(/2 fila\(s\) seleccionada\(s\) · 2 teléfono\(s\)/)).toBeInTheDocument();
  });

  it('columna de teléfono preseleccionada (telefono_1) y se puede agregar telefono_2', async () => {
    setApi({ pending: [{ key: K1, fileName: 'f.csv', lastModified: null, size: 1, etag: '"e1"' }], files: { [K1]: 'telefono_1,telefono_2,first_name\n5215500000001,5215500000002,Ana\n' } });
    render(<MyAssignmentView />);
    await screen.findByTestId('pending-files');
    await userEvent.click(screen.getByRole('button', { name: /Cargar seleccionados/ }));
    await screen.findByTestId('contacts-table');
    expect(screen.getByText('Teléfono: telefono_1')).toBeInTheDocument();
    expect(screen.getByText(/1 fila\(s\) seleccionada\(s\) · 1 teléfono\(s\)/)).toBeInTheDocument();
    await pick(/Columnas de teléfono/, 'telefono_2');
    expect(screen.getByText(/1 fila\(s\) seleccionada\(s\) · 2 teléfono\(s\)/)).toBeInTheDocument();
  });

  it('vista previa por fila y variable desconocida bloquea "Publicar"', async () => {
    setApi();
    await loadAll();
    await userEvent.type(screen.getByLabelText('Mensaje para WhatsApp'), 'Hola {{{{first_name}}');
    expect(screen.getByTestId('row-1:1')).toHaveTextContent('Hola Beto');
    expect(screen.getByRole('button', { name: /Publicar/ })).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Mensaje para WhatsApp'), ' {{{{apodo}}');
    expect(screen.getAllByText('Variable desconocida: {{apodo}}').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Publicar/ })).toBeDisabled();
  });

  it('insertar variable agrega {{columna}} al mensaje', async () => {
    setApi();
    await loadAll();
    await pick(/Insertar variable/, '{{first_name}}');
    expect(screen.getByLabelText('Mensaje para WhatsApp')).toHaveValue('{{first_name}}');
  });

  it('publicación exitosa con ConfirmDialog: mensaje, recarga de pendientes e historial', async () => {
    let sent: any = null;
    let published = false;
    setApi({
      handler: (url, init) => {
        if (init?.method === 'POST') {
          sent = init.json;
          published = true;
          return { publishId: 'p1', manifest: { contacts: 4 } };
        }
        if (url.endsWith('/publications') && published)
          return { items: [{ publishId: 'p1', publishedAt: '2026-10-26T12:00:00Z', contacts: 4, rows: 4, sources: [{ key: K1, rows: 3, remaining: 0, action: 'deleted' }] }] };
        if (/assignments\/prueba$/.test(url) && published) return { items: [] };
        return undefined;
      },
    });
    await loadAll();
    await userEvent.type(screen.getByLabelText('Mensaje para WhatsApp'), 'Hola {{{{first_name}}');
    await userEvent.click(screen.getByRole('button', { name: 'Publicar (4)' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('prueba · 4 fila(s) · 4 teléfono(s)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('Publicado: 4 contactos; el CLI los enviará en su siguiente consulta.')).toBeInTheDocument();
    expect(sent).toEqual({
      template: 'Hola {{first_name}}',
      phoneColumns: ['phone_number'],
      sources: [
        { key: K2, etag: '"e2"', rows: [0] },
        { key: K1, etag: '"e1"', rows: [0, 1, 2] },
      ],
    });
    expect(await screen.findByText('Sin asignaciones pendientes')).toBeInTheDocument();
    const pub = await screen.findByTestId('publication-p1');
    expect(pub).toHaveTextContent('Consumido');
    expect(pub).toHaveTextContent('4');
  });

  it('409 (asignación cambiada) → mensaje y recarga de pendientes', async () => {
    let listCalls = 0;
    setApi({
      handler: (url, init) => {
        if (init?.method === 'POST') throw new ApiError(409, 'conflict', 'La asignación cambió; vuelve a cargarla');
        if (/assignments\/prueba$/.test(url)) listCalls++;
        return undefined;
      },
    });
    await loadAll();
    await userEvent.type(screen.getByLabelText('Mensaje para WhatsApp'), 'Hola');
    await userEvent.click(screen.getByRole('button', { name: /Publicar/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('La asignación cambió; vuelve a cargarla')).toBeInTheDocument();
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
    expect(screen.queryByTestId('contacts-table')).toBeNull();
  });

  it('precarga el mensaje con la columna message del archivo', async () => {
    setApi({ pending: [{ key: K1, fileName: 'f.csv', lastModified: null, size: 1, etag: '"e1"' }], files: { [K1]: 'phone,first_name,message\n5215500000001,Ana,Hola {first_name}\n' } });
    render(<MyAssignmentView />);
    await screen.findByTestId('pending-files');
    await userEvent.click(screen.getByRole('button', { name: /Cargar seleccionados/ }));
    await screen.findByTestId('contacts-table');
    expect(screen.getByLabelText('Mensaje para WhatsApp')).toHaveValue('Hola {first_name}');
    expect(screen.getByTestId('message-preview')).toHaveTextContent('Hola Ana');
  });

  it('historial vacío → "Sin publicaciones"', async () => {
    setApi();
    render(<MyAssignmentView />);
    expect(await screen.findByText('Sin publicaciones')).toBeInTheDocument();
  });
});
