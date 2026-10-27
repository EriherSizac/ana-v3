'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, ConfirmDialog, InlineMessage, PageContainer, PageHeader, Skeleton, Toggle } from '@/components/ui';
import { formatDate } from '@/lib/agents';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';

interface CatalogEntry {
  key: string;
  type: string;
  default: boolean;
  label?: string;
  description: string;
}

interface CliSettingsData {
  settings: Record<string, boolean>;
  catalog: CatalogEntry[];
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Nombres legibles conocidos (el backend también los manda como `label`). */
const LABELS: Record<string, string> = {
  noWhatsappConsultRegistration: 'Registrar consulta de números sin WhatsApp',
};

const onOff = (v: boolean) => (v ? 'Activado' : 'Desactivado');

/** Reexportado desde `@/components/ui` (compatibilidad con importaciones anteriores). */
export { Toggle } from '@/components/ui';

/** Configuración remota del CLI v3 (solo Developer). La página se arma desde el catálogo. */
export function CliSettingsView({ children }: { children?: ReactNode } = {}) {
  const [data, setData] = useState<CliSettingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: string; value: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await apiFetch<CliSettingsData>('/api/cli-settings'));
    } catch (e) {
      if (isRedirecting(e)) return;
      setLoadError(e instanceof ApiError ? e.message : 'No se pudo cargar la configuración.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!pending) return;
    setSaving(true);
    setSaveError(null);
    try {
      setData(await apiFetch<CliSettingsData>('/api/cli-settings', { method: 'POST', json: { settings: { [pending.key]: pending.value } } }));
      setPending(null);
    } catch (e) {
      if (isRedirecting(e)) return;
      setPending(null);
      setSaveError(
        e instanceof ApiError && e.status === 409
          ? 'La configuración cambió; recarga para ver el valor actual'
          : e instanceof ApiError
            ? e.message
            : 'No se pudo guardar la configuración.',
      );
    } finally {
      setSaving(false);
    }
  };

  const labelOf = (c: CatalogEntry) => LABELS[c.key] ?? c.label ?? c.key;

  return (
    <PageContainer narrow>
      <PageHeader title="Configuración" description="Configuración remota del CLI v3. Los cambios aplican a todos los CLIs en hasta 5 minutos." />
      {loadError && (
        <InlineMessage className="mb-3">
          {loadError}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Reintentar
          </button>
        </InlineMessage>
      )}
      {saveError && <InlineMessage className="mb-3">{saveError}</InlineMessage>}
      <div className="pernexium-card divide-y divide-neutral-40">
        {!data && !loadError ? (
          <div className="flex flex-col gap-3 p-6" data-testid="settings-skeleton">
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : (
          data?.catalog.map((c) => {
            const value = data.settings[c.key] ?? c.default;
            return (
              <div key={c.key} className="flex items-start justify-between gap-4 p-6" data-testid={`setting-${c.key}`}>
                <div>
                  <h2 className="text-base font-semibold">{labelOf(c)}</h2>
                  <p className="mt-1 text-sm text-text-muted">{c.description}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-light">
                    <Badge variant={value ? 'primary' : 'muted'}>{onOff(value)}</Badge>
                    <span>Por defecto: {onOff(c.default)}</span>
                  </p>
                </div>
                {c.type === 'boolean' && <Toggle checked={value} label={labelOf(c)} onChange={() => setPending({ key: c.key, value: !value })} />}
              </div>
            );
          })
        )}
      </div>
      {data && (
        <p className="mt-3 text-xs text-text-light" data-testid="settings-audit">
          {data.updatedAt ? `Último cambio: ${data.updatedBy ?? '—'} · ${formatDate(data.updatedAt)}` : 'Sin cambios'}
        </p>
      )}
      {data && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => void load()}>
          Recargar
        </Button>
      )}
      {pending && data && (
        <ConfirmDialog
          open
          title={`${pending.value ? 'Activar' : 'Desactivar'}: ${labelOf(data.catalog.find((c) => c.key === pending.key)!)}`}
          description="El cambio aplica a todos los CLIs v3 en hasta 5 minutos, sin reiniciarlos."
          confirmLabel={pending.value ? 'Activar' : 'Desactivar'}
          loading={saving}
          onCancel={() => setPending(null)}
          onConfirm={save}
        />
      )}
      {children}
    </PageContainer>
  );
}
