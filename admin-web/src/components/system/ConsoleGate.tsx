'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PageContainer } from '@/components/ui/Page';
import { Skeleton } from '@/components/ui/Skeleton';
import { InlineMessage } from '@/components/ui/Toast';
import { canEnter, type Access } from '@/lib/access';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';
import { hasSession } from '@/lib/auth-client';
import { loginUrl } from '@/lib/safe-next';
import { allowedSections, sectionForPath, SECTIONS, type Section } from '@/lib/sections';
import { AccessContext } from './AccessContext';
import { AppHeader } from './AppHeader';
import { NoAccess } from './NoAccess';

type State =
  | { phase: 'checking' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; access: Access };

function GateSkeleton() {
  return (
    <div aria-hidden="true" data-testid="gate-skeleton">
      <div className="pernexium-gradient h-16" />
      <PageContainer>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </PageContainer>
    </div>
  );
}

/**
 * Gate de las rutas protegidas: resuelve la sesión al montar (Skeleton
 * mientras tanto), redirige a `/login?next=` sin sesión y carga el acceso de
 * `GET /api/me`. Sin permisos de entrada o de la sección → "Sin acceso".
 */
export function ConsoleGate({ children, sections = SECTIONS }: { children: ReactNode; sections?: readonly Section[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [state, setState] = useState<State>({ phase: 'checking' });

  const load = useCallback(async () => {
    setState({ phase: 'checking' });
    const ok = await hasSession();
    if (!ok) {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      router.replace(loginUrl(`${pathname}${search}`));
      return;
    }
    try {
      const access = await apiFetch<Access>('/api/me');
      setState({ phase: 'ready', access });
    } catch (e) {
      if (isRedirecting(e)) return;
      setState({
        phase: 'error',
        message: e instanceof ApiError ? e.message : 'No se pudo verificar tu acceso. Intenta de nuevo.',
      });
    }
    // Solo al montar: el acceso se conserva entre navegaciones internas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === 'checking') return <GateSkeleton />;

  if (state.phase === 'error') {
    return (
      <PageContainer narrow>
        <div className="pernexium-card p-8">
          <h1 className="text-2xl font-bold">No se pudo cargar ANA Admin</h1>
          <InlineMessage className="mt-4">{state.message}</InlineMessage>
          <Button className="mt-6" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      </PageContainer>
    );
  }

  const { access } = state;
  const visible = canEnter(access) ? allowedSections(access, sections) : [];
  const section = sectionForPath(pathname, sections);
  const blocked = !canEnter(access) || (section !== undefined && !section.isAllowed(access));

  return (
    <AccessContext.Provider value={access}>
      <AppHeader username={access.username} sections={visible} />
      {blocked ? <NoAccess username={access.username} showHome={canEnter(access)} /> : children}
    </AccessContext.Provider>
  );
}
