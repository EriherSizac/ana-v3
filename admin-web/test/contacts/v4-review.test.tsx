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

import { V4ReviewView } from '@/components/contacts/V4ReviewView';
import { applyResolution, maskPhone } from '@/lib/contacts/v4review';

const SRC = 'csv-uploads/lider/1761400000000_cartera.csv';
const item = (operatorId: string, n: number, over: Record<string, unknown> = {}) => ({
  operatorId,
  jobId: `lider/1761400000000_cartera.csv#${n}`,
  srcKey: SRC,
  label: 'cartera-52',
  phone: `55100000${String(n).padStart(2, '0')}`,
  row: { nombre: `Contacto ${n}`, credito: `CR-${n}` },
  auto: false,
  claimedAt: 1,
  reviewAt: Date.UTC(2026, 9, 26, 15, 0),
  status: 'review',
  ...over,
});
const UPLOAD = {
  fleet: 'v4',
  id: SRC,
  fileName: 'cartera.csv',
  uploadedBy: 'lider',
  uploadedAt: '2026-10-26T15:00:00Z',
  mode: 'distribute',
  totalRows: 10,
  validRows: 10,
  status: 'processed',
  reason: null,
  perAgent: [],
};

type Handler = (url: string, init?: { method?: string; json?: any }) => unknown;
function setApi(items: unknown[], extra: Handler = () => ({})) {
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    if (url.includes('/uploads?fleet=v4')) return { items: [UPLOAD] };
    if (url.includes('/review/resolve')) return extra(url, init);
    if (url.includes('/api/v4/campaigns/')) return { campaign: 'didi_vip', items };
    if (url.includes('/enabled-agents?fleet=v4')) return { agents: ['ana.lopez', 'luis'] };
    return extra(url, init);
  });
}

const row = (n: number) => screen.getByTestId(`v4-review-lider/1761400000000_cartera.csv#${n}`);

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('V4ReviewView (detalle de carga v4)', () => {
  it('3 por revisar de dos agentes, agrupados y con teléfono enmascarado', async () => {
    setApi([item('ana.lopez', 1), item('ana.lopez', 2), item('luis', 3)]);
    render(<V4ReviewView campaign="didi_vip" srcKey={SRC} />);
    const ana = await screen.findByTestId('v4-review-agent-ana.lopez');
    expect(within(ana).getAllByRole('row')).toHaveLength(3); // encabezado + 2
    expect(within(ana).getByText('Contacto 1')).toBeInTheDocument();
    expect(within(ana).getByText('***0001')).toBeInTheDocument();
    expect(ana).not.toHaveTextContent('5510000001');
    expect(within(screen.getByTestId('v4-review-agent-luis')).getByText('CR-3')).toBeInTheDocument();
    expect(
      apiFetch.mock.calls.some(([u]) => String(u) === `/api/v4/campaigns/didi_vip/review?srcKey=${encodeURIComponent(SRC)}`),
    ).toBe(true);
  });

  it('sin items → "Sin contactos por revisar"', async () => {
    setApi([]);
    render(<V4ReviewView campaign="didi_vip" srcKey={SRC} />);
    expect(await screen.findByText('Sin contactos por revisar')).toBeInTheDocument();
  });

  it('reenviar a otro agente: solo habilitados, advierte duplicado y queda "Reenviado a luis"', async () => {
    let sent: any = null;
    setApi([item('ana.lopez', 1), item('ana.lopez', 2)], (_url, init) => {
      sent = init?.json;
      return { results: sent.items.map((i: any) => ({ ...i, ok: true, to: 'luis' })) };
    });
    render(<V4ReviewView campaign="didi_vip" srcKey={SRC} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar Contacto 1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Contacto 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reenviar a…' }));
    await userEvent.click(await screen.findByRole('button', { name: /Agente destino/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['ana.lopez', 'luis']);
    await userEvent.click(screen.getByRole('option', { name: 'luis' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reenviar' }));
    const confirm = screen.getByRole('dialog');
    expect(confirm).toHaveTextContent('Este contacto pudo haber recibido el mensaje. Reenviarlo puede duplicarlo.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Reenviar' }));
    await waitFor(() => expect(screen.getAllByText('Reenviado a luis')).toHaveLength(2));
    expect(sent).toEqual({
      action: 'requeue',
      to: 'luis',
      items: [
        { operatorId: 'ana.lopez', jobId: 'lider/1761400000000_cartera.csv#1' },
        { operatorId: 'ana.lopez', jobId: 'lider/1761400000000_cartera.csv#2' },
      ],
    });
  });

  it('descartar con ConfirmDialog → "Descartado"; resultado fallido se informa', async () => {
    setApi([item('ana.lopez', 1), item('ana.lopez', 2)], (_url, init) => ({
      results: init!.json.items.map((i: any, n: number) =>
        n === 0 ? { ...i, ok: true } : { ...i, ok: false, error: 'ya no está por revisar' },
      ),
    }));
    render(<V4ReviewView campaign="didi_vip" srcKey={SRC} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar Contacto 1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Contacto 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(row(1)).toHaveTextContent('Descartado'));
    expect(row(2)).toHaveTextContent('Por revisar');
    expect(screen.getByText(/1 contacto\(s\) no se pudieron resolver/)).toBeInTheDocument();
  });

  it('ya resueltos: sin casilla habilitada', async () => {
    setApi([item('ana.lopez', 1, { status: 'discarded', resolution: 'requeued', requeuedTo: 'luis', resolvedBy: 'lider', resolvedAt: 5 })]);
    render(<V4ReviewView campaign="didi_vip" srcKey={SRC} />);
    await screen.findByTestId('v4-review-agent-ana.lopez');
    expect(row(1)).toHaveTextContent('Reenviado a luis');
    expect(within(row(1)).getByRole('checkbox')).toBeDisabled();
  });
});

describe('V4ReviewView por campaña', () => {
  it('envío directo interrumpido marcado "Envío directo" y resoluble', async () => {
    setApi([item('luis', 9, { srcKey: '', auto: true, jobId: 'direct#1#55#ab', row: { nombre: 'Directo' } })], (_u, init) => ({
      results: init!.json.items.map((i: any) => ({ ...i, ok: true })),
    }));
    render(<V4ReviewView campaign="didi_vip" srcKey={null} />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Por revisar (v4)');
    const r = await screen.findByTestId('v4-review-direct#1#55#ab');
    expect(r).toHaveTextContent('Envío directo');
    expect(apiFetch.mock.calls.some(([u]) => String(u) === '/api/v4/campaigns/didi_vip/review')).toBe(true);
    await userEvent.click(within(r).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(r).toHaveTextContent('Descartado'));
  });
});

describe('lib v4review', () => {
  it('maskPhone y applyResolution', () => {
    expect(maskPhone('5215512341922')).toBe('***1922');
    const out = applyResolution(
      [item('a', 1) as any],
      [{ operatorId: 'a', jobId: 'lider/1761400000000_cartera.csv#1', ok: true }],
      'requeue',
      'yo',
      7,
    );
    expect(out[0]).toMatchObject({ status: 'discarded', resolution: 'requeued', requeuedTo: 'a', resolvedBy: 'yo', resolvedAt: 7 });
  });
});
