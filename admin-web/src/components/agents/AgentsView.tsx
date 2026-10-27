'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  FilterPill,
  InlineMessage,
  Input,
  PageContainer,
  PageHeader,
  SearchableMultiselect,
  SearchableSelect,
  Skeleton,
  SkeletonRows,
  TableContainer,
} from '@/components/ui';
import { useCampaigns } from '@/components/system/useCampaigns';
import {
  FILTER_OPTIONS,
  FLEETS,
  STATE_LABEL,
  formatDate,
  isStale,
  type Fleet,
  type FleetState,
  type UserRow,
  type UsersResponse,
} from '@/lib/agents';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';
import { cn } from '@/lib/cn';

type Action = 'disable' | 'enable';

interface PendingAction {
  action: Action;
  fleets: Fleet[];
  usernames: string[];
  bulk: boolean;
}

interface FleetOutcome {
  fleet: Fleet;
  applied: number;
  failed: number;
  skipped: number;
  message?: string;
}

const FLEET_LABEL: Record<Fleet, string> = { v3: 'v3', v4: 'v4' };

/** ¿La acción aplica al estado de la flota? */
const eligible = (s: FleetState | undefined, action: Action) =>
  action === 'disable' ? s?.state === 'agent' : s?.state === 'disabled';

function StateBadge({ s, onRetry }: { s: FleetState | undefined; onRetry: () => void }) {
  if (!s) return <span className="text-xs text-text-light-muted">—</span>;
  if (s.state === 'unavailable') {
    return (
      <span className="flex items-center gap-2">
        <Badge variant="muted">No disponible</Badge>
        <button type="button" onClick={onRetry} className="text-xs font-semibold text-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary">
          Reintentar
        </button>
      </span>
    );
  }
  const variant = s.state === 'agent' ? 'success' : s.state === 'disabled' ? 'error' : 'muted';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1">
        <Badge variant={variant}>{STATE_LABEL[s.state]}</Badge>
        {s.kind === 'supervisor' && <Badge variant="secondary">Supervisor</Badge>}
      </span>
      {s.state === 'disabled' && s.override && (
        <span className="text-2xs text-text-light">
          {s.override.updatedBy ?? '—'} · {formatDate(s.override.updatedAt)}
        </span>
      )}
      {s.state === 'not_agent' && s.reason && <span className="text-2xs text-text-light">{s.reason}</span>}
    </div>
  );
}

export function AgentsView() {
  const { campaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns();
  const [campaign, setCampaign] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkFleets, setBulkFleets] = useState<Fleet[]>(['v3', 'v4']);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<FleetOutcome[] | null>(null);
  const [detail, setDetail] = useState<UserRow | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(
    async (refresh = false) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (campaign) params.set('campaign', campaign);
      params.set('page', String(page));
      for (const f of filters) params.append('filter', f);
      if (refresh) params.set('refresh', '1');
      try {
        const res = await apiFetch<UsersResponse>(`/api/users?${params.toString()}`);
        if (id === reqId.current) setData(res);
      } catch (e) {
        if (isRedirecting(e)) return;
        if (id === reqId.current) setError(e instanceof ApiError ? e.message : 'No se pudo cargar la lista de usuarios.');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [search, campaign, page, filters],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelected([]);
    setRowErrors({});
    setOutcome(null);
  }, [campaign]);

  const byUsername = useMemo(() => new Map((data?.users ?? []).map((u) => [u.username, u])), [data]);

  const staleMessages = useMemo(() => {
    if (!data?.fleets) return [];
    return FLEETS.filter((f) => data.fleets![f].available && isStale(data.fleets![f].generatedAt)).map(
      (f) => `Lista de agentes desactualizada desde ${formatDate(data.fleets![f].generatedAt)} (${FLEET_LABEL[f]})`,
    );
  }, [data]);

  const toggleSelected = (u: string) => setSelected((s) => (s.includes(u) ? s.filter((x) => x !== u) : [...s, u]));
  const selectableUsers = (data?.users ?? []).filter((u) => u.fleets && FLEETS.some((f) => u.fleets![f].state === 'agent' || u.fleets![f].state === 'disabled'));
  const allSelected = selectableUsers.length > 0 && selectableUsers.every((u) => selected.includes(u.username));

  const runAction = async (p: PendingAction) => {
    if (!campaign) return;
    setBusy(true);
    const outcomes: FleetOutcome[] = [];
    const errors: Record<string, string> = {};
    for (const fleet of p.fleets) {
      const targets = p.usernames.filter((u) => eligible(byUsername.get(u)?.fleets?.[fleet], p.action));
      const skipped = p.usernames.length - targets.length;
      if (targets.length === 0) {
        outcomes.push({ fleet, applied: 0, failed: 0, skipped });
        continue;
      }
      try {
        await apiFetch(`/api/campaigns/${encodeURIComponent(campaign)}/agents`, {
          method: 'POST',
          json: { fleet, agents: targets.map((username) => ({ username, enabled: p.action === 'enable' })) },
        });
        outcomes.push({ fleet, applied: targets.length, failed: 0, skipped });
      } catch (e) {
        if (isRedirecting(e)) return;
        const message = e instanceof ApiError ? e.message : 'Error inesperado';
        outcomes.push({ fleet, applied: 0, failed: targets.length, skipped, message });
        for (const u of targets) errors[u] = `${FLEET_LABEL[fleet]}: ${message}`;
      }
    }
    setBusy(false);
    setPending(null);
    setRowErrors(errors);
    // Individual: el error va inline en la fila; masivo: resumen por flota.
    setOutcome(p.bulk ? outcomes : null);
    if (p.bulk) setSelected([]);
    await load();
  };

  const confirmText = (p: PendingAction) => {
    const verb = p.action === 'disable' ? 'Deshabilitar' : 'Rehabilitar';
    const fleets = p.fleets.map((f) => FLEET_LABEL[f]).join(' y ');
    if (!p.bulk) return { title: `${verb} en ${fleets}`, description: `${verb} a ${p.usernames[0]} en ${campaign} (${fleets}).` };
    return {
      title: `${verb} ${p.usernames.length} agente(s)`,
      description: `${verb} ${p.usernames.length} agente(s) seleccionados en ${campaign}, flota ${fleets}. Los que no apliquen se omiten.`,
    };
  };

  return (
    <PageContainer>
      <PageHeader
        title="Agentes"
        description="Usuarios del pool de Pernexium, sus roles y su estado de agente por campaña. Los agentes salen de los roles; aquí solo se deshabilitan o rehabilitan."
        actions={
          <Button variant="outline" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Actualizar
          </Button>
        }
      />

      <div className="pernexium-card mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="lg:w-64">
            {campaignsLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <SearchableSelect
                label="Campaña"
                options={campaigns.map((c) => ({ value: c, label: c }))}
                value={campaign}
                onChange={(c) => {
                  setCampaign(c);
                  setPage(1);
                }}
                emptyLabel="Elige una campaña"
              />
            )}
          </div>
          <div className="min-w-[180px] flex-1">
            <label htmlFor="agents-search" className="mb-1 block text-xs font-semibold text-text-light">
              Buscar
            </label>
            <Input
              id="agents-search"
              placeholder="Usuario, nombre o correo…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="lg:w-56">
            <SearchableMultiselect
              label="Estado"
              options={FILTER_OPTIONS}
              selected={filters}
              onChange={(f) => {
                setFilters(f);
                setPage(1);
              }}
              disabled={!campaign}
            />
          </div>
          {(filters.length > 0 || searchInput) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFilters([]);
                setSearchInput('');
              }}
            >
              Limpiar filtros
            </Button>
          )}
        </div>
        {filters.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {filters.map((f) => (
              <FilterPill
                key={f}
                label={FILTER_OPTIONS.find((o) => o.value === f)?.label ?? f}
                onRemove={() => setFilters(filters.filter((x) => x !== f))}
              />
            ))}
          </div>
        )}
        {campaignsError && <InlineMessage className="mt-3">{campaignsError}</InlineMessage>}
      </div>

      {staleMessages.map((m) => (
        <InlineMessage key={m} className="mb-3">
          {m}
        </InlineMessage>
      ))}
      {data?.fleets &&
        FLEETS.filter((f) => data.fleets![f].available && !data.fleets![f].generatedAt).map((f) => (
          <InlineMessage key={`never-${f}`} className="mb-3">
            La lista de agentes de {campaign} aún no se ha sincronizado ({FLEET_LABEL[f]}).
          </InlineMessage>
        ))}
      {error && <InlineMessage className="mb-3">{error}</InlineMessage>}
      {outcome && (
        <div role="status" className="mb-3 rounded-xl bg-primary-light-90 px-4 py-2 text-sm text-primary" data-testid="bulk-outcome">
          {outcome
            .map((o) => `${FLEET_LABEL[o.fleet]}: ${o.applied} aplicados, ${o.failed} fallidos${o.skipped ? `, ${o.skipped} omitidos` : ''}${o.message ? ` (${o.message})` : ''}`)
            .join(' · ')}
        </div>
      )}

      {selected.length > 0 && campaign && (
        <div className="sticky top-20 z-20 mb-3 flex flex-col gap-3 rounded-2xl bg-primary px-5 py-3 text-primary-foreground shadow-card sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-semibold">{selected.length} seleccionados</span>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Flotas" className="flex gap-1">
              {([['v3'], ['v4'], ['v3', 'v4']] as Fleet[][]).map((fl) => {
                const active = fl.length === bulkFleets.length && fl.every((f) => bulkFleets.includes(f));
                return (
                  <button
                    key={fl.join('+')}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setBulkFleets(fl)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary',
                      active ? 'border-white bg-white text-primary' : 'border-white/50 text-primary-foreground hover:bg-white/15',
                    )}
                  >
                    {fl.length === 2 ? 'Ambas' : fl[0]}
                  </button>
                );
              })}
            </div>
            <Button variant="inverse" size="sm" onClick={() => setPending({ action: 'disable', fleets: bulkFleets, usernames: selected, bulk: true })}>
              Deshabilitar
            </Button>
            <Button variant="inverse" size="sm" onClick={() => setPending({ action: 'enable', fleets: bulkFleets, usernames: selected, bulk: true })}>
              Rehabilitar
            </Button>
            <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-white/15" onClick={() => setSelected([])}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="pernexium-card p-4">
        {loading && !data ? (
          <SkeletonRows rows={8} cols={5} />
        ) : (
          <>
            {data && !data.rolesAvailable && (
              <InlineMessage className="mb-3">Roles no disponibles: la API de Roles no respondió. Se muestran solo los usuarios.</InlineMessage>
            )}
            <TableContainer>
              <table className="w-full min-w-[900px] text-left text-sm" aria-busy={loading}>
                <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                  <tr>
                    {campaign && (
                      <th className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Seleccionar todos"
                          checked={allSelected}
                          onChange={() => setSelected(allSelected ? [] : selectableUsers.map((u) => u.username))}
                          className="h-4 w-4 rounded border-neutral-60 accent-primary"
                        />
                      </th>
                    )}
                    <th className="px-3 py-3">Usuario</th>
                    <th className="px-3 py-3">Cognito</th>
                    <th className="px-3 py-3">Roles y campañas</th>
                    {campaign && <th className="px-3 py-3">v3</th>}
                    {campaign && <th className="px-3 py-3">v4</th>}
                    {campaign && <th className="px-3 py-3">Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {(data?.users ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-text-light">
                        Sin usuarios que coincidan.
                      </td>
                    </tr>
                  )}
                  {(data?.users ?? []).map((u) => (
                    <tr key={u.username} className="border-t border-neutral-40 align-top" data-testid={`row-${u.username}`}>
                      {campaign && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ${u.username}`}
                            checked={selected.includes(u.username)}
                            disabled={!selectableUsers.includes(u)}
                            onChange={() => toggleSelected(u.username)}
                            className="h-4 w-4 rounded border-neutral-60 accent-primary"
                          />
                        </td>
                      )}
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setDetail(u)}
                          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                        >
                          <span className="block font-mono text-xs font-semibold text-primary">{u.username}</span>
                          {u.name && <span className="block text-sm text-text-muted">{u.name}</span>}
                          {u.email && <span className="block text-xs text-text-light">{u.email}</span>}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={u.enabled ? 'outline' : 'error'}>{u.enabled ? u.status : `Deshabilitado · ${u.status}`}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        {u.roles === null ? (
                          <span className="text-xs text-text-light">Roles no disponibles</span>
                        ) : u.roles.length === 0 ? (
                          <span className="text-xs text-text-light-muted">Sin roles</span>
                        ) : (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {u.roles.map((r, i) => (
                              <Badge key={`${r.roleName}-${r.campaign}-${i}`} variant="default">
                                {r.roleName} · {r.campaign}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      {campaign &&
                        FLEETS.map((f) => (
                          <td key={f} className="px-3 py-3" data-testid={`state-${f}-${u.username}`}>
                            <StateBadge s={u.fleets?.[f]} onRetry={() => void load()} />
                            {f === 'v4' && u.fleets?.v4.lastSeen ? (
                              <span className="mt-0.5 block text-2xs text-text-light">Actividad: {formatDate(u.fleets.v4.lastSeen)}</span>
                            ) : null}
                          </td>
                        ))}
                      {campaign && (
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            {FLEETS.map((f) => {
                              const s = u.fleets?.[f];
                              if (s?.state === 'agent')
                                return (
                                  <Button
                                    key={f}
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setPending({ action: 'disable', fleets: [f], usernames: [u.username], bulk: false })}
                                  >
                                    Deshabilitar en {f}
                                  </Button>
                                );
                              if (s?.state === 'disabled')
                                return (
                                  <Button
                                    key={f}
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setPending({ action: 'enable', fleets: [f], usernames: [u.username], bulk: false })}
                                  >
                                    Rehabilitar en {f}
                                  </Button>
                                );
                              return null;
                            })}
                            {rowErrors[u.username] && (
                              <span role="alert" className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
                                {rowErrors[u.username]}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableContainer>
            {data && data.total > data.pageSize && (
              <div className="mt-4 flex items-center justify-between text-sm text-text-light">
                <span>
                  Página {data.page} de {Math.ceil(data.total / data.pageSize)} · {data.total} usuarios
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
                    Anterior
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={data.page >= Math.ceil(data.total / data.pageSize)}
                    onClick={() => setPage(data.page + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {data?.inactiveOverrides && FLEETS.some((f) => data.inactiveOverrides![f].length > 0) && (
        <section className="pernexium-card mt-6 p-4" aria-labelledby="inactive-title">
          <h2 id="inactive-title" className="text-base font-semibold">
            Excepciones sin efecto
          </h2>
          <p className="mb-3 text-sm text-text-light">
            Excepciones de usuarios que ya no son agentes de {campaign} (perdieron el rol o están deshabilitados en Cognito). No dan acceso.
          </p>
          <TableContainer>
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                <tr>
                  <th className="px-3 py-2">Flota</th>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2">Excepción</th>
                  <th className="px-3 py-2">Autor</th>
                  <th className="px-3 py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {FLEETS.flatMap((f) =>
                  data.inactiveOverrides![f].map((o) => (
                    <tr key={`${f}-${o.username}`} className="border-t border-neutral-40">
                      <td className="px-3 py-2">{f}</td>
                      <td className="px-3 py-2 font-mono text-xs">{o.username}</td>
                      <td className="px-3 py-2">{o.enabled ? 'Habilitado' : 'Deshabilitado'}</td>
                      <td className="px-3 py-2">{o.updatedBy ?? '—'}</td>
                      <td className="px-3 py-2">{formatDate(o.updatedAt)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </TableContainer>
        </section>
      )}

      {pending && (
        <ConfirmDialog
          open
          {...confirmText(pending)}
          destructive={pending.action === 'disable'}
          confirmLabel={pending.action === 'disable' ? 'Deshabilitar' : 'Rehabilitar'}
          loading={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => runAction(pending)}
        />
      )}

      <UserDetail user={detail} campaign={campaign} onClose={() => setDetail(null)} />
    </PageContainer>
  );
}

interface DetailRole {
  roleName: string;
  campaign: string;
  permissions: string[];
}

/** Detalle de solo lectura: sin controles de directorio ni de roles. */
function UserDetail({ user, campaign, onClose }: { user: UserRow | null; campaign: string | null; onClose: () => void }) {
  const [roles, setRoles] = useState<DetailRole[] | null | undefined>(undefined);
  useEffect(() => {
    if (!user) return;
    setRoles(undefined);
    let cancelled = false;
    apiFetch<{ roles: DetailRole[] | null }>(`/api/users/${encodeURIComponent(user.username)}`)
      .then((r) => !cancelled && setRoles(r.roles))
      .catch(() => !cancelled && setRoles(null));
    return () => {
      cancelled = true;
    };
  }, [user]);
  if (!user) return null;
  return (
    <Dialog open title={user.username} description={[user.name, user.email].filter(Boolean).join(' · ') || undefined} onClose={onClose} size="lg">
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-light">Estado en Cognito</dt>
          <dd>{user.enabled ? user.status : `Deshabilitado (${user.status})`}</dd>
        </div>
        {campaign &&
          user.fleets &&
          FLEETS.map((f) => (
            <div key={f}>
              <dt className="text-xs text-text-light">
                {f} en {campaign}
              </dt>
              <dd>
                {STATE_LABEL[user.fleets![f].state]}
                {user.fleets![f].kind === 'supervisor' ? ' · Supervisor' : ''}
                {user.fleets![f].state === 'not_agent' && user.fleets![f].reason ? ` · ${user.fleets![f].reason}` : ''}
              </dd>
            </div>
          ))}
      </dl>
      <h3 className="mt-4 text-sm font-semibold">Roles (API de Roles)</h3>
      {roles === undefined ? (
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      ) : roles === null ? (
        <p className="mt-2 text-sm text-text-light">Roles no disponibles</p>
      ) : roles.length === 0 ? (
        <p className="mt-2 text-sm text-text-light">Sin roles</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {roles.map((r, i) => (
            <li key={`${r.roleName}-${i}`} className="rounded-xl bg-neutral-30 px-3 py-2">
              <span className="font-semibold text-text">{r.roleName}</span> <span className="text-xs text-text-light">· {r.campaign}</span>
              {r.permissions.length > 0 && <span className="mt-1 block font-mono text-2xs text-text-light">{r.permissions.join(', ')}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-text-light">Los usuarios, contraseñas y roles se administran fuera de ANA.</p>
    </Dialog>
  );
}
