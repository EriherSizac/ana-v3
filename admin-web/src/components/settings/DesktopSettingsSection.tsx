'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, ConfirmDialog, InlineMessage, Input, Label, Skeleton } from '@/components/ui';
import { formatDate } from '@/lib/agents';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';
import { Toggle } from './CliSettingsView';

export interface DesktopSetting {
  key: string;
  label: string;
  description: string;
  type: 'integer' | 'boolean';
  min?: number;
  max?: number;
  default: number | boolean;
  value: number | boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface DesktopSettingsData {
  version: number;
  settings: DesktopSetting[];
}

const show = (s: DesktopSetting, v: number | boolean) => (s.type === 'boolean' ? (v ? 'Activado' : 'Desactivado') : String(v));

/** ¿Texto válido para la llave entera? (entero dentro de límites) */
export function validInteger(s: DesktopSetting, text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  if ((s.min !== undefined && n < s.min) || (s.max !== undefined && n > s.max)) return null;
  return n;
}

/**
 * Sección "Desktop v4" de /configuracion (v4-add-desktop-remote-settings):
 * cada llave de v4 `GET /admin/desktop-settings` con su control, valor por
 * defecto y último cambio. Guardar envía solo esa llave con la versión leída.
 */
export function DesktopSettingsSection() {
  const [data, setData] = useState<DesktopSettingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ setting: DesktopSetting; value: number | boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await apiFetch<DesktopSettingsData>('/api/v4/desktop-settings'));
      setDrafts({});
    } catch (e) {
      if (isRedirecting(e)) return;
      setLoadError(e instanceof ApiError ? e.message : 'No se pudo cargar la configuración del desktop.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!pending || !data) return;
    setSaving(true);
    setSaveError(null);
    try {
      setData(
        await apiFetch<DesktopSettingsData>('/api/v4/desktop-settings', {
          method: 'PUT',
          json: { version: data.version, values: { [pending.setting.key]: pending.value } },
        }),
      );
      setDrafts((d) => {
        const n = { ...d };
        delete n[pending.setting.key];
        return n;
      });
    } catch (e) {
      if (isRedirecting(e)) return;
      setSaveError(
        e instanceof ApiError && e.status === 409
          ? 'La configuración cambió; recarga para ver el valor actual'
          : e instanceof ApiError
            ? e.message
            : 'No se pudo guardar la configuración.',
      );
      // El control conserva el valor anterior.
      setDrafts((d) => {
        const n = { ...d };
        delete n[pending.setting.key];
        return n;
      });
    } finally {
      setPending(null);
      setSaving(false);
    }
  };

  return (
    <section className="mt-10" aria-labelledby="desktop-settings-title">
      <h2 id="desktop-settings-title" className="text-xl font-bold">
        Desktop v4
      </h2>
      <p className="mb-4 mt-1 text-sm text-text-light">
        Configuración remota del desktop v4. Los cambios aplican a todos los desktops en hasta 5 minutos.
      </p>
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
          <div className="flex flex-col gap-3 p-6" data-testid="desktop-settings-skeleton">
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : (
          data?.settings.map((s) => {
            const draft = drafts[s.key];
            const parsed = s.type === 'integer' && draft !== undefined ? validInteger(s, draft) : null;
            const dirty = draft !== undefined && draft !== String(s.value);
            return (
              <div key={s.key} className="flex flex-col gap-3 p-6 sm:flex-row sm:items-start sm:justify-between" data-testid={`desktop-setting-${s.key}`}>
                <div>
                  <h3 className="text-base font-semibold">{s.label}</h3>
                  <p className="mt-1 text-sm text-text-muted">{s.description}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-light">
                    <Badge variant="muted">Actual: {show(s, s.value)}</Badge>
                    <span>Por defecto: {show(s, s.default)}</span>
                    <span>{s.updatedAt ? `Último cambio: ${s.updatedBy ?? '—'} · ${formatDate(s.updatedAt)}` : 'Sin cambios'}</span>
                  </p>
                </div>
                {s.type === 'boolean' ? (
                  <Toggle checked={s.value === true} label={s.label} onChange={() => setPending({ setting: s, value: !(s.value === true) })} />
                ) : (
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <Label htmlFor={`ds-${s.key}`} className="sr-only">
                      {s.label}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={`ds-${s.key}`}
                        inputMode="numeric"
                        className="w-28"
                        value={draft ?? String(s.value)}
                        invalid={draft !== undefined && parsed === null}
                        onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        disabled={!dirty || parsed === null}
                        onClick={() => parsed !== null && setPending({ setting: s, value: parsed })}
                      >
                        Guardar
                      </Button>
                    </div>
                    {draft !== undefined && parsed === null && (
                      <p className="text-xs text-error-70">
                        Permitido: {s.min} a {s.max}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {data && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => void load()}>
          Recargar
        </Button>
      )}
      {pending && (
        <ConfirmDialog
          open
          title={`Cambiar: ${pending.setting.label}`}
          description={`De ${show(pending.setting, pending.setting.value)} a ${show(pending.setting, pending.value)}. Aplica a todos los desktops v4 en hasta 5 minutos.`}
          confirmLabel="Guardar"
          loading={saving}
          onCancel={() => setPending(null)}
          onConfirm={save}
        />
      )}
    </section>
  );
}
