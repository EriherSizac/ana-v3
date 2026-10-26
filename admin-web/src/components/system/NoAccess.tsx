'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { PageContainer } from '@/components/ui/Page';
import { LogoutDialog } from './LogoutButton';

/** Página "Sin acceso" (403) con el layout estándar. */
export function NoAccess({ username, showHome = false }: { username: string; showHome?: boolean }) {
  const [logoutOpen, setLogoutOpen] = useState(false);
  return (
    <PageContainer narrow>
      <div className="pernexium-card p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">Sin acceso</h1>
        <p className="mt-2 text-sm text-text-light">
          El usuario <span className="font-mono text-text-muted">{username}</span> no tiene permisos para esta sección de ANA
          Admin. Si crees que es un error, pide a tu administrador que revise tus roles.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {showHome && (
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-xl border border-neutral-60 bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-light-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              Volver al inicio
            </Link>
          )}
          <Button variant={showHome ? 'ghost' : 'default'} onClick={() => setLogoutOpen(true)}>
            Cerrar sesión
          </Button>
        </div>
      </div>
      <LogoutDialog open={logoutOpen} onCancel={() => setLogoutOpen(false)} />
    </PageContainer>
  );
}
