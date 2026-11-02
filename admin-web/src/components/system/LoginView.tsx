'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { hasSession } from '@/lib/auth-client';
import { centralLoginUrl } from '@/lib/central-login';
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

// Tope anti-bucle: si el login central regresa y la app sigue sin leer la
// cookie (host fuera del apex, preview, http), no rebotar sin fin.
const HOPS_KEY = 'ana-admin:login-hops';
const HOPS_WINDOW_MS = 30_000;
const MAX_HOPS = 4;

function recentHops(now: number): number[] {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(HOPS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((t): t is number => typeof t === 'number' && now - t < HOPS_WINDOW_MS) : [];
  } catch {
    return [];
  }
}

function saveHops(hops: number[]): void {
  try {
    if (hops.length) window.sessionStorage.setItem(HOPS_KEY, JSON.stringify(hops));
    else window.sessionStorage.removeItem(HOPS_KEY);
  } catch {
    /* sin storage: se redirige sin tope */
  }
}

type Phase = 'checking' | 'stuck';

/** Navegación fuera de la app (sustituible en pruebas: jsdom no navega). */
export const loginNavigation = {
  redirect: (url: string): void => window.location.replace(url),
};

/**
 * `/login` sin formulario: con sesión entra a `next`; sin sesión manda al login
 * central (login.pernexium.com.mx) con la URL absoluta de vuelta.
 */
export function LoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params?.get('next'));
  const [phase, setPhase] = useState<Phase>('checking');

  const check = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setPhase('checking');
      const ok = await hasSession();
      if (isCancelled()) return;
      if (ok) {
        saveHops([]);
        router.replace(next);
        return;
      }
      const now = Date.now();
      const hops = recentHops(now);
      if (hops.length >= MAX_HOPS) {
        setPhase('stuck');
        return;
      }
      saveHops([...hops, now]);
      loginNavigation.redirect(centralLoginUrl(`${window.location.origin}${next}`));
    },
    [router, next],
  );

  useEffect(() => {
    let cancelled = false;
    void check(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [check]);

  if (phase === 'stuck') {
    return (
      <LoginShell>
        <h1 className="mb-1 text-xl font-bold text-primary-foreground">No se pudo leer tu sesión</h1>
        <div role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">
          Iniciaste sesión, pero ANA Admin no logra leerla en este navegador. Abre ANA Admin desde
          ana-admin.pernexium.com.mx e intenta de nuevo.
        </div>
        <Button
          className="mt-6 w-full"
          variant="inverse"
          size="lg"
          onClick={() => {
            saveHops([]);
            void check();
          }}
        >
          Reintentar
        </Button>
      </LoginShell>
    );
  }

  return (
    <LoginShell>
      <div className="flex flex-col gap-4" data-testid="login-checking">
        <p className="text-sm text-primary-light-80">Redirigiendo al inicio de sesión de Pernexium…</p>
        <Skeleton className="h-11 w-full bg-white/20" />
      </div>
    </LoginShell>
  );
}
