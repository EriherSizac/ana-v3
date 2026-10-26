import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { LegacyHistoryView } from '@/components/legacy/LegacyHistoryView';
import { ConsoleGate } from '@/components/system/ConsoleGate';
import { ApiError } from '@/lib/api-client';

const CONVS = [
  { agent: 'erick', phone: '5215512345678', totalMessages: 12, firstMessageAt: '2026-08-01T15:00:00Z', lastMessageAt: '2026-09-15T18:00:00Z' },
  { agent: 'luis', phone: '5215599999999', totalMessages: 3, firstMessageAt: null, lastMessageAt: '2026-07-02T18:00:00Z' },
];

type Handler = (url: string) => unknown;
function setApi(handler: Handler) {
  apiFetch.mockImplementation(async (url: string) => {
    if (url === '/api/campaigns') return { campaigns: ['prueba', 'ventas'] };
    if (url.endsWith('/legacy-agents')) return { agents: url.includes('/prueba/') ? ['erick', 'luis'] : [], extractedAt: null };
    return handler(url);
  });
}

const search = (url: string) => {
  const u = new URL(url, 'http://x');
  let convs = url.includes('/ventas/') ? [] : CONVS;
  const phone = u.searchParams.get('phone');
  const agent = u.searchParams.get('agent');
  if (phone) convs = convs.filter((c) => c.phone.includes(phone));
  if (agent) convs = convs.filter((c) => c.agent === agent);
  return { total: convs.length, page: 1, conversations: convs };
};

async function chooseCampaign(name = 'prueba') {
  await userEvent.click(await screen.findByRole('button', { name: /Campaña/ }));
  await userEvent.click(screen.getByRole('option', { name }));
}

const me = (over: Record<string, unknown>) => ({ username: 'u', permissions: ['ana:contacts:list:upload'], campaigns: ['prueba'], roleNames: [], isAdmin: false, isLeader: false, isDeveloper: false, ...over });

beforeEach(() => {
  resetNavigation();
  apiFetch.mockReset();
});

describe('/historial-legacy: visibilidad', () => {
  it('usuario sin admin ni líder → "Sin acceso" y sin entrada en la navegación', async () => {
    setLocation('/historial-legacy');
    apiFetch.mockResolvedValue(me({}));
    render(
      <ConsoleGate>
        <LegacyHistoryView />
      </ConsoleGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Secciones' })).queryByRole('link', { name: 'Historial legacy' })).toBeNull();
  });

  it('líder → la navegación incluye "Historial legacy"', async () => {
    setLocation('/');
    apiFetch.mockResolvedValue(me({ isLeader: true }));
    render(
      <ConsoleGate>
        <p>inicio</p>
      </ConsoleGate>,
    );
    expect(await within(await screen.findByRole('navigation', { name: 'Secciones' })).findByRole('link', { name: 'Historial legacy' })).toBeInTheDocument();
  });
});

describe('/historial-legacy: búsqueda', () => {
  it('Skeleton y filtrar por teléfono', async () => {
    let first = true;
    let release!: () => void;
    setApi(async (url) => {
      if (first) {
        first = false;
        await new Promise<void>((r) => (release = r));
      }
      return search(url);
    });
    render(<LegacyHistoryView />);
    await chooseCampaign();
    expect(await screen.findByTestId('skeleton-rows')).toBeInTheDocument();
    release();
    expect(await screen.findByTestId('conv-luis-5215599999999')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Teléfono'), '5512345678');
    await waitFor(() => expect(screen.queryByTestId('conv-luis-5215599999999')).toBeNull());
    expect(screen.getByTestId('conv-erick-5215512345678')).toHaveTextContent('12');
    expect(screen.getByText('Teléfono: 5512345678')).toBeInTheDocument();
  });

  it('campaña sin historial → "Sin conversaciones"', async () => {
    setApi(search);
    render(<LegacyHistoryView />);
    await chooseCampaign('ventas');
    expect(await screen.findByText('Sin conversaciones')).toBeInTheDocument();
  });

  it('agentes legados con etiqueta "Legacy" y nota; elegir uno filtra; sin acciones de habilitación', async () => {
    setApi(search);
    render(<LegacyHistoryView />);
    await chooseCampaign();
    await screen.findByTestId('conv-luis-5215599999999');
    await userEvent.click(screen.getByRole('button', { name: /Agente legado/ }));
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'erick · LegacyAgente anterior al login Cognito; no activo',
      'luis · LegacyAgente anterior al login Cognito; no activo',
    ]);
    await userEvent.click(screen.getByRole('option', { name: /erick/ }));
    await waitFor(() => expect(screen.queryByTestId('conv-luis-5215599999999')).toBeNull());
    expect(screen.getByText('Agente: erick (Legacy)')).toBeInTheDocument();
    // `luis` podría coincidir con un username del pool: sigue siendo Legacy y sin acciones.
    expect(screen.queryByRole('link', { name: /Agentes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Habilitar|Rehabilitar|Deshabilitar/ })).toBeNull();
  });
});

describe('/historial-legacy: conversación', () => {
  const openErick = async () => {
    render(<LegacyHistoryView />);
    await chooseCampaign();
    const row = await screen.findByTestId('conv-erick-5215512345678');
    await userEvent.click(within(row).getByRole('button', { name: 'Ver conversación' }));
  };

  it('body con HTML se muestra literal sin crear <img>; hora de CDMX; "Multimedia no disponible"', async () => {
    setApi((url) =>
      url.includes('/legacy-chats/')
        ? {
            campaign: 'prueba',
            agent: 'erick',
            phone: '5215512345678',
            messages: [
              { id: '1', timestamp: '2026-09-05T16:30:00.000Z', from: 'them', body: '<img src=x onerror=alert(1)>', media: null, hasMedia: false },
              { id: '2', timestamp: '2026-09-05T16:31:00.000Z', from: 'me', body: 'línea 1\nlínea 2', media: null, hasMedia: true },
            ],
          }
        : search(url),
    );
    await openErick();
    const chat = await screen.findByTestId('legacy-chat');
    await within(chat).findByText('<img src=x onerror=alert(1)>');
    expect(chat.querySelector('img')).toBeNull();
    expect(chat).toHaveTextContent('10:30');
    expect(within(chat).getByText(/línea 1/)).toHaveClass('whitespace-pre-wrap');
    expect(within(chat).getByText('Multimedia no disponible')).toBeInTheDocument();
  });

  it('404 → "Conversación no encontrada"', async () => {
    setApi((url) => {
      if (url.includes('/legacy-chats/')) throw new ApiError(404, 'not_found', 'Conversación no encontrada');
      return search(url);
    });
    await openErick();
    expect(await screen.findByText('Conversación no encontrada')).toBeInTheDocument();
  });

  it('URL vencida: al fallar la imagen vuelve a pedir la conversación y usa la URL nueva', async () => {
    let n = 0;
    setApi((url) => {
      if (!url.includes('/legacy-chats/')) return search(url);
      n++;
      return {
        campaign: 'prueba',
        agent: 'erick',
        phone: '5215512345678',
        messages: [{ id: '1', timestamp: null, from: 'them', body: '', hasMedia: true, media: { url: `https://s3.test/foto.jpg?v=${n}`, contentType: 'image/jpeg', kind: 'image', filename: 'foto.jpg' } }],
      };
    });
    await openErick();
    const img = await screen.findByRole('img', { name: 'Imagen foto.jpg' });
    expect(img).toHaveAttribute('src', 'https://s3.test/foto.jpg?v=1');
    fireEvent.error(img);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Imagen foto.jpg' })).toHaveAttribute('src', 'https://s3.test/foto.jpg?v=2'));
  });

  it('otros tipos como enlace de descarga', async () => {
    setApi((url) =>
      url.includes('/legacy-chats/')
        ? { campaign: 'prueba', agent: 'erick', phone: '1', messages: [{ id: '1', timestamp: null, from: 'them', body: '', hasMedia: true, media: { url: 'https://s3.test/d.pdf', contentType: 'application/pdf', kind: 'file', filename: 'd.pdf' } }] }
        : search(url),
    );
    await openErick();
    const link = await screen.findByRole('link', { name: /Descargar d.pdf/ });
    expect(link).toHaveAttribute('download', 'd.pdf');
  });
});
