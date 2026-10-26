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

import { ContactsUploadView } from '@/components/contacts/ContactsUploadView';
import { UploadHistoryView } from '@/components/contacts/UploadHistoryView';
import { ConsoleGate } from '@/components/system/ConsoleGate';
import { ApiError } from '@/lib/api-client';

type Handler = (url: string, init?: { method?: string; json?: any }) => unknown;
function setApi(enabled: Record<string, string[]>, handler: Handler = () => ({})) {
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    if (url === '/api/campaigns') return { campaigns: ['didi_vip', 'zendere'] };
    const m = url.match(/^\/api\/campaigns\/([^/]+)\/enabled-agents\?fleet=(v3|v4)$/);
    if (m) return { agents: enabled[`${m[1]}:${m[2]}`] ?? [] };
    return handler(url, init);
  });
}

async function pick(label: RegExp, option: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.click(screen.getByRole('option', { name: option }));
}

const csvFile = (text: string, name = 'contactos.csv') => new File([text], name, { type: 'text/csv' });
const tenRows = 'contact_phone,first_name\n' + Array.from({ length: 10 }, (_, i) => `52155000001${String(i).padStart(2, '0')},N${i}`).join('\n');

async function setup(campaign = 'didi_vip', fleet = 'v3 (CLI)') {
  render(<ContactsUploadView pollIntervalMs={10} pollTimeoutMs={200} />);
  await pick(/Campaña/, campaign);
  await pick(/Flota/, fleet);
}

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('/contactos', () => {
  it('solo permiso de carga (sin reparto) → "Sin acceso"', async () => {
    setLocation('/contactos');
    apiFetch.mockResolvedValue({ username: 'u', permissions: ['ana:contacts:list:upload'], campaigns: ['didi_vip'], roleNames: [], isAdmin: false, isLeader: false, isDeveloper: false });
    render(
      <ConsoleGate>
        <ContactsUploadView />
      </ConsoleGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
  });

  it('campaña sin agentes habilitados → aviso con enlace a /agentes y sin carga de archivo', async () => {
    setApi({ 'didi_vip:v3': ['ana'] });
    await setup('zendere');
    const msg = await screen.findByText(/No hay agentes habilitados en esta campaña para v3/);
    expect(within(msg).getByRole('link', { name: 'Ir a Agentes' })).toHaveAttribute('href', '/agentes');
    expect(screen.getByLabelText('Archivo CSV')).toBeDisabled();
  });

  it('archivo de 6 MB para v3 → mensaje y no envía nada', async () => {
    setApi({ 'didi_vip:v3': ['ana'] });
    await setup();
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'grande.csv', { type: 'text/csv' });
    await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), big);
    expect(await screen.findByText('El archivo supera 4 MB para v3')).toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('CSV en español para v3 → exige alias de teléfono', async () => {
    setApi({ 'didi_vip:v3': ['ana'] });
    await setup();
    await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), csvFile('telefono,nombre\n5215500000001,Ana'));
    expect(await screen.findByText(/v3 requiere una columna de teléfono phone_number, contact_phone, contact_pho o phone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeDisabled();
  });

  it('500 filas con 3 sin teléfono y 2 repetidas → 495 válidas y 5 inválidas con causa', async () => {
    setApi({ 'didi_vip:v3': ['ana'] });
    await setup();
    const rows = Array.from({ length: 500 }, (_, i) => (i === 0 ? '5215500000010,P' : i <= 3 ? `,S${i}` : i <= 5 ? `5215500000010,R${i}` : `${5215500001000 + i},N${i}`));
    await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), csvFile(`phone,name\n${rows.join('\n')}`));
    const summary = await screen.findByTestId('validation-summary');
    expect(summary).toHaveTextContent('495 válidas');
    expect(summary).toHaveTextContent('5 inválidas');
    expect(within(summary).getAllByText('Sin teléfono')).toHaveLength(3);
    expect(within(summary).getAllByText('Teléfono duplicado')).toHaveLength(2);
  });

  it('v3 sin mensaje → vista previa deshabilitada con "Escribe el mensaje"', async () => {
    setApi({ 'didi_vip:v3': ['ana'] });
    await setup();
    await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), csvFile(tenRows));
    await screen.findByTestId('validation-summary');
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeDisabled();
    expect(screen.getByText('Escribe el mensaje')).toBeInTheDocument();
  });

  async function previewTen() {
    await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), csvFile(tenRows));
    await screen.findByTestId('validation-summary');
    await userEvent.type(screen.getByLabelText(/Mensaje plantilla/), 'Hola {{first_name}');
    await userEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    return screen.findByTestId('preview');
  }

  it('reparto entre tres agentes: 4/3/3 con primeras filas y mensaje', async () => {
    setApi({ 'didi_vip:v3': ['carla', 'ana', 'beto'] });
    await setup();
    await previewTen();
    expect(screen.getByTestId('preview-ana')).toHaveTextContent('4 contactos');
    expect(screen.getByTestId('preview-beto')).toHaveTextContent('3 contactos');
    expect(screen.getByTestId('preview-carla')).toHaveTextContent('3 contactos');
    expect(screen.getByTestId('preview-ana')).toHaveTextContent('Hola N0');
    expect(apiFetch.mock.calls.some(([u]) => String(u).endsWith('/uploads'))).toBe(false);
  });

  it('confirmación con ConfirmDialog → "Carga entregada" con conteos del manifiesto', async () => {
    let sent: any = null;
    setApi({ 'didi_vip:v3': ['ana', 'beto'] }, (url, init) => {
      if (url === '/api/campaigns/didi_vip/uploads' && init?.method === 'POST') {
        sent = init.json;
        return { fleet: 'v3', status: 'completed', manifest: { perAgent: [{ agent: 'ana', rows: 5 }, { agent: 'beto', rows: 5 }] } };
      }
      return {};
    });
    await setup();
    await previewTen();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar carga' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('didi_vip · v3 · Repartir · 10 contactos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Entregar' }));
    const delivery = await screen.findByTestId('delivery');
    expect(delivery).toHaveTextContent('Carga entregada');
    expect(delivery).toHaveTextContent('ana: 5 contactos');
    expect(sent).toMatchObject({ fleet: 'v3', mode: 'distribute', fileName: 'contactos.csv', message: 'Hola {first_name}', plan: { agents: ['ana', 'beto'], counts: { ana: 5, beto: 5 } } });
    expect(sent.plan.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('roster cambió → 409 y pide volver a previsualizar', async () => {
    setApi({ 'didi_vip:v3': ['ana', 'beto'] }, (url, init) => {
      if (init?.method === 'POST') throw new ApiError(409, 'conflict', 'El roster cambió; revisa la nueva vista previa');
      return {};
    });
    await setup();
    await previewTen();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar carga' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Entregar' }));
    expect(await screen.findByText('El roster cambió; revisa la nueva vista previa')).toBeInTheDocument();
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('v4 asignar a un agente: "Procesando" y luego el resultado del historial', async () => {
    let polls = 0;
    let sent: any = null;
    setApi({ 'didi_vip:v4': ['Ana.Lopez', 'luis'] }, (url, init) => {
      if (init?.method === 'POST') {
        sent = init.json;
        return { fleet: 'v4', status: 'processing', srcKey: 'csv-uploads/l/1_c.csv' };
      }
      if (url.includes('/uploads?fleet=v4&srcKey=')) {
        polls++;
        return { items: polls < 2 ? [] : [{ fleet: 'v4', id: 'k', status: 'processed', validRows: 10, perAgent: [{ agent: 'Ana.Lopez', rows: 10 }] }] };
      }
      return {};
    });
    render(<ContactsUploadView pollIntervalMs={10} pollTimeoutMs={2000} />);
    await pick(/Campaña/, 'didi_vip');
    await pick(/Flota/, 'v4 (desktop)');
    await pick(/Modo/, 'Asignar a un agente');
    await waitFor(() => expect(screen.getByRole('button', { name: /Agente/ })).toBeEnabled());
    await pick(/Agente/, 'Ana.Lopez');
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), csvFile(tenRows));
    await screen.findByTestId('validation-summary');
    expect(screen.getByLabelText('Plantilla')).toHaveValue('{mensaje}');
    expect(screen.getByLabelText('Código de país')).toHaveValue('52');
    await userEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    expect(await screen.findByTestId('preview-Ana.Lopez')).toHaveTextContent('10 contactos');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar carga' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Entregar' }));
    expect(await screen.findByText('Procesando')).toBeInTheDocument();
    expect(await screen.findByText('Carga procesada: 10 contactos')).toBeInTheDocument();
    expect(sent).toMatchObject({ fleet: 'v4', mode: 'single', agent: 'Ana.Lopez', template: '{mensaje}', countryCode: '52', phoneColumn: 'contact_phone' });
  });

  it('v4 sin resultado en el tiempo de sondeo → "Sigue en proceso; revisa el historial"', async () => {
    setApi({ 'didi_vip:v4': ['ana'] }, (url, init) => {
      if (init?.method === 'POST') return { fleet: 'v4', status: 'processing', srcKey: 'k' };
      return { items: [] };
    });
    render(<ContactsUploadView pollIntervalMs={10} pollTimeoutMs={60} />);
    await pick(/Campaña/, 'didi_vip');
    await pick(/Flota/, 'v4 (desktop)');
    await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), csvFile(tenRows));
    await screen.findByTestId('validation-summary');
    await userEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar carga' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Entregar' }));
    expect(await screen.findByText(/Sigue en proceso; revisa el/)).toBeInTheDocument();
  });
});

describe('/contactos/historial', () => {
  it('Skeleton mientras carga y estados: rechazada con causa, completada, fallida', async () => {
    let resolve!: (v: unknown) => void;
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/campaigns') return { campaigns: ['didi_vip'] };
      if (url.includes('fleet=v3')) return new Promise((r) => (resolve = r));
      return {
        items: [
          { fleet: 'v4', id: 'k1', fileName: 'big.csv', uploadedBy: 'lider', uploadedAt: '2026-10-02T00:00:00Z', mode: 'assignments', totalRows: 60000, validRows: null, status: 'rejected', reason: 'too_many_rows', perAgent: [] },
        ],
      };
    });
    render(<UploadHistoryView />);
    await pick(/Campaña/, 'didi_vip');
    expect(await screen.findByTestId('skeleton-rows')).toBeInTheDocument();
    resolve({
      items: [
        { fleet: 'v3', id: 'u1', fileName: 'a.csv', uploadedBy: 'lider', uploadedAt: '2026-10-01T00:00:00Z', mode: 'distribute', totalRows: 3, validRows: 3, status: 'completed', reason: null, perAgent: [{ agent: 'ana', rows: 3 }] },
        { fleet: 'v3', id: 'u2', fileName: 'b.csv', uploadedBy: 'lider', uploadedAt: '2026-09-01T00:00:00Z', mode: 'single', totalRows: 0, validRows: 0, status: 'failed', reason: null, perAgent: [] },
      ],
    });
    expect(await screen.findByText('Completada')).toBeInTheDocument();
    expect(screen.getByText('Fallida')).toBeInTheDocument();
    expect(screen.getByTestId('upload-u1')).toHaveTextContent('ana: 3');
    await pick(/Flota/, 'v4 (desktop)');
    expect(await screen.findByText('Rechazada')).toBeInTheDocument();
    expect(screen.getByText('Más de 50 000 filas')).toBeInTheDocument();
  });
});
