import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router, setLocation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));

const hasSession = vi.fn();
vi.mock('@/lib/auth-client', () => ({ hasSession: () => hasSession() }));

import { LoginView, loginNavigation } from '@/components/system/LoginView';

const CENTRAL = 'http://localhost:3100'; // fuera de producción
const back = (path: string) => `${CENTRAL}/?redirect=${encodeURIComponent(`${window.location.origin}${path}`)}`;

describe('/login (login central)', () => {
  const redirect = vi.fn();
  const original = loginNavigation.redirect;

  beforeEach(() => {
    resetNavigation();
    hasSession.mockReset();
    redirect.mockReset();
    loginNavigation.redirect = redirect;
    window.sessionStorage.clear();
  });

  afterEach(() => {
    loginNavigation.redirect = original;
    vi.useRealTimers();
  });

  it('con sesión vigente redirige a `next` sin ir al login central', async () => {
    setLocation('/login', 'next=/agentes');
    hasSession.mockResolvedValue(true);
    render(<LoginView />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/agentes'));
    expect(redirect).not.toHaveBeenCalled();
  });

  it('`next` externo se ignora y usa /', async () => {
    setLocation('/login', 'next=https://ejemplo.com');
    hasSession.mockResolvedValue(true);
    render(<LoginView />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('sin sesión manda al login central con la URL absoluta de vuelta y sin formulario propio', async () => {
    setLocation('/login', 'next=%2Fagentes%3Fcampaign%3Dx');
    hasSession.mockResolvedValue(false);
    render(<LoginView />);
    await waitFor(() => expect(redirect).toHaveBeenCalledWith(back('/agentes?campaign=x')));
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Usuario')).toBeNull();
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
  });

  it('`next` externo sin sesión vuelve al inicio de ANA Admin', async () => {
    setLocation('/login', 'next=//ejemplo.com');
    hasSession.mockResolvedValue(false);
    render(<LoginView />);
    await waitFor(() => expect(redirect).toHaveBeenCalledWith(back('/')));
  });

  it('a la quinta ida en 30 s se detiene, muestra "Reintentar" y este vuelve a intentar', async () => {
    hasSession.mockResolvedValue(false);
    for (let i = 0; i < 4; i++) {
      const { unmount } = render(<LoginView />);
      await waitFor(() => expect(redirect).toHaveBeenCalledTimes(i + 1));
      unmount();
    }
    render(<LoginView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no logra leerla');
    expect(redirect).toHaveBeenCalledTimes(4);

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(5));
  });

  it('las idas de hace más de 30 s no cuentan', async () => {
    const old = Date.now() - 31_000;
    window.sessionStorage.setItem('ana-admin:login-hops', JSON.stringify([old, old, old, old]));
    hasSession.mockResolvedValue(false);
    render(<LoginView />);
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
  });

  it('con sesión limpia el conteo', async () => {
    window.sessionStorage.setItem('ana-admin:login-hops', JSON.stringify([Date.now()]));
    hasSession.mockResolvedValue(true);
    render(<LoginView />);
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(window.sessionStorage.getItem('ana-admin:login-hops')).toBeNull();
  });
});
