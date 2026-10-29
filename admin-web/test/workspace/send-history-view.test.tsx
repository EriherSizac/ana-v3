import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));
vi.mock('@/lib/auth-client', () => ({ hasSession: async () => true, logout: vi.fn(), currentIdToken: vi.fn(async () => 'tok') }));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import { SendHistoryView } from '@/components/workspace/SendHistoryView';
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider';
import type { WsLike } from '@/lib/realtime/client';
import type { ResultRow, ResultsResponse } from '@/lib/send-history';

/** add-agent-send-history: vista "Historial de envíos". */
const row = (i: number, over: Partial<ResultRow> = {}): ResultRow => ({
  id: `A1#${i}#1`,
  agent: 'ana',
  assignmentId: 'A1',
  publicationId: 'P1',
  uploadId: null,
  rowIndex: i,
  credit: `CR-${i}`,
  phone: `**000${i}`,
  status: 'sent',
  errorCode: null,
  error: null,
  sentAt: '2026-10-29T17:00:00.000Z',
  messagePreview: `Hola ${i}`,
  ...over,
});

const page = (over: Partial<ResultsResponse> = {}): ResultsResponse => ({
  campaign: 'prueba',
  agent: 'ana',
  agents: ['ana'],
  from: '2026-10-23',
  to: '2026-10-29',
  total: 2,
  items: [row(0), row(1, { status: 'no_whatsapp', error: 'No tiene WhatsApp' })],
  nextCursor: null,
  summary: { sent: 1, no_whatsapp: 1, error: 0, por_revisar: 0, total: 2 },
  publications: [
    { publicationId: 'P1', agent: 'ana', publishedAt: '2026-10-29T16:00:00.000Z', published: 4, sent: 1, no_whatsapp: 1, error: 0, por_revisar: 0, reported: 2, pending: 2, templatePreview: 'Hola {{first_name}}' },
  ],
  unlinked: { sent: 0, no_whatsapp: 0, error: 0, por_revisar: 0, reported: 0 },
  ...over,
});

const resultsCalls = () => apiFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/results'));
const lastQuery = () => new URLSearchParams(resultsCalls().at(-1)!.split('?')[1]);

function setApi(handler?: (url: string) => unknown) {
  apiFetch.mockImplementation(async (url: string) => {
    const h = handler?.(url);
    if (h !== undefined) return h;
    if (url === '/api/agent/campaigns') return { campaigns: ['prueba'] };
    if (url === '/api/campaigns') return { campaigns: ['prueba', 'otra'] };
    if (url.includes('/results')) return page();
    return {};
  });
}

async function pick(label: RegExp, option: string) {
  await waitFor(() => expect(screen.getAllByRole('button', { name: label }).some((b) => b.hasAttribute('aria-haspopup'))).toBe(true));
  await userEvent.click(screen.getAllByRole('button', { name: label }).find((b) => b.hasAttribute('aria-haspopup'))!);
  await userEvent.click(screen.getByRole('option', { name: option }));
}

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Historial de envíos (agente)', () => {
  it('elige la única campaña, muestra la tarjeta con avance y la tabla con teléfonos enmascarados', async () => {
    setApi();
    render(<SendHistoryView scope="agent" />);
    const card = await screen.findByTestId('publication-P1');
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(within(card).getByText('2 de 4 reportados (50%)')).toBeInTheDocument();
    const table = screen.getByTestId('results-table');
    expect(within(table).getByText('**0000')).toBeInTheDocument();
    expect(within(table).getByText('No tiene WhatsApp')).toBeInTheDocument();
    expect(resultsCalls()[0]).toMatch(/^\/api\/agent\/results\/prueba\?/);
    expect(screen.queryByRole('button', { name: /Agente/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mi asignación' })).toHaveAttribute('href', '/mi-asignacion');
  });

  it('filtros de estado y publicación, orden y búsqueda llegan a la query', async () => {
    setApi();
    render(<SendHistoryView scope="agent" />);
    await screen.findByTestId('results-table');
    await pick(/^Estado/, 'Sin WhatsApp');
    await waitFor(() => expect(lastQuery().get('status')).toBe('no_whatsapp'));
    expect(screen.getByRole('button', { name: 'Quitar filtro Sin WhatsApp' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(screen.getByTestId('publication-P1')).getByRole('button', { name: 'Ver contactos' }));
    await waitFor(() => expect(lastQuery().get('publicationId')).toBe('P1'));
    await userEvent.click(screen.getByRole('button', { name: /Crédito/ }));
    await waitFor(() => expect(lastQuery().get('sort')).toBe('credit'));
    expect(lastQuery().get('order')).toBe('asc');
    await userEvent.type(screen.getByLabelText('Buscar'), '0001');
    await waitFor(() => expect(lastQuery().get('q')).toBe('0001'), { timeout: 2000 });
  });

  it('rango inválido: aviso y no consulta', async () => {
    setApi();
    render(<SendHistoryView scope="agent" />);
    await screen.findByTestId('results-table');
    const before = resultsCalls().length;
    const from = screen.getByLabelText('Desde');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-01-01');
    expect(await screen.findByText('El rango admite como máximo 31 días')).toBeInTheDocument();
    expect(resultsCalls().length).toBe(before);
  });

  it('cargar más agrega la página siguiente', async () => {
    setApi((url) => {
      if (!url.includes('/results')) return undefined;
      return url.includes('cursor=2') ? page({ items: [row(2)], total: 3, nextCursor: null }) : page({ total: 3, nextCursor: '2' });
    });
    render(<SendHistoryView scope="agent" />);
    await screen.findByTestId('results-table');
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByTestId('row-A1#2#1')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 3 de 3')).toBeInTheDocument();
  });

  it('exporta a CSV todas las páginas filtradas', async () => {
    setApi((url) => {
      if (!url.includes('/results')) return undefined;
      if (url.includes('limit=500')) return url.includes('cursor=1') ? page({ items: [row(1, { status: 'error' })], nextCursor: null }) : page({ items: [row(0, { status: 'error' })], nextCursor: '1' });
      return undefined;
    });
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<SendHistoryView scope="agent" />);
    await screen.findByTestId('results-table');
    await userEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    expect(await screen.findByText('Se exportaron 2 filas.')).toBeInTheDocument();
    expect(click).toHaveBeenCalled();
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsText(blobs[0]!);
    });
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(3);
    expect(text).toContain('**0001');
  });

  it('sin campañas habilitadas', async () => {
    setApi((url) => (url === '/api/agent/campaigns' ? { campaigns: [] } : undefined));
    render(<SendHistoryView scope="agent" />);
    expect(await screen.findByText('No estás habilitado como agente v3 en ninguna campaña')).toBeInTheDocument();
  });

  it('error de v3 en pantalla', async () => {
    const { ApiError } = await import('@/lib/api-client');
    setApi((url) => {
      if (url.includes('/results')) throw new ApiError(403, 'forbidden', 'No estás habilitado como agente v3 en esta campaña');
      return undefined;
    });
    render(<SendHistoryView scope="agent" />);
    expect(await screen.findByText('No estás habilitado como agente v3 en esta campaña')).toBeInTheDocument();
  });
});

describe('Historial de envíos (campaña)', () => {
  it('elige campaña y filtra por agente', async () => {
    setApi((url) => (url.includes('/api/campaigns/prueba/results') ? page({ agent: null, agents: ['ana', 'luis'], items: [row(0), row(1, { agent: 'luis' })] }) : undefined));
    render(<SendHistoryView scope="campaign" />);
    await pick(/^Campaña/, 'prueba');
    const table = await screen.findByTestId('results-table');
    expect(within(table).getByText('luis')).toBeInTheDocument();
    await pick(/^Agente/, 'luis');
    await waitFor(() => expect(lastQuery().get('agent')).toBe('luis'));
    expect(resultsCalls().at(-1)).toMatch(/^\/api\/campaigns\/prueba\/results\?/);
    expect(screen.queryByRole('link', { name: 'Mi asignación' })).not.toBeInTheDocument();
  });
});

describe('recarga en vivo', () => {
  class FakeWs implements WsLike {
    onopen: WsLike['onopen'] = null;
    onmessage: WsLike['onmessage'] = null;
    onclose: WsLike['onclose'] = null;
    onerror: WsLike['onerror'] = null;
    send() {}
    close() {}
  }
  it('results.changed de la campaña elegida recarga el historial', async () => {
    setApi();
    const sockets: FakeWs[] = [];
    render(
      <RealtimeProvider
        config={{ enabled: true, url: 'wss://abc.execute-api.us-east-2.amazonaws.com/prod', version: 't' }}
        createSocket={() => {
          const ws = new FakeWs();
          sockets.push(ws);
          return ws;
        }}
        getToken={async () => 'tok'}
      >
        <SendHistoryView scope="agent" />
      </RealtimeProvider>,
    );
    await screen.findByTestId('results-table');
    await waitFor(() => expect(sockets).toHaveLength(1));
    const ws = sockets[0]!;
    act(() => {
      ws.onopen?.();
      ws.onmessage?.({ data: JSON.stringify({ type: 'pong' }) });
    });
    const before = resultsCalls().length;
    act(() => ws.onmessage?.({ data: JSON.stringify({ v: 1, type: 'results.changed', id: 'e1', at: 1, campaign: 'prueba' }) }));
    await waitFor(() => expect(resultsCalls().length).toBeGreaterThan(before), { timeout: 3000 });
  });
});
