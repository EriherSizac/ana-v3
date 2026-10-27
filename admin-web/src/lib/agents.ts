// Tipos y reglas de la sección Agentes compartidos por BFF y UI.

export type Fleet = 'v3' | 'v4';
export const FLEETS: readonly Fleet[] = ['v3', 'v4'];

export type FleetStateKind = 'agent' | 'disabled' | 'not_agent' | 'unavailable';

export interface FleetOverrideView {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface FleetState {
  state: FleetStateKind;
  override?: FleetOverrideView | null;
  /** Motivo de "No es agente". */
  reason?: string;
  /** v4: última actividad (epoch ms). */
  lastSeen?: number | null;
  /** Integrante de la lista derivada como supervisor (add-supervisor-contact-access). */
  kind?: 'agent' | 'supervisor';
}

export interface UserRoleView {
  roleName: string;
  campaign: string;
}

export interface UserRow {
  username: string;
  name: string | null;
  email: string | null;
  enabled: boolean;
  status: string;
  /** null = API de Roles no disponible. */
  roles: UserRoleView[] | null;
  fleets?: Record<Fleet, FleetState>;
}

export interface FleetInfo {
  available: boolean;
  generatedAt: string | null;
  message?: string;
}

export interface InactiveOverride {
  username: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UsersResponse {
  users: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  rolesAvailable: boolean;
  campaign: string | null;
  fleets: Record<Fleet, FleetInfo> | null;
  inactiveOverrides: Record<Fleet, InactiveOverride[]> | null;
}

export const PAGE_SIZE = 50;
export const STALE_SYNC_MS = 30 * 60_000;

/** Estados del pool que pueden ser agentes (design D11). */
export const AGENT_POOL_STATUSES = ['CONFIRMED', 'FORCE_CHANGE_PASSWORD'];

export const NOT_AGENT_NO_ROLE = 'Sin rol con permiso de envío en la campaña';
export const NOT_AGENT_COGNITO = 'Deshabilitado en Cognito';

export const STATE_LABEL: Record<FleetStateKind, string> = {
  agent: 'Agente',
  disabled: 'Deshabilitado',
  not_agent: 'No es agente',
  unavailable: 'No disponible',
};

/** Filtros en pills: `<flota>:<estado>`. */
export const FILTER_OPTIONS = FLEETS.flatMap((f) =>
  (['agent', 'disabled', 'not_agent'] as const).map((s) => ({ value: `${f}:${s}`, label: `${f}: ${STATE_LABEL[s]}` })),
);

export const normalizeId = (s: string): string => s.trim().toLowerCase();

const fold = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function matchesSearch(u: Pick<UserRow, 'username' | 'name' | 'email'>, q: string): boolean {
  const query = fold(q).trim();
  if (!query) return true;
  return fold(u.username).includes(query) || fold(u.name).includes(query) || fold(u.email).includes(query);
}

export function matchesFilters(u: UserRow, filters: readonly string[]): boolean {
  if (filters.length === 0) return true;
  if (!u.fleets) return false;
  return filters.some((f) => {
    const [fleet, state] = f.split(':') as [Fleet, FleetStateKind];
    return u.fleets?.[fleet]?.state === state;
  });
}

const fmt = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Fecha legible en hora de Ciudad de México. */
export function formatDate(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : fmt.format(d);
}

export function isStale(generatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!generatedAt) return false;
  const t = Date.parse(generatedAt);
  return Number.isFinite(t) && now - t > STALE_SYNC_MS;
}
