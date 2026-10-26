import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router, setLocation } from '../helpers/navigation';

vi.mock('next/navigation', () => import('../helpers/navigation'));

const hasSession = vi.fn();
const login = vi.fn();
const confirmLogin = vi.fn();
vi.mock('@/lib/auth-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/auth-client')>('@/lib/auth-client');
  return {
    loginErrorMessage: real.loginErrorMessage,
    hasSession: () => hasSession(),
    login: (...a: unknown[]) => login(...a),
    confirmLogin: (...a: unknown[]) => confirmLogin(...a),
  };
});

import { LoginView } from '@/components/system/LoginView';

describe('/login', () => {
  beforeEach(() => {
    resetNavigation();
    hasSession.mockReset();
    login.mockReset();
    confirmLogin.mockReset();
  });

  it('con sesión vigente redirige a `next` sin mostrar el formulario', async () => {
    setLocation('/login', 'next=/agentes');
    hasSession.mockResolvedValue(true);
    render(<LoginView />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/agentes'));
    expect(screen.queryByLabelText('Usuario')).toBeNull();
  });

  it('`next` externo se ignora y redirige a /', async () => {
    setLocation('/login', 'next=https://ejemplo.com');
    hasSession.mockResolvedValue(true);
    render(<LoginView />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('el campo Usuario acepta un username que no es correo', async () => {
    hasSession.mockResolvedValue(false);
    login.mockResolvedValue({ status: 'done' });
    render(<LoginView />);
    const user = await screen.findByLabelText('Usuario');
    expect(user).toHaveAttribute('type', 'text');
    await userEvent.type(user, 'erick.silva');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'secreto');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(login).toHaveBeenCalledWith('erick.silva', 'secreto');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('credenciales incorrectas → mensaje inline', async () => {
    hasSession.mockResolvedValue(false);
    login.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAuthorizedException' }));
    render(<LoginView />);
    await userEvent.type(await screen.findByLabelText('Usuario'), 'erick.silva');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('mostrar/ocultar contraseña', async () => {
    hasSession.mockResolvedValue(false);
    render(<LoginView />);
    const pw = await screen.findByLabelText('Contraseña');
    expect(pw).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(pw).toHaveAttribute('type', 'text');
  });

  it('MFA TOTP: campo de 6 dígitos y completa la sesión', async () => {
    setLocation('/login', 'next=%2Fagentes');
    hasSession.mockResolvedValue(false);
    login.mockResolvedValue({ status: 'totp' });
    confirmLogin.mockResolvedValue({ status: 'done' });
    render(<LoginView />);
    await userEvent.type(await screen.findByLabelText('Usuario'), 'u');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'p');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    const code = await screen.findByLabelText('Código de 6 dígitos');
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(confirmLogin).toHaveBeenCalledWith('123456');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/agentes'));
  });

  it('nueva contraseña obligatoria: pide confirmación', async () => {
    hasSession.mockResolvedValue(false);
    login.mockResolvedValue({ status: 'newPassword' });
    confirmLogin.mockResolvedValue({ status: 'done' });
    render(<LoginView />);
    await userEvent.type(await screen.findByLabelText('Usuario'), 'u');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'p');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await userEvent.type(await screen.findByLabelText('Nueva contraseña'), 'Nueva#2026');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'Otra#2026');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.');
    await userEvent.clear(screen.getByLabelText('Confirmar contraseña'));
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'Nueva#2026');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }));
    expect(confirmLogin).toHaveBeenCalledWith('Nueva#2026');
  });

  it('alta de TOTP muestra el secreto', async () => {
    hasSession.mockResolvedValue(false);
    login.mockResolvedValue({ status: 'totpSetup', secret: 'ABC123', uri: 'otpauth://totp/x' });
    render(<LoginView />);
    await userEvent.type(await screen.findByLabelText('Usuario'), 'u');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'p');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByTestId('totp-secret')).toHaveTextContent('ABC123');
  });

  it('paso no soportado → mensaje inline y vuelve al formulario', async () => {
    hasSession.mockResolvedValue(false);
    login.mockResolvedValue({ status: 'unsupported', step: 'X' });
    render(<LoginView />);
    await userEvent.type(await screen.findByLabelText('Usuario'), 'u');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'p');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no soporta/);
    expect(screen.getByLabelText('Usuario')).toBeInTheDocument();
  });
});
