'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { InlineMessage } from '@/components/ui/Toast';
import { logout } from '@/lib/auth-client';
import { centralLogoutUrl } from '@/lib/central-login';
import { LOGOUT_EVENT } from '@/lib/realtime/RealtimeProvider';

/** Navegación fuera de la app (sustituible en pruebas: jsdom no navega). */
export const logoutNavigation = {
  assign: (url: string): void => window.location.assign(url),
};

/** Diálogo de cierre de sesión con la advertencia de sesión compartida. */
export function LogoutDialog({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open={open}
      title="Cerrar sesión"
      description="La sesión es compartida: también se cerrará en las demás apps Pernexium abiertas en este navegador."
      confirmLabel="Cerrar sesión"
      destructive
      loading={loading}
      onCancel={() => {
        setError(null);
        onCancel();
      }}
      onConfirm={async () => {
        setLoading(true);
        setError(null);
        try {
          // Cierra el canal realtime antes de cerrar la sesión.
          window.dispatchEvent(new Event(LOGOUT_EVENT));
          await logout();
          // Termina en el login central, que también limpia su estado.
          logoutNavigation.assign(centralLogoutUrl(window.location.origin));
        } catch {
          setError('No se pudo cerrar la sesión. Intenta de nuevo.');
        } finally {
          setLoading(false);
        }
      }}
    >
      {error && <InlineMessage>{error}</InlineMessage>}
    </ConfirmDialog>
  );
}
