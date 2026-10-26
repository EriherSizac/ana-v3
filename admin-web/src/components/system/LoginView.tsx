'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { confirmLogin, hasSession, login, loginErrorMessage, type LoginStep } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-next';

/** Fondo azul obligatorio del login (design-system §11). */
export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div className="pernexium-gradient flex min-h-screen items-center justify-center px-4 py-12 text-primary-foreground">
      <main className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-lg font-black uppercase tracking-[0.3em] text-primary-foreground">PERNEXIUM</p>
          <span className="mt-2 inline-block rounded-full bg-white/15 px-3 py-0.5 text-xs font-semibold text-primary-foreground">
            ANA Admin
          </span>
        </div>
        <div className="rounded-2xl border border-white/15 bg-white/10 p-6 shadow-card backdrop-blur">{children}</div>
      </main>
    </div>
  );
}

const fieldClass =
  'h-11 w-full rounded-xl border border-white/30 bg-white/10 px-3 text-sm text-primary-foreground placeholder:text-primary-light-70 ' +
  'focus:outline-none focus:ring-2 focus:ring-secondary';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-primary-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function LoginError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">
      {children}
    </div>
  );
}

type Phase = 'checking' | 'credentials' | LoginStep['status'];

const MFA_LABELS: Record<string, string> = { TOTP: 'App autenticadora', SMS: 'Mensaje SMS', EMAIL: 'Correo' };

export function LoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params?.get('next'));

  const [phase, setPhase] = useState<Phase>('checking');
  const [step, setStep] = useState<LoginStep | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Chequeo de sesión al montar (SSO): con sesión vigente, redirige sin mostrar el formulario.
  useEffect(() => {
    let cancelled = false;
    void hasSession().then((ok) => {
      if (cancelled) return;
      if (ok) router.replace(next);
      else setPhase('credentials');
    });
    return () => {
      cancelled = true;
    };
  }, [router, next]);

  const apply = (s: LoginStep) => {
    setCode('');
    if (s.status === 'done') {
      router.replace(next);
      return;
    }
    if (s.status === 'unsupported') {
      setError('Tu cuenta requiere un paso de inicio de sesión que ANA Admin no soporta. Contacta a tu administrador.');
      setPhase('credentials');
      setStep(null);
      return;
    }
    setStep(s);
    setPhase(s.status);
  };

  const run = async (fn: () => Promise<LoginStep>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
    } catch (e) {
      setError(loginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onCredentials = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Escribe tu usuario y contraseña.');
      return;
    }
    // Username tal cual: sin validación de correo (design-system §11).
    void run(() => login(username.trim(), password));
  };

  const onCode = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Escribe el código de 6 dígitos.');
      return;
    }
    void run(() => confirmLogin(code));
  };

  const onNewPassword = (e: FormEvent) => {
    e.preventDefault();
    if (!newPassword) {
      setError('Escribe la nueva contraseña.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    void run(() => confirmLogin(newPassword));
  };

  if (phase === 'checking') {
    return (
      <LoginShell>
        <div className="flex flex-col gap-4" data-testid="login-checking">
          <Skeleton className="h-11 w-full bg-white/20" />
          <Skeleton className="h-11 w-full bg-white/20" />
          <Skeleton className="h-11 w-full bg-white/20" />
        </div>
      </LoginShell>
    );
  }

  return (
    <LoginShell>
      <h1 className="mb-1 text-xl font-bold text-primary-foreground">Iniciar sesión</h1>
      <p className="mb-6 text-sm text-primary-light-80">Usa tu usuario de Pernexium.</p>

      {phase === 'credentials' && (
        <form onSubmit={onCredentials} className="flex flex-col gap-4" noValidate>
          <Field id="username" label="Usuario">
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={fieldClass}
            />
          </Field>
          <Field id="password" label="Contraseña">
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${fieldClass} pr-11`}
              />
              <button
                type="button"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg text-primary-foreground hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
          </Field>
          {error && <LoginError>{error}</LoginError>}
          <Button type="submit" variant="inverse" loading={busy} size="lg">
            Entrar
          </Button>
        </form>
      )}

      {(phase === 'totp' || phase === 'sms') && (
        <form onSubmit={onCode} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-primary-light-80">
            {phase === 'totp' ? 'Escribe el código de tu app autenticadora.' : 'Escribe el código que recibiste por SMS.'}
          </p>
          <Field id="code" label="Código de 6 dígitos">
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${fieldClass} font-mono tracking-[0.4em]`}
            />
          </Field>
          {error && <LoginError>{error}</LoginError>}
          <Button type="submit" variant="inverse" loading={busy} size="lg">
            Verificar
          </Button>
        </form>
      )}

      {phase === 'mfaSelect' && step?.status === 'mfaSelect' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-primary-light-80">Elige cómo quieres verificar tu identidad.</p>
          {step.options.map((o) => (
            <Button
              key={o}
              loading={busy}
              onClick={() => void run(() => confirmLogin(o))}
              variant="inverse" size="lg"
            >
              {MFA_LABELS[o] ?? o}
            </Button>
          ))}
          {error && <LoginError>{error}</LoginError>}
        </div>
      )}

      {phase === 'totpSetup' && step?.status === 'totpSetup' && (
        <form onSubmit={onCode} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-primary-light-80">
            Configura tu app autenticadora con este secreto (o la URI) y escribe el código que genera.
          </p>
          {step.secret && (
            <div>
              <p className="text-xs font-semibold text-primary-foreground">Secreto</p>
              <p className="break-all rounded-lg bg-white/10 px-3 py-2 font-mono text-xs" data-testid="totp-secret">
                {step.secret}
              </p>
            </div>
          )}
          {step.uri && (
            <div>
              <p className="text-xs font-semibold text-primary-foreground">URI</p>
              <p className="break-all rounded-lg bg-white/10 px-3 py-2 font-mono text-2xs">{step.uri}</p>
            </div>
          )}
          <Field id="code" label="Código de 6 dígitos">
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${fieldClass} font-mono tracking-[0.4em]`}
            />
          </Field>
          {error && <LoginError>{error}</LoginError>}
          <Button type="submit" variant="inverse" loading={busy} size="lg">
            Activar y entrar
          </Button>
        </form>
      )}

      {phase === 'newPassword' && (
        <form onSubmit={onNewPassword} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-primary-light-80">Es tu primer acceso: define una nueva contraseña.</p>
          <Field id="new-password" label="Nueva contraseña">
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={fieldClass}
            />
          </Field>
          <Field id="confirm-password" label="Confirmar contraseña">
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={fieldClass}
            />
          </Field>
          {error && <LoginError>{error}</LoginError>}
          <Button type="submit" variant="inverse" loading={busy} size="lg">
            Guardar y entrar
          </Button>
        </form>
      )}
    </LoginShell>
  );
}
