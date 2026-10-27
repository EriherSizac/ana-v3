'use client';

// File: "Forzar actualización" — un admin hace que las sesiones de un usuario, una campaña o todas relean su acceso (add-realtime-admin-web D8).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import { Button, ConfirmDialog, Dialog, InlineMessage, Input, Label, SearchableSelect, useToast } from '@/components/ui';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';

export type RefreshScope = 'user' | 'campaign' | 'all';

const SCOPE_OPTIONS: { value: RefreshScope; label: string }[] = [
  { value: 'user', label: 'Un usuario' },
  { value: 'campaign', label: 'Una campaña' },
  { value: 'all', label: 'Todos los usuarios' },
];

export interface ForceRefreshDialogProps {
  open: boolean;
  onClose: () => void;
  campaigns: readonly string[];
  /** Campaña elegida en la vista (valor inicial de "Una campaña"). */
  defaultCampaign?: string | null;
}

/** Cuerpo de `POST /api/realtime/refresh` o null si falta el destino. */
export function refreshBody(scope: RefreshScope, username: string, campaign: string | null) {
  if (scope === 'all') return { scope } as const;
  if (scope === 'user') return username.trim() ? ({ scope, username: username.trim() } as const) : null;
  return campaign ? ({ scope, campaign } as const) : null;
}

/** Texto del alcance para la confirmación y el aviso de éxito. */
export function scopeText(scope: RefreshScope, username: string, campaign: string | null): string {
  if (scope === 'all') return 'todos los usuarios';
  if (scope === 'user') return username.trim();
  return `la campaña ${campaign ?? ''}`;
}

export function ForceRefreshDialog({ open, onClose, campaigns, defaultCampaign }: ForceRefreshDialogProps) {
  const toast = useToast();
  const [scope, setScope] = useState<RefreshScope>('user');
  const [username, setUsername] = useState('');
  const [campaign, setCampaign] = useState<string | null>(defaultCampaign ?? null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope('user');
    setUsername('');
    setCampaign(defaultCampaign ?? null);
    setConfirming(false);
    setError(null);
  }, [open, defaultCampaign]);

  const body = refreshBody(scope, username, campaign);
  const target = scopeText(scope, username, campaign);

  const send = async () => {
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch('/api/realtime/refresh', { method: 'POST', json: body });
      toast.success(`Se pidió la actualización de ${target}`);
      setConfirming(false);
      onClose();
    } catch (e) {
      if (isRedirecting(e)) return;
      setError(e instanceof ApiError ? e.message : 'No se pudo pedir la actualización.');
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && !confirming}
        onClose={onClose}
        title="Forzar actualización"
        description="Las sesiones abiertas (ANA Admin, desktop y CLI) vuelven a leer sus permisos y su estado y se reconectan en segundos. No se pierde trabajo."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!body}>
              Continuar
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <SearchableSelect label="Alcance" options={SCOPE_OPTIONS} value={scope} onChange={(v) => setScope(v as RefreshScope)} />
          {scope === 'user' && (
            <div>
              <Label htmlFor="force-refresh-username">Usuario</Label>
              <Input
                id="force-refresh-username"
                className="mt-1 font-mono"
                placeholder="usuario del pool"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}
          {scope === 'campaign' && (
            <SearchableSelect
              label="Campaña"
              options={campaigns.map((c) => ({ value: c, label: c }))}
              value={campaign}
              onChange={setCampaign}
            />
          )}
          {error && <InlineMessage>{error}</InlineMessage>}
        </div>
      </Dialog>
      <ConfirmDialog
        open={open && confirming}
        title="Forzar actualización"
        description={`Se cerrarán todas las sesiones en vivo de ${target}; cada una relee su acceso y se reconecta sola.`}
        confirmLabel="Forzar actualización"
        loading={sending}
        onCancel={() => setConfirming(false)}
        onConfirm={send}
      />
    </>
  );
}
