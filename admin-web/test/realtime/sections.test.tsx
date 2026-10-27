// Recarga en vivo por sección (add-realtime-admin-web 2.2–2.3).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { resetNavigation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));
vi.mock('@/lib/auth-client', () => ({ hasSession: async () => true, logout: vi.fn(), currentIdToken: vi.fn(async () => 'tok') }));
const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});

import type { WsLike } from '@/lib/realtime/client';
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider';
import { V4ReviewView } from '@/components/contacts/V4ReviewView';
import { ContactsUploadView } from '@/components/contacts/ContactsUploadView';
import { AgentsView } from '@/components/agents/AgentsView';
import { DesktopSettingsSection } from '@/components/settings/DesktopSettingsSection';

class FakeWs implements WsLike {
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onclose: WsLike['onclose'] = null;
  onerror: WsLike['onerror'] = null;
  send() {}
  close() {}
  confirm() {
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: 'pong' }) });
  }
  push(type: string, extra: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, type, id: String(Math.random()), at: 1, ...extra }) });
  }
}
let sockets: FakeWs[];
const factory = () => {
  const ws = new FakeWs();
  sockets.push(ws);
  return ws;
};
const CONFIG = { enabled: true, url: 'wss://abc.execute-api.us-east-2.amazonaws.com/prod', version: 't' };
const live = (ui: ReactNode) => (
  <RealtimeProvider config={CONFIG} createSocket={factory} getToken={async () => 'tok'}>
    {ui}
  </RealtimeProvider>
);
async function connected() {
  await waitFor(() => expect(sockets).toHaveLength(1));
  act(() => sockets[0]!.confirm());
  return sockets[0]!;
}
const count = (re: RegExp) => apiFetch.mock.calls.filter(([u]) => re.test(String(u))).length;
const pause = (ms = 1300) => new Promise((r) => setTimeout(r, ms));
async function pick(label: RegExp, option: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.click(screen.getByRole('option', { name: option }));
}

beforeEach(() => {
  sockets = [];
  resetNavigation();
  apiFetch.mockReset();
});

describe('Por revisar v4', () => {
  it('review.changed de la campaña → recarga una vez; de otra campaña → nada; con selección → aviso', async () => {
    const item = { operatorId: 'ana', jobId: 'j#1', srcKey: 'k', label: 'x', phone: '5510000001', row: { nombre: 'Contacto 1' }, auto: false, claimedAt: 1, reviewAt: 1, status: 'review' };
    apiFetch.mockImplementation(async (url: string) => (url.includes('/api/v4/campaigns/') ? { campaign: 'didi_vip', items: [item] } : {}));
    render(live(<V4ReviewView campaign="didi_vip" srcKey={null} />));
    await screen.findByRole('checkbox', { name: 'Seleccionar Contacto 1' });
    const ws = await connected();
    const reviews = () => count(/\/api\/v4\/campaigns\/didi_vip\/review/);
    expect(reviews()).toBe(1);
    act(() => ws.push('review.changed', { campaign: 'zendere' }));
    await pause();
    expect(reviews()).toBe(1);
    act(() => ws.push('review.changed', { campaign: 'didi_vip' }));
    await waitFor(() => expect(reviews()).toBe(2), { timeout: 3000 });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar Contacto 1' }));
    act(() => ws.push('review.changed', { campaign: 'didi_vip' }));
    expect(await screen.findByText('Hay cambios nuevos ·', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(reviews()).toBe(2);
  });
});

describe('Contactos (asistente de carga)', () => {
  it('sin archivo: roster.changed relee los destinatarios; con archivo cargado → aviso', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/campaigns') return { campaigns: ['didi_vip'] };
      if (url.includes('/enabled-agents')) return { agents: ['ana'], supervisors: [] };
      return {};
    });
    render(live(<ContactsUploadView pollIntervalMs={10} pollTimeoutMs={200} />));
    await pick(/Campaña/, 'didi_vip');
    const enabled = () => count(/\/enabled-agents/);
    await waitFor(() => expect(enabled()).toBe(1));
    const ws = await connected();
    act(() => ws.push('roster.changed', { campaign: 'didi_vip' }));
    await waitFor(() => expect(enabled()).toBe(2), { timeout: 3000 });
    const file = new File(['telefono,nombre\n5215500000001,Ana'], 'c.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), file);
    act(() => ws.push('uploads.changed', { campaign: 'didi_vip' }));
    expect(await screen.findByText('Hay cambios nuevos ·', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(enabled()).toBe(2);
  });
});

describe('Agentes', () => {
  it('roster.changed recarga la lista de usuarios', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/campaigns') return { campaigns: ['didi_vip'] };
      if (url.startsWith('/api/users')) return { users: [], total: 0, page: 1, pageSize: 50, rolesAvailable: true, campaign: null, fleets: null, inactiveOverrides: null };
      return {};
    });
    render(live(<AgentsView />));
    const users = () => count(/^\/api\/users\?/);
    await waitFor(() => expect(users()).toBe(1));
    const ws = await connected();
    act(() => ws.push('roster.changed', { campaign: 'didi_vip' }));
    await waitFor(() => expect(users()).toBe(2), { timeout: 3000 });
  });
});

describe('Configuración → Desktop v4', () => {
  const VIEW = {
    version: 0,
    settings: [{ key: 'sendMinGapSeconds', label: 'Separación', type: 'integer', min: 60, max: 600, default: 120, value: 120, description: 'd', updatedBy: null, updatedAt: null }],
  };
  it('settings.changed recarga; con un valor editado → aviso y el valor se conserva', async () => {
    apiFetch.mockResolvedValue(VIEW);
    render(live(<DesktopSettingsSection />));
    const row = await screen.findByTestId('desktop-setting-sendMinGapSeconds');
    const ws = await connected();
    act(() => ws.push('settings.changed', { ref: { scope: 'desktop' } }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const box = within(row).getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, '180');
    act(() => ws.push('settings.changed', { ref: { scope: 'desktop' } }));
    expect(await screen.findByText('Hay cambios nuevos ·', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(within(screen.getByTestId('desktop-setting-sendMinGapSeconds')).getByRole('textbox')).toHaveValue('180');
  });
});
