// File: Login
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useState } from 'react';
import { Button } from '../ui/Button';
import { OtpInput } from '../ui/OtpInput';
import { login, confirmLogin, type LoginStep } from '../lib/auth';

// Regla design-system: login SIEMPRE fondo azul, identificador = username
// (no email, sin type="email" ni regex de correo).
export function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Paso actual del flujo (credenciales → posible MFA).
  const [step, setStep] = useState<LoginStep>({ status: 'done' });
  const [phase, setPhase] = useState<'creds' | 'challenge'>('creds');
  const [answer, setAnswer] = useState(''); // código TOTP/SMS o nueva contraseña

  function apply(next: LoginStep) {
    if (next.status === 'done') {
      onDone();
      return;
    }
    setStep(next);
    setPhase('challenge');
    setAnswer('');
  }

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      apply(await login(username.trim(), password));
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  async function submitChallenge(e: React.FormEvent | null, value?: string) {
    e?.preventDefault();
    const resp = (value ?? answer).trim();
    if (!resp) return;
    setError(null);
    setLoading(true);
    try {
      // mfaSelect: la respuesta es el método (TOTP/SMS); el resto, el código/clave.
      apply(await confirmLogin(resp));
    } catch (err: any) {
      setError(err?.message ?? 'Código incorrecto');
    } finally {
      setLoading(false);
    }
  }

  const isCode = step.status === 'totp' || step.status === 'sms';

  const challengeLabel: Record<string, string> = {
    totp: 'Código de tu app de autenticación',
    sms: 'Código que recibiste por SMS',
    newPassword: 'Nueva contraseña',
    mfaSelect: 'Método de verificación (TOTP / SMS)',
    totpSetup: 'Configura TOTP y escribe el código',
  };

  return (
    <div className="pernexium-gradient flex min-h-screen items-center justify-center px-4">
      <div className="pernexium-card w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold text-primary">ana</h1>
        <p className="mt-1 text-sm text-text-light">Acceso de operador</p>

        {phase === 'creds' ? (
          <form onSubmit={submitCreds} aria-label="Inicio de sesión">
            <label className="mt-6 block text-sm font-semibold text-text-muted" htmlFor="username">
              Usuario
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
              required
            />

            <label className="mt-4 block text-sm font-semibold text-text-muted" htmlFor="password">
              Contraseña
            </label>
            <div className="relative mt-1">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-neutral-50 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-2 my-auto h-fit px-1 text-xs font-semibold text-secondary"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl bg-error-10 px-4 py-2 text-sm text-error-70">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="mt-6 w-full">
              {loading ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitChallenge} aria-label="Verificación">
            <label className="mt-6 block text-sm font-semibold text-text-muted" htmlFor="answer">
              {challengeLabel[step.status] ?? 'Verificación'}
            </label>

            {step.status === 'totpSetup' && step.secret && (
              <p className="mt-1 break-all rounded-xl bg-neutral-30 px-3 py-2 font-mono text-xs text-text-muted">
                Secreto: {step.secret}
              </p>
            )}
            {step.status === 'mfaSelect' && (
              <p className="mt-1 text-xs text-text-light">
                Escribe: {step.options.join(' o ')}
              </p>
            )}

            {isCode ? (
              // Código en cajas separadas; auto-submit al completar.
              <OtpInput
                length={6}
                disabled={loading}
                onComplete={(code) => void submitChallenge(null, code)}
              />
            ) : (
              <input
                id="answer"
                type={step.status === 'newPassword' ? 'password' : 'text'}
                autoFocus
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            )}

            {error && (
              <div className="mt-4 rounded-xl bg-error-10 px-4 py-2 text-sm text-error-70">
                {error}
              </div>
            )}

            {!isCode && (
              <Button type="submit" disabled={loading} className="mt-6 w-full">
                {loading ? 'Verificando…' : 'Continuar'}
              </Button>
            )}
            {isCode && loading && (
              <p className="mt-4 text-center text-sm text-text-light">Verificando…</p>
            )}
            <button
              type="button"
              onClick={() => {
                setPhase('creds');
                setError(null);
              }}
              className="mt-2 w-full text-xs text-text-light hover:underline"
            >
              Volver
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
