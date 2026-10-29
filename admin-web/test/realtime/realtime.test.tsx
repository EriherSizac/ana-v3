import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, setLocation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));
vi.mock('@/lib/auth-client', () => ({ hasSession: async () => true, logout: vi.fn(async () => {}), currentIdToken: vi.fn(async () => 'tok') }));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import { RealtimeClient, REFRESH_CLOSE_CODE, type WsLike } from '@/lib/realtime/client';
import { realtimeClientConfig } from '@/lib/realtime/config';
import { HIDDEN_CLOSE_MS, LOGOUT_EVENT, RealtimeProvider, useRealtimeRefresh } from '@/lib/realtime/RealtimeProvider';
import { RealtimeIndicator, StaleNotice } from '@/components/system/Realtime';
import { ConsoleGate } from '@/components/system/ConsoleGate';
import { UploadHistoryView } from '@/components/contacts/UploadHistoryView';
import { MyAssignmentView } from '@/components/workspace/MyAssignmentView';
import { AgentsView } from '@/components/agents/AgentsView';
import { SECTIONS } from '@/lib/sections';

class FakeWs implements WsLike {
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onclose: WsLike['onclose'] = null;
  onerror: WsLike['onerror'] = null;
  constructor(
    public url: string,
    public protocols: string[],
  ) {}
  autoPong = false;
  send(d: string) {
    this.sent.push(d);
    if (this.autoPong && d.includes('ping')) queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'pong', at: 1, exp: 2 }) }));
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
  }
  /** Abre y confirma (pong). */
  confirm() {
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: 'pong', at: 1, exp: 2 }) });
  }
  push(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
  drop() {
    this.onclose?.({ code: 1006 });
  }
}

let sockets: FakeWs[];
const factory = (url: string, protocols: string[]) => {
  const ws = new FakeWs(url, protocols);
  sockets.push(ws);
  return ws;
};
const CONFIG = { enabled: true, url: 'wss://abc.execute-api.us-east-2.amazonaws.com/prod', version: 'test' };
const getToken = async () => 'tok-admin';
const last = () => sockets[sockets.length - 1]!;
const evt = (type: string, extra: Record<string, unknown> = {}) => ({ v: 1, type, id: Math.random().toString(36), at: Date.now(), ...extra });

beforeEach(() => {
  sockets = [];
  resetNavigation();
  apiFetch.mockReset();
  sessionStorage.clear(); // borrador del asistente "Mi asignación"
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('config del navegador', () => {
  it('sin URL o con NEXT_PUBLIC_REALTIME_ENABLED=false → deshabilitado', () => {
    expect(realtimeClientConfig({})).toEqual({ enabled: false, url: null, version: 'web' });
    expect(realtimeClientConfig({ url: 'wss://x/prod', enabled: 'false' }).enabled).toBe(false);
    expect(realtimeClientConfig({ url: 'wss://x/prod' })).toEqual({ enabled: true, url: 'wss://x/prod', version: 'web' });
  });
});

describe('RealtimeClient (admin): pestaña oculta', () => {
  it('pause() cierra sin reconectar; resume() reconecta', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const c = new RealtimeClient({ url: CONFIG.url, client: 'admin', version: '1', getToken, createSocket: factory, onState: (s) => states.push(s) });
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().url).toContain('client=admin');
    last().confirm();
    c.pause();
    expect(sockets[0]!.closedWith).toEqual({ code: 1000, reason: 'paused' });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(sockets).toHaveLength(1);
    c.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
    expect(states).toEqual(['active', 'inactive']);
    c.stop();
  });
});

/** Vista mínima con el hook. */
function Probe({ campaign, dirty = false, onReload }: { campaign?: string | null; dirty?: boolean; onReload: () => void }) {
  const live = useRealtimeRefresh({ types: ['roster.changed'], campaign, reload: onReload, isDirty: () => dirty });
  return (
    <div>
      <RealtimeIndicator />
      <StaleNotice stale={live.stale} onRefresh={live.refresh} />
    </div>
  );
}

const renderProbe = (props: { campaign?: string | null; dirty?: boolean; onReload: () => void }, refreshAccess?: () => Promise<void>) =>
  render(
    <RealtimeProvider config={CONFIG} createSocket={factory} getToken={getToken} refreshAccess={refreshAccess}>
      <Probe {...props} />
    </RealtimeProvider>,
  );

describe('RealtimeProvider y useRealtimeRefresh', () => {
  it('conexión directa con client=admin y el ID token como subprotocolo; indicador "En vivo"', async () => {
    renderProbe({ campaign: 'prueba', onReload: () => {} });
    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(last().protocols).toEqual(['ana.v1', 'tok-admin']);
    expect(screen.getByTestId('realtime-indicator')).toHaveTextContent('Sin actualizaciones en vivo');
    act(() => last().confirm());
    expect(screen.getByTestId('realtime-indicator')).toHaveTextContent('En vivo');
    act(() => last().drop());
    expect(screen.getByTestId('realtime-indicator')).toHaveTextContent('Sin actualizaciones en vivo');
  });

  it('evento de la campaña → una recarga coalescida; otra campaña → nada', async () => {
    const reload = vi.fn();
    renderProbe({ campaign: 'prueba', onReload: reload });
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    act(() => {
      last().push(evt('roster.changed', { campaign: 'zendere' }));
      last().push(evt('roster.changed', { campaign: 'prueba' }));
      last().push(evt('roster.changed', { campaign: 'prueba' }));
      last().push(evt('uploads.changed', { campaign: 'prueba' }));
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 1200));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('trabajo sin guardar → aviso "Hay cambios nuevos · Actualizar" que recarga al pulsarlo', async () => {
    const reload = vi.fn();
    renderProbe({ campaign: 'prueba', dirty: true, onReload: reload });
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    act(() => last().push(evt('roster.changed', { campaign: 'prueba' })));
    expect(await screen.findByText('Hay cambios nuevos ·', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Hay cambios nuevos ·')).toBeNull();
  });

  it('lectura al reconectar: tras una caída, la confirmación recarga una vez', async () => {
    const reload = vi.fn();
    renderProbe({ campaign: 'prueba', onReload: reload });
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    act(() => last().drop());
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
    act(() => last().confirm());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it('session.refresh: cierra con 4001, relee /api/me y recarga la sección', async () => {
    const reload = vi.fn();
    const refreshAccess = vi.fn(async () => {});
    renderProbe({ campaign: 'prueba', onReload: reload }, refreshAccess);
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    act(() => last().push(evt('session.refresh', { ref: { reason: 'permissions' } })));
    expect(sockets[0]!.closedWith?.code).toBe(REFRESH_CLOSE_CODE);
    expect(refreshAccess).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 12_000 });
  }, 20_000);

  it('canal deshabilitado: ninguna conexión; recarga al volver el foco (máx. 1 por minuto)', async () => {
    const reload = vi.fn();
    render(
      <RealtimeProvider config={{ enabled: false, url: null, version: 't' }} createSocket={factory}>
        <Probe campaign="prueba" onReload={reload} />
      </RealtimeProvider>,
    );
    expect(screen.getByTestId('realtime-indicator')).toHaveTextContent('Sin actualizaciones en vivo');
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 3000 });
    act(() => void window.dispatchEvent(new Event('focus')));
    await new Promise((r) => setTimeout(r, 1200));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(0);
  });

  it('pestaña oculta más de 10 min: cierra; al volver reconecta y recarga una vez', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reload = vi.fn();
    renderProbe({ campaign: 'prueba', onReload: reload });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    last().autoPong = true;
    act(() => last().confirm());
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => void (await vi.advanceTimersByTimeAsync(HIDDEN_CLOSE_MS + 1000)));
    expect(sockets[0]!.closedWith).toEqual({ code: 1000, reason: 'paused' });
    vis.mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    act(() => last().confirm());
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('logout cierra la conexión', async () => {
    renderProbe({ campaign: 'prueba', onReload: () => {} });
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    act(() => void window.dispatchEvent(new Event(LOGOUT_EVENT)));
    expect(sockets[0]!.closedWith).toEqual({ code: 1000, reason: 'stop' });
  });

  it('fuera del provider el hook no hace nada', () => {
    const reload = vi.fn();
    render(<Probe campaign="prueba" onReload={reload} />);
    expect(screen.queryByTestId('realtime-indicator')).toBeNull();
  });
});

const ME = (over: Record<string, unknown> = {}) => ({
  username: 'sup',
  permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute', 'ana:admin:agents:manage', 'ana:campaign:message:send'],
  campaigns: ['prueba'],
  roleNames: ['Líder Prueba'],
  isAdmin: false,
  isLeader: true,
  isDeveloper: false,
  ...over,
});

describe('ConsoleGate con el canal', () => {
  it('una sola conexión al navegar entre secciones; actualización forzada relee /api/me', async () => {
    setLocation('/contactos');
    let me = ME();
    apiFetch.mockImplementation(async (url: string) => (url === '/api/me' ? me : {}));
    const realtime = { config: CONFIG, createSocket: factory, getToken };
    const { rerender } = render(
      <ConsoleGate sections={SECTIONS} realtime={realtime}>
        <p>contactos</p>
      </ConsoleGate>,
    );
    expect(await screen.findByText('contactos')).toBeInTheDocument();
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    setLocation('/agentes');
    rerender(
      <ConsoleGate sections={SECTIONS} realtime={realtime}>
        <p>agentes</p>
      </ConsoleGate>,
    );
    expect(await screen.findByText('agentes')).toBeInTheDocument();
    expect(sockets).toHaveLength(1);
    // Le quitan la gestión de agentes: session.refresh → relee /api/me → "Sin acceso".
    me = ME({ permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute'], isLeader: false });
    act(() => last().push(evt('session.refresh', { ref: { reason: 'permissions' } })));
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(apiFetch.mock.calls.filter(([u]) => u === '/api/me')).toHaveLength(2);
  });

  it('sin URL configurada no abre WebSocket', async () => {
    apiFetch.mockImplementation(async (url: string) => (url === '/api/me' ? ME() : {}));
    render(
      <ConsoleGate sections={SECTIONS} realtime={{ createSocket: factory }}>
        <p>inicio</p>
      </ConsoleGate>,
    );
    expect(await screen.findByText('inicio')).toBeInTheDocument();
    expect(screen.getByTestId('realtime-indicator')).toHaveTextContent('Sin actualizaciones en vivo');
    expect(sockets).toHaveLength(0);
  });
});

const inProvider = (ui: React.ReactNode) => (
  <RealtimeProvider config={CONFIG} createSocket={factory} getToken={getToken}>
    {ui}
  </RealtimeProvider>
);

async function pick(label: RegExp, option: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.click(screen.getByRole('option', { name: option }));
}

describe('secciones', () => {
  it('historial de cargas: uploads.changed de su campaña recarga; de otra campaña no', async () => {
    apiFetch.mockImplementation(async (url: string) => (url === '/api/campaigns' ? { campaigns: ['prueba', 'zendere'] } : { items: [] }));
    render(inProvider(<UploadHistoryView />));
    await pick(/Campaña/, 'prueba');
    const uploadsCalls = () => apiFetch.mock.calls.filter(([u]) => String(u).includes('/uploads?')).length;
    await waitFor(() => expect(uploadsCalls()).toBe(1));
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    act(() => last().push(evt('uploads.changed', { campaign: 'zendere' })));
    await new Promise((r) => setTimeout(r, 1200));
    expect(uploadsCalls()).toBe(1);
    act(() => last().push(evt('uploads.changed', { campaign: 'prueba', ref: { srcKey: 'k' } })));
    await waitFor(() => expect(uploadsCalls()).toBe(2), { timeout: 3000 });
  });

  const K1 = 'assignments/agents/prueba/ana.lopez-contacts-T1.csv';
  const CSV1 = 'phone_number,first_name\n5215500000001,Ana\n';
  function setAssignmentApi() {
    let pending: unknown[] = [];
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/agent/campaigns') return { campaigns: ['prueba'] };
      if (url.endsWith('/publications')) return { items: [] };
      if (url.includes('/file?key=')) return { key: K1, etag: '"e1"', csv: CSV1 };
      if (/^\/api\/agent\/assignments\/[^/]+$/.test(url)) return { items: pending };
      return {};
    });
    return (p: unknown[]) => (pending = p);
  }
  const FILE = { key: K1, fileName: 'ana.lopez-contacts-T1.csv', lastModified: '2026-10-26T10:00:00Z', size: 80, etag: '"e1"' };

  it('Mi asignación sin archivos cargados: assignment.pending muestra el nuevo pendiente', async () => {
    const setPending = setAssignmentApi();
    render(inProvider(<MyAssignmentView />));
    expect(await screen.findByText('Sin asignaciones pendientes')).toBeInTheDocument();
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    setPending([FILE]);
    act(() => last().push(evt('assignment.pending', { campaign: 'prueba' })));
    expect(await screen.findByText('ana.lopez-contacts-T1.csv', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('Mi asignación con contactos cargados y seleccionados: aviso en lugar de recargar', async () => {
    const setPending = setAssignmentApi();
    setPending([FILE]);
    render(inProvider(<MyAssignmentView />));
    await screen.findByTestId('pending-files');
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByTestId('contacts-table');
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => last().confirm());
    const pendingCalls = () => apiFetch.mock.calls.filter(([u]) => /^\/api\/agent\/assignments\/[^/]+$/.test(String(u))).length;
    const before = pendingCalls();
    act(() => last().push(evt('assignment.pending', { campaign: 'prueba' })));
    expect(await screen.findByText('Hay cambios nuevos ·', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(pendingCalls()).toBe(before);
    expect(screen.getByTestId('contacts-table')).toBeInTheDocument();
  });

  it('Agentes: "Forzar actualización" solo para admin; envía el alcance al BFF', async () => {
    setLocation('/agentes');
    const users = { users: [], total: 0, page: 1, pageSize: 50, rolesAvailable: true, campaign: null, fleets: null, inactiveOverrides: null };
    apiFetch.mockImplementation(async (url: string, init?: { method?: string; json?: unknown }) => {
      if (url === '/api/me') return ME({ isAdmin: true, permissions: ['ana:admin:console:manage'] });
      if (url === '/api/campaigns') return { campaigns: ['prueba'] };
      if (url.startsWith('/api/users')) return users;
      if (url === '/api/realtime/refresh') return { ok: true, init };
      return {};
    });
    render(
      <ConsoleGate sections={SECTIONS}>
        <AgentsView />
      </ConsoleGate>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Forzar actualización' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Forzar actualización');
    const cont = screen.getByRole('button', { name: 'Continuar' });
    expect(cont).toBeDisabled(); // usuario vacío
    await userEvent.type(screen.getByLabelText('Usuario'), 'jperez');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(/Se cerrarán todas las sesiones en vivo de jperez/)).toBeInTheDocument();
    const confirmDialog = screen.getByRole('dialog');
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Forzar actualización' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/api/realtime/refresh', { method: 'POST', json: { scope: 'user', username: 'jperez' } }),
    );
  });

  it('Agentes: supervisor sin ana:admin:console:manage no ve el botón', async () => {
    setLocation('/agentes');
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/me') return ME();
      if (url === '/api/campaigns') return { campaigns: ['prueba'] };
      if (url.startsWith('/api/users')) return { users: [], total: 0, page: 1, pageSize: 50, rolesAvailable: true, campaign: null, fleets: null, inactiveOverrides: null };
      return {};
    });
    render(
      <ConsoleGate sections={SECTIONS}>
        <AgentsView />
      </ConsoleGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Agentes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forzar actualización' })).toBeNull();
  });
});
