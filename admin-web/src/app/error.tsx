'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { PageContainer } from '@/components/ui/Page';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Solo el digest: nunca detalles técnicos en pantalla.
    console.error('[ui] error', error.digest ?? '');
  }, [error]);
  return (
    <PageContainer narrow>
      <div className="pernexium-card p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">Error</h1>
        <p className="mt-2 text-sm text-text-light">Ocurrió un error inesperado. Intenta de nuevo o vuelve al inicio.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={reset}>Reintentar</Button>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-xl border border-neutral-60 bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
