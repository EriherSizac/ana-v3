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

import { ContactsUploadView } from '@/components/contacts/ContactsUploadView';
import { UploadDetailView } from '@/components/contacts/UploadDetailView';
import { ApiError } from '@/lib/api-client';

const U1 = '20261026T1530-ab12cd34';
const U9 = '20261027T0900-99999999';
const row = (phone: string, name: string) => ({ phone_number: phone, first_name: name, message: 'Hola {first_name}', ana_upload_id: U1 });
const pending = (phone: string, name: string, over: Record<string, unknown> = {}) => ({
  agent: 'ana.lopez',
  assignmentId: 'A1',
  phone,
  row: row(phone, name),
  state: 'pending',
  stateBy: null,
  stateAt: null,
  reassignUploadId: null,
  targetAgent: null,
  ...over,
});
const UPLOAD = {
  fleet: 'v3',
  id: U1,
  fileName: 'cartera.csv',
  uploadedBy: 'lider',
  uploadedAt: '2026-10-26T15:30:00Z',
  mode: 'distribute',
  totalRows: 10,
  validRows: 10,
  status: 'completed',
  reason: null,
  perAgent: [
    { agent: 'ana.lopez', rows: 5 },
    { agent: 'luis', rows: 5 },
  ],
};

type Handler = (url: string, init?: { method?: string; json?: any }) => unknown;
function setApi(items: unknown[], extra: Handler = () => ({})) {
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    if (url.includes('/uploads?fleet=v3')) return { items: [UPLOAD] };
    if (url.includes('/review-items?uploadId=')) return { uploadId: U1, items };
    if (url.includes('/enabled-agents?fleet=v3')) return { agents: ['ana.lopez', 'luis'] };
    return extra(url, init);
  });
}

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('/contactos: columna reservada (v3)', () => {
  async function setupUpload(csv: string, message = '') {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/campaigns') return { campaigns: ['prueba'] };
      if (url.includes('enabled-agents')) return { agents: ['ana'] };
      return {};
    });
    render(<ContactsUploadView />);
    await userEvent.click(await screen.findByRole('button', { name: /Campaña/ }));
    await userEvent.click(screen.getByRole('option', { name: 'prueba' }));
    await userEvent.click(screen.getByRole('button', { name: /Flota/ }));
    await userEvent.click(screen.getByRole('option', { name: 'v3 (CLI)' }));
    await waitFor(() => expect(screen.getByLabelText('Archivo CSV')).toBeEnabled());
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), new File([csv], 'c.csv', { type: 'text/csv' }));
    if (message) await userEvent.type(await screen.findByLabelText(/Mensaje plantilla/), message);
  }

  it('CSV con ana_upload_id → "La columna ana_upload_id está reservada" y no permite continuar', async () => {
    await setupUpload('phone,ana_upload_id,message\n5215500000001,x,Hola');
    expect((await screen.findAllByText('La columna ana_upload_id está reservada')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeDisabled();
  });

  it('{upload} sin columna que lo contenga → "Variable desconocida: {upload}" y vista previa deshabilitada', async () => {
    await setupUpload('phone,first_name\n5215500000001,Ana', 'Hola {{upload}');
    expect((await screen.findAllByText('Variable desconocida: {upload}')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeDisabled();
  });
});

describe('/contactos/historial/[uploadId]', () => {
  it('2 por revisar en ana.lopez "Pendiente de revisión" y "Sin contactos por revisar" en luis', async () => {
    setApi([pending('5215500000001', 'Ana'), pending('5215500000002', 'Bea')]);
    render(<UploadDetailView uploadId={U1} campaign="prueba" />);
    const ana = await screen.findByTestId('review-agent-ana.lopez');
    expect(within(ana).getAllByText('Pendiente de revisión')).toHaveLength(2);
    expect(within(ana).getByText('Ana')).toBeInTheDocument();
    expect(within(screen.getByTestId('review-agent-luis')).getByText('Sin contactos por revisar')).toBeInTheDocument();
  });

  it('contacto reasignado: "Reasignado a luis", autor, fecha y enlace a U9', async () => {
    setApi([pending('5215500000001', 'Ana', { state: 'reassigned', stateBy: 'erick.silva', stateAt: '2026-10-27T09:00:00Z', reassignUploadId: U9, targetAgent: 'luis' })]);
    render(<UploadDetailView uploadId={U1} campaign="prueba" />);
    const r = await screen.findByTestId('review-5215500000001');
    expect(r).toHaveTextContent('Reasignado a luis');
    expect(r).toHaveTextContent('erick.silva');
    expect(within(r).getByRole('link', { name: /Ver carga/ })).toHaveAttribute('href', `/contactos/historial/${U9}?campaign=prueba`);
    expect(within(r).getByRole('checkbox')).toBeDisabled();
  });

  it('descartar con ConfirmDialog destructivo → "Descartado" con autor', async () => {
    setApi([pending('5215500000001', 'Ana')], (url, init) => {
      if (url.endsWith('/review-items/resolve')) {
        expect(init?.json).toEqual({ action: 'discard', items: [{ agent: 'ana.lopez', assignmentId: 'A1', phone: '5215500000001' }] });
        return { items: [pending('5215500000001', 'Ana', { state: 'discarded', stateBy: 'lider.didi', stateAt: '2026-10-27T10:00:00Z' })] };
      }
      return {};
    });
    render(<UploadDetailView uploadId={U1} campaign="prueba" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar 5215500000001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    const r = await screen.findByTestId('review-5215500000001');
    await waitFor(() => expect(r).toHaveTextContent('Descartado'));
    expect(r).toHaveTextContent('lider.didi');
  });

  async function reassignTwo() {
    render(<UploadDetailView uploadId={U1} campaign="prueba" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar 5215500000001' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar 5215500000002' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reasignar' }));
    await userEvent.click(await screen.findByRole('button', { name: /Agente destino/ }));
    await userEvent.click(screen.getByRole('option', { name: 'luis' }));
    await userEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    expect(await screen.findByTestId('reassign-preview')).toHaveTextContent('2 contacto(s)');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reasignación' }));
    const confirm = screen.getAllByRole('dialog').at(-1)!;
    expect(confirm).toHaveTextContent('confirma en WhatsApp que el mensaje NO salió');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Reasignar' }));
  }

  it('reasignación exitosa: carga single a luis con 2 filas sin ana_upload_id y source; quedan "Reasignado a luis"', async () => {
    let upload: any = null;
    let resolve: any = null;
    setApi([pending('5215500000001', 'Ana'), pending('5215500000002', 'Bea')], (url, init) => {
      if (url.endsWith('/uploads') && init?.method === 'POST') {
        upload = init.json;
        return { fleet: 'v3', status: 'completed', uploadId: U9, manifest: { uploadId: U9, perAgent: [{ agent: 'luis', rows: 2 }] } };
      }
      if (url.endsWith('/review-items/resolve')) {
        resolve = init?.json;
        return { items: ['5215500000001', '5215500000002'].map((p) => pending(p, 'x', { state: 'reassigned', targetAgent: 'luis', reassignUploadId: U9, stateBy: 'lider', stateAt: '2026-10-27T09:00:00Z' })) };
      }
      return {};
    });
    await reassignTwo();
    await waitFor(() => expect(screen.getAllByText('Reasignado a luis')).toHaveLength(2));
    expect(upload).toMatchObject({ fleet: 'v3', mode: 'single', agent: 'luis', plan: { agents: ['luis'], counts: { luis: 2 } } });
    expect(upload.csv.split('\n')[0]).toBe('phone_number,first_name,message');
    expect(upload.csv).not.toContain(U1);
    expect(upload.source).toEqual({
      type: 'review',
      fromUploadId: U1,
      items: [
        { agent: 'ana.lopez', assignmentId: 'A1', phone: '5215500000001' },
        { agent: 'ana.lopez', assignmentId: 'A1', phone: '5215500000002' },
      ],
    });
    expect(resolve).toMatchObject({ action: 'reassign', reassignUploadId: U9 });
  });

  it('marcado fallido: reintenta con el mismo reassignUploadId, avisa y no crea otra carga', async () => {
    let uploads = 0;
    let marks = 0;
    setApi([pending('5215500000001', 'Ana'), pending('5215500000002', 'Bea')], (url, init) => {
      if (url.endsWith('/uploads') && init?.method === 'POST') {
        uploads++;
        return { fleet: 'v3', uploadId: U9, manifest: { uploadId: U9, perAgent: [] } };
      }
      if (url.endsWith('/review-items/resolve')) {
        marks++;
        expect(init?.json.reassignUploadId).toBe(U9);
        if (marks <= 2) throw new ApiError(503, 'upstream_unavailable', 'x');
        return { items: [pending('5215500000001', 'Ana', { state: 'reassigned', targetAgent: 'luis', reassignUploadId: U9 })] };
      }
      return {};
    });
    await reassignTwo();
    expect(await screen.findByText('Carga entregada; reintenta marcar como reasignados')).toBeInTheDocument();
    expect(marks).toBe(2);
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar marcado' }));
    await waitFor(() => expect(screen.getByTestId('review-5215500000001')).toHaveTextContent('Reasignado a luis'));
    expect(uploads).toBe(1);
  });

  it('roster cambiado → 409 con mensaje y sin marcar', async () => {
    let marks = 0;
    setApi([pending('5215500000001', 'Ana'), pending('5215500000002', 'Bea')], (url, init) => {
      if (url.endsWith('/uploads') && init?.method === 'POST') throw new ApiError(409, 'conflict', 'El roster cambió; revisa la nueva vista previa');
      if (url.endsWith('/review-items/resolve')) marks++;
      return {};
    });
    await reassignTwo();
    expect(await screen.findByText('El roster cambió; revisa la nueva vista previa')).toBeInTheDocument();
    expect(marks).toBe(0);
  });

  it('vista "Por revisar sin carga asociada" (uploadId=none)', async () => {
    setApi([pending('5215500000010', 'Curl', { agent: 'luis', assignmentId: 'B1', row: { contact_phone: '5215500000010', first_name: 'Curl' } })]);
    render(<UploadDetailView uploadId="none" campaign="prueba" />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Por revisar sin carga asociada');
    expect(await screen.findByTestId('review-agent-luis')).toHaveTextContent('5215500000010');
    expect(apiFetch.mock.calls.some(([u]) => String(u).includes('uploadId=none'))).toBe(true);
  });
});
