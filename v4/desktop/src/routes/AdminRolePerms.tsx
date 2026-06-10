// File: lista de roles
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { getRoles, getRolePerms, setRolePerms, type RoleSummary } from '../lib/api';
import { ANA_PERMISSIONS, DEFAULT_PERMISSIONS } from '../lib/permissions';

const isDefault = (perm: string) => DEFAULT_PERMISSIONS.includes(perm);

// Pantalla admin: lista todos los roles (API de Roles) y edita sus permisos ana.
const CATALOG: { perm: string; label: string }[] = [
  { perm: ANA_PERMISSIONS.ADMIN_CONSOLE, label: 'Consola de administración' },
  { perm: ANA_PERMISSIONS.CONTACTS_UPLOAD, label: 'Subir contactos (CSV)' },
  { perm: ANA_PERMISSIONS.CONTACTS_DISTRIBUTE, label: 'Repartir contactos entre agentes' },
  { perm: ANA_PERMISSIONS.CHATS_VIEW, label: 'Ver conversaciones' },
  { perm: ANA_PERMISSIONS.CHATS_TEAM_VIEW, label: 'Ver conversaciones de agentes' },
  { perm: ANA_PERMISSIONS.CHATS_REPLY, label: 'Responder mensajes' },
  { perm: ANA_PERMISSIONS.CAMPAIGN_SEND, label: 'Enviar campañas' },
];

export function AdminRolePerms() {
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RoleSummary | null>(null);
  const [perms, setPerms] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void getRoles()
      .then(setRoles)
      .catch((e) => {
        setRoles([]);
        setRolesError(e?.message ?? String(e));
      });
  }, []);

  async function select(role: RoleSummary) {
    setSelected(role);
    setPerms(null);
    setStatus(null);
    try {
      const stored = await getRolePerms(role.role_id); // grants + denies (`-perm`)
      // Estado "checked" por permiso del catálogo:
      //  default → ON salvo deny (`-perm` presente); no-default → ON si está el grant.
      const checked = new Set<string>();
      for (const { perm } of CATALOG) {
        const on = isDefault(perm) ? !stored.includes(`-${perm}`) : stored.includes(perm);
        if (on) checked.add(perm);
      }
      setPerms(checked);
    } catch (e: any) {
      setPerms(new Set());
      setStatus(`Error cargando permisos: ${e?.message ?? e}`);
    }
  }

  function toggle(perm: string) {
    setPerms((s) => {
      const n = new Set(s);
      n.has(perm) ? n.delete(perm) : n.add(perm);
      return n;
    });
  }

  async function save() {
    if (!selected || !perms) return;
    setBusy(true);
    setStatus(null);
    try {
      // Construye grants/denies: default desactivado → `-perm`; no-default activo → `perm`.
      const out: string[] = [];
      for (const { perm } of CATALOG) {
        const on = perms.has(perm);
        if (isDefault(perm) && !on) out.push(`-${perm}`);
        else if (!isDefault(perm) && on) out.push(perm);
      }
      await setRolePerms(selected.role_id, out);
      setStatus('Permisos guardados.');
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  const filtered = (roles ?? []).filter(
    (r) =>
      r.role_name.toLowerCase().includes(query.toLowerCase()) ||
      r.campaign_name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold">Permisos por rol</h1>
      <p className="mt-1 text-sm text-text-light">
        Elige un rol y asigna los permisos de ana. La identidad y la jerarquía viven
        en la API de Roles.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[320px_1fr]">
        {/* lista de roles */}
        <div className="pernexium-card p-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar rol o campaña…"
            className="mb-3 w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
          />
          {rolesError && (
            <div className="mb-2 rounded-xl bg-error-10 px-3 py-2 text-xs text-error-70">
              {rolesError}
            </div>
          )}
          {/* Alto acotado al viewport (header+título ~15rem) → la lista scrollea
              internamente y todos los roles quedan alcanzables sin mover la página. */}
          <ul className="max-h-[calc(100vh-15rem)] min-h-40 space-y-1 overflow-y-auto">
            {roles === null
              ? Array.from({ length: 8 }).map((_, i) => (
                  <li key={i}>
                    <Skeleton className="h-9 w-full" />
                  </li>
                ))
              : filtered.map((r) => (
                  <li key={r.role_id}>
                    <button
                      onClick={() => select(r)}
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-neutral-30 ${
                        selected?.role_id === r.role_id ? 'bg-primary-light-90' : ''
                      }`}
                    >
                      <span className="font-semibold">{r.role_name}</span>
                      <span className="ml-2 text-xs text-text-light">
                        {r.campaign_name === '*' ? 'global' : r.campaign_name}
                      </span>
                    </button>
                  </li>
                ))}
            {roles && filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-text-light">Sin roles.</li>
            )}
          </ul>
        </div>

        {/* editor de permisos */}
        <div className="pernexium-card p-6">
          {!selected ? (
            <p className="text-sm text-text-light">Selecciona un rol para editar sus permisos.</p>
          ) : (
            <>
              <div className="mb-4">
                <h2 className="text-base font-semibold">{selected.role_name}</h2>
                <p className="font-mono text-xs text-text-light">{selected.role_id}</p>
              </div>

              {perms === null ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="space-y-2">
                  {CATALOG.map(({ perm, label }) => (
                    <label key={perm} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={perms.has(perm)}
                        onChange={() => toggle(perm)}
                      />
                      <span className="font-semibold text-text-muted">{label}</span>
                      {isDefault(perm) && (
                        <span className="rounded-full bg-primary-light-90 px-2 text-[10px] text-primary">
                          por defecto
                        </span>
                      )}
                      <span className="font-mono text-xs text-text-light">{perm}</span>
                    </label>
                  ))}
                </div>
              )}

              <Button onClick={save} disabled={busy || perms === null} className="mt-6">
                {busy ? 'Guardando…' : 'Guardar permisos'}
              </Button>

              {status && (
                <div className="mt-4 rounded-xl bg-primary-light-90 px-4 py-2 text-sm text-text-muted">
                  {status}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
