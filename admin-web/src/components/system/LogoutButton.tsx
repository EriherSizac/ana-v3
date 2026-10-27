'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { InlineMessage } from '@/components/ui/Toast';
import { logout } from '@/lib/auth-client';
import { LOGOUT_EVENT } from '@/lib/realtime/RealtimeProvider';

/** Diálogo de cierre de sesión con la advertencia de sesión compartida. */
export function LogoutDialog({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  const router = useRouter();
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
          router.replace('/login');
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
