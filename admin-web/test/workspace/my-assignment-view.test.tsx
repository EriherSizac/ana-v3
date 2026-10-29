import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import { draftKey } from '@/lib/workspace/wizard';
// Lo que de verdad publica v3 (los números del resumen deben coincidir).
import { buildPublication, overridesBySource } from '../../../v3/ana-backend/src/lib/publication';
import { parseAssignmentCsv as backendParse } from '../../../v3/ana-backend/src/lib/assignmentCsv';

/** add-agent-workspace: asistente "Mi asignación" (specs/admin-web/agent-workspace). */
const K1 = 'assignments/agents/prueba/ana.lopez-contacts-T1.csv';
const K2 = 'assignments/agents/prueba/ana.lopez-contacts-T2.csv';
const CSV1 = 'phone_number,first_name\n5215500000001,Ana\n5215500000002,Beto\n5215500000003,Ana María\n';
const CSV2 = 'phone_number,first_name,total_balance\n5215500000004,Carla,300\n';
const ago = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

type Handler = (url: string, init?: { method?: string; json?: any }) => unknown;
function setApi(opts: { campaigns?: string[]; pending?: unknown[]; files?: Record<string, string>; publications?: unknown[]; handler?: Handler } = {}) {
  const { campaigns = ['prueba'], files = { [K1]: CSV1, [K2]: CSV2 }, publications = [] } = opts;
  const pending = opts.pending ?? [
    { key: K2, fileName: 'ana.lopez-contacts-T2.csv', lastModified: ago(1), size: 60, etag: '"e2"', rows: 1, uploadIds: ['U2'] },
    { key: K1, fileName: 'ana.lopez-contacts-T1.csv', lastModified: ago(2), size: 80, etag: '"e1"', rows: 3, uploadIds: ['U1'] },
  ];
  const calls = { files: 0, list: 0 };
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    const h = opts.handler?.(url, init);
    if (h !== undefined) return h;
    if (url === '/api/agent/campaigns') return { campaigns };
    if (url.endsWith('/publications')) return { items: publications };
    const f = url.match(/\/file\?key=(.+)$/);
    if (f) {
      calls.files++;
      const key = decodeURIComponent(f[1]!);
      return { key, etag: key === K1 ? '"e1"' : '"e2"', csv: files[key] };
    }
    if (/^\/api\/agent\/assignments\/[^/]+$/.test(url)) {
      calls.list++;
      return { items: pending };
    }
    return {};
  });
  return calls;
}

async function pick(label: RegExp, option: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.click(screen.getByRole('option', { name: option }));
}
const next = () => userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
const back = () => userEvent.click(screen.getByRole('button', { name: 'Atrás' }));
const stepState = (n: number) => screen.getByTestId(`wizard-step-${n}`).getAttribute('data-state');

/** Paso 1 con los dos archivos marcados → paso 2. */
async function loadAll() {
  render(<MyAssignmentView />);
  await screen.findByTestId('pending-files');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T1.csv' }));
  await next();
  return screen.findByTestId('contacts-table');
}
/** Paso 1 con el archivo preseleccionado → paso 2. */
async function loadFirst() {
  render(<MyAssignmentView />);
  await screen.findByTestId('pending-files');
  await next();
  return screen.findByTestId('contacts-table');
}
async function writeMessage(text: string) {
  await next(); // → paso 3
  await userEvent.type(screen.getByLabelText('Mensaje para WhatsApp'), text);
}

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
  localStorage.clear();
  sessionStorage.clear();
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

  it('dos campañas: no preselecciona; al elegir muestra el paso 1 con el más reciente marcado, fecha, filas e id de carga', async () => {
    setApi({ campaigns: ['prueba', 'zendere'] });
    render(<MyAssignmentView />);
    expect(await screen.findByRole('button', { name: /Campaña/ })).not.toHaveTextContent('prueba');
    expect(screen.queryByTestId('wizard-step-1')).toBeNull();
    await pick(/Campaña/, 'prueba');
    const list = await screen.findByTestId('pending-files');
    expect(stepState(1)).toBe('current');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T2.csv' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T1.csv' })).not.toBeChecked();
    expect(list).toHaveTextContent('3 fila(s)');
    expect(list).toHaveTextContent('Carga: U1');
    expect(list).toHaveTextContent('Más reciente');
  });

  it('sin pendientes → "Sin asignaciones pendientes"; Skeleton mientras carga', async () => {
    let release!: () => void;
    setApi({
      pending: [],
      handler: (url) => (/assignments\/prueba$/.test(url) ? new Promise((r) => (release = () => r({ items: [] }))) : undefined),
    });
    render(<MyAssignmentView />);
    await waitFor(() => expect(screen.getByTestId('pending-skeleton')).toBeInTheDocument());
    release();
    expect(await screen.findByText('Sin asignaciones pendientes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('solo ofrece archivos de los últimos 3 meses (fecha de v3, de la llave o LastModified)', async () => {
    setApi({
      pending: [
        { key: K2, fileName: 'reciente.csv', lastModified: ago(10), size: 1, etag: '"e2"' },
        { key: K1, fileName: 'viejo-v3.csv', lastModified: ago(1), uploadedAt: ago(91), size: 1, etag: '"e1"' },
        { key: 'assignments/agents/prueba/ana.lopez-contacts-2020-01-01T10-00-00-000Z.csv', fileName: 'viejo-llave.csv', lastModified: ago(1), size: 1, etag: '"x"' },
        { key: 'assignments/agents/prueba/ana.lopez-contacts-x.csv', fileName: 'viejo-lm.csv', lastModified: ago(120), size: 1, etag: '"y"' },
      ],
    });
    render(<MyAssignmentView />);
    const list = await screen.findByTestId('pending-files');
    expect(within(list).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['Seleccionar reciente.csv']);
    expect(screen.getByTestId('hidden-old')).toHaveTextContent('3 archivo(s) con más de 3 meses no se muestran');
  });

  it('Siguiente se habilita solo con un archivo elegido; el stepper marca el paso completado', async () => {
    setApi();
    render(<MyAssignmentView />);
    await screen.findByTestId('pending-files');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T2.csv' }));
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(screen.getByTestId('step-block')).toHaveTextContent('Elige al menos un archivo');
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T1.csv' }));
    await next();
    await screen.findByTestId('contacts-table');
    expect(stepState(1)).toBe('complete');
    expect(stepState(2)).toBe('current');
    expect(screen.getByTestId('wizard-step-2')).toHaveAttribute('aria-current', 'step');
  });

  it('combina dos archivos: unión de columnas y teléfonos enmascarados', async () => {
    setApi();
    const table = await loadAll();
    const heads = within(table).getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(heads).toEqual(expect.arrayContaining(['phone_number', 'first_name', 'total_balance', 'Teléfono a enviar']));
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(table).toHaveTextContent('**0004');
    expect(table).not.toHaveTextContent('5215500000004');
  });

  it('búsqueda + "Seleccionar todos los resultados" opera solo sobre lo filtrado; sin selección no se avanza', async () => {
    setApi();
    await loadAll();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(screen.getByTestId('step-block')).toHaveTextContent('Selecciona al menos una fila');
    await userEvent.type(screen.getByLabelText('Buscar contactos'), 'Ana');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los resultados' }));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2 fila(s) seleccionada(s) · 2 teléfono(s)');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });

  it('Atrás conserva el trabajo: selección, mensaje y archivos (sin volver a descargarlos)', async () => {
    const calls = setApi();
    await loadAll();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar fila 1:0' }));
    await writeMessage('Hola');
    await back();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar fila 1:0' })).not.toBeChecked();
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('3 fila(s)');
    await back();
    await screen.findByTestId('pending-files');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar ana.lopez-contacts-T1.csv' })).toBeChecked();
    await next();
    await screen.findByTestId('contacts-table');
    expect(calls.files).toBe(2);
    expect(screen.getByRole('checkbox', { name: 'Seleccionar fila 1:0' })).not.toBeChecked();
    await next();
    expect(screen.getByLabelText('Mensaje para WhatsApp')).toHaveValue('Hola');
    // El stepper también permite volver a un paso completado.
    await userEvent.click(within(screen.getByTestId('wizard-step-1')).getByRole('button'));
    expect(await screen.findByTestId('pending-files')).toBeInTheDocument();
  });

  it('mensaje: vista previa de filas seleccionadas y variable desconocida bloquea Siguiente', async () => {
    setApi();
    await loadAll();
    await writeMessage('Hola {{{{first_name}}');
    const preview = screen.getByTestId('message-preview');
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    expect(preview).toHaveTextContent('Hola Carla');
    expect(preview).toHaveTextContent('Hola Ana');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Mensaje para WhatsApp'), ' {{{{apodo}}');
    expect(screen.getAllByText('Variable desconocida: {{apodo}}').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('mensaje vacío no avanza', async () => {
    setApi();
    await loadAll();
    await next();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(screen.getByTestId('step-block')).toHaveTextContent('Escribe el mensaje');
  });

  it('teléfonos: telefono_1..3 en orden, modo "Primer teléfono válido" por omisión, reordenar y "Todos los seleccionados"', async () => {
    setApi({
      pending: [{ key: K1, fileName: 'f.csv', lastModified: null, size: 1, etag: '"e1"' }],
      files: { [K1]: 'telefono_1,telefono_2,first_name\n5215500000001,5215500000002,Ana\n' },
    });
    await loadFirst();
    const order = screen.getByTestId('phone-order');
    expect(within(order).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1.telefono_1', '2.telefono_2']);
    expect(screen.getByRole('radio', { name: 'Primer teléfono válido' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('1 fila(s) seleccionada(s) · 1 teléfono(s)');
    expect(screen.getByTestId('send-phone-0:0')).toHaveTextContent('**0001');
    await userEvent.click(screen.getByRole('button', { name: 'Subir telefono_2' }));
    expect(within(order).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1.telefono_2', '2.telefono_1']);
    expect(screen.getByTestId('send-phone-0:0')).toHaveTextContent('**0002');
    await userEvent.click(screen.getByRole('radio', { name: 'Todos los seleccionados' }));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('1 fila(s) seleccionada(s) · 2 teléfono(s)');
  });

  it('teléfono elegido por fila: se muestra enmascarado y se envía en overrides', async () => {
    let sent: any = null;
    setApi({
      pending: [{ key: K1, fileName: 'f.csv', lastModified: null, size: 1, etag: '"e1"' }],
      files: { [K1]: 'telefono_1,telefono_2,first_name\n5215500000001,5215500000002,Ana\n5215500000003,,Beto\n' },
      handler: (_url, init) => {
        if (init?.method === 'POST') {
          sent = init.json;
          return { publishId: 'p1', manifest: { contacts: 2, rows: 2 } };
        }
        return undefined;
      },
    });
    await loadFirst();
    // Una sola opción válida → sin selector.
    expect(within(screen.getByTestId('send-phone-0:1')).queryByRole('button')).toBeNull();
    await pick(/Teléfono a enviar fila 0:0/, '**0002 · telefono_2');
    expect(screen.getByTestId('send-phone-0:0')).toHaveTextContent('**0002');
    await writeMessage('Hola {{{{first_name}}');
    await next();
    expect(screen.getByTestId('summary-samples')).toHaveTextContent('**0002');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar' }));
    await screen.findByTestId('publish-success');
    expect(sent).toMatchObject({ phoneMode: 'first', phoneColumns: ['telefono_1', 'telefono_2'], overrides: { [`${K1}#0`]: '5215500000002' } });
  });

  it('insertar variable agrega {{columna}} al mensaje', async () => {
    setApi();
    await loadAll();
    await next();
    await pick(/Insertar variable/, '{{first_name}}');
    expect(screen.getByLabelText('Mensaje para WhatsApp')).toHaveValue('{{first_name}}');
  });

  it('envío con ConfirmDialog: resumen, pantalla de éxito con id, recarga de pendientes e historial', async () => {
    let sent: any = null;
    let published = false;
    setApi({
      handler: (url, init) => {
        if (init?.method === 'POST') {
          sent = init.json;
          published = true;
          return { publishId: 'p1', manifest: { publishId: 'p1', contacts: 4, rows: 4 } };
        }
        if (url.endsWith('/publications') && published)
          return { items: [{ publishId: 'p1', publishedAt: '2026-10-26T12:00:00Z', contacts: 4, rows: 4, sources: [{ key: K1, rows: 3, remaining: 0, action: 'deleted' }] }] };
        if (/assignments\/prueba$/.test(url) && published) return { items: [] };
        return undefined;
      },
    });
    await loadAll();
    await writeMessage('Hola {{{{first_name}}');
    await next();
    const summary = screen.getByTestId('wizard-summary');
    expect(screen.getByTestId('summary-selected')).toHaveTextContent('4');
    expect(screen.getByTestId('summary-messages')).toHaveTextContent('4');
    expect(screen.getByTestId('summary-phone-mode')).toHaveTextContent('Primer teléfono válido · phone_number');
    expect(summary).toHaveTextContent('ana.lopez-contacts-T1.csv');
    expect(within(screen.getByTestId('summary-samples')).getAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('prueba · 4 fila(s) · 4 mensaje(s)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    const success = await screen.findByTestId('publish-success');
    expect(success).toHaveTextContent('Publicado: 4 mensaje(s) de 4 fila(s); tu CLI los enviará en su siguiente consulta.');
    expect(success).toHaveTextContent('p1');
    expect(within(success).getByRole('link', { name: 'Ver historial' })).toHaveAttribute('href', '#historial');
    expect(sent).toEqual({
      template: 'Hola {{first_name}}',
      phoneColumns: ['phone_number'],
      phoneMode: 'first',
      overrides: {},
      sources: [
        { key: K2, etag: '"e2"', rows: [0] },
        { key: K1, etag: '"e1"', rows: [0, 1, 2] },
      ],
    });
    const pub = await screen.findByTestId('publication-p1');
    expect(pub).toHaveTextContent('Consumido');
    expect(sessionStorage.getItem(draftKey('prueba'))).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Nueva asignación' }));
    expect(await screen.findByText('Sin asignaciones pendientes')).toBeInTheDocument();
  });

  it('409 (asignación cambiada) → vuelve al paso 1 con aviso y recarga de pendientes', async () => {
    const calls = setApi({
      handler: (_url, init) => {
        if (init?.method === 'POST') throw new ApiError(409, 'conflict', 'La asignación cambió; vuelve a cargarla');
        return undefined;
      },
    });
    await loadAll();
    await writeMessage('Hola');
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('La asignación cambió; vuelve a cargarla')).toBeInTheDocument();
    await waitFor(() => expect(calls.list).toBeGreaterThan(1));
    expect(stepState(1)).toBe('current');
    expect(screen.queryByTestId('contacts-table')).toBeNull();
  });

  it('400 "Asignación con más de 3 meses" → vuelve al paso 1 con el aviso', async () => {
    setApi({
      handler: (_url, init) => {
        if (init?.method === 'POST') throw new ApiError(400, 'invalid_request', 'Asignación con más de 3 meses');
        return undefined;
      },
    });
    await loadAll();
    await writeMessage('Hola');
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Asignación con más de 3 meses')).toBeInTheDocument();
    expect(stepState(1)).toBe('current');
  });

  it('otro error al enviar → mensaje en el resumen sin perder el trabajo', async () => {
    setApi({
      handler: (_url, init) => {
        if (init?.method === 'POST') throw new ApiError(500, 'internal', 'Error interno del servidor');
        return undefined;
      },
    });
    await loadAll();
    await writeMessage('Hola');
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Error interno del servidor')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-summary')).toBeInTheDocument();
  });

  it('precarga el mensaje con la columna message del archivo', async () => {
    setApi({ pending: [{ key: K1, fileName: 'f.csv', lastModified: null, size: 1, etag: '"e1"' }], files: { [K1]: 'phone,first_name,message\n5215500000001,Ana,Hola {first_name}\n' } });
    await loadFirst();
    await next();
    expect(screen.getByLabelText('Mensaje para WhatsApp')).toHaveValue('Hola {first_name}');
    expect(screen.getByTestId('message-preview')).toHaveTextContent('Hola Ana');
  });

  it('borrador por campaña en sessionStorage: una recarga vuelve al mismo paso con el mismo trabajo', async () => {
    setApi();
    await loadAll();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar fila 1:0' }));
    await writeMessage('Hola {{{{first_name}}');
    expect(JSON.parse(sessionStorage.getItem(draftKey('prueba'))!)).toMatchObject({ step: 3, keys: [K2, K1], template: 'Hola {{first_name}}' });
    cleanup();
    render(<MyAssignmentView />);
    expect(await screen.findByLabelText('Mensaje para WhatsApp')).toHaveValue('Hola {{first_name}}');
    expect(stepState(3)).toBe('current');
    await back();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar fila 1:0' })).not.toBeChecked();
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('3 fila(s)');
  });

  it('borrador corrupto se ignora', async () => {
    sessionStorage.setItem(draftKey('prueba'), '{roto');
    setApi();
    render(<MyAssignmentView />);
    expect(await screen.findByTestId('pending-files')).toBeInTheDocument();
    expect(stepState(1)).toBe('current');
  });

  it('historial vacío → "Sin publicaciones"', async () => {
    setApi();
    render(<MyAssignmentView />);
    expect(await screen.findByText('Sin publicaciones')).toBeInTheDocument();
  });
});

describe('resumen = resultado de v3', () => {
  const CSV = [
    'id_credito,nombre,telefono_1,telefono_2',
    'C1,Ana,5215500000001,5215500000002',
    'C1,Ana bis,5215500000003,',
    'C2,Beto,123,',
    'C3,Carla,5215500000004,5215500000005',
  ].join('\n') + '\n';

  it('mensajes y excluidas por motivo coinciden con buildPublication en ambos modos', async () => {
    let built = 0;
    setApi({
      pending: [{ key: K1, fileName: 'f.csv', lastModified: null, size: 1, etag: '"e1"' }],
      files: { [K1]: CSV },
      handler: (_url, init) => {
        if (init?.method !== 'POST') return undefined;
        const req = JSON.parse(JSON.stringify(init.json));
        const out = buildPublication([backendParse(CSV)], req.sources.map((s: any) => s.rows), req.template, req.phoneColumns, {
          phoneMode: req.phoneMode,
          overrides: overridesBySource(req),
        });
        built = out.rows.length;
        return { publishId: 'p9', manifest: { publishId: 'p9', contacts: out.rows.length, rows: 4 } };
      },
    });
    await loadFirst();
    await writeMessage('Hola {{{{nombre}}');
    await next();
    expect(screen.getByTestId('summary-messages')).toHaveTextContent('2');
    const reasons = screen.getByTestId('summary-excluded-reasons');
    expect(reasons).toHaveTextContent('Sin teléfono válido en las columnas elegidas1');
    expect(reasons).toHaveTextContent('Crédito o teléfono repetido (ya incluido)1');

    // Modo "Todos los seleccionados": 2 + 1 + 0 + 2.
    await userEvent.click(within(screen.getByTestId('wizard-step-2')).getByRole('button'));
    await userEvent.click(screen.getByRole('radio', { name: 'Todos los seleccionados' }));
    await next();
    await next();
    expect(screen.getByTestId('summary-messages')).toHaveTextContent('5');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByTestId('publish-success')).toHaveTextContent('Publicado: 5 mensaje(s) de 4 fila(s)');
    expect(built).toBe(5);
  });
});
