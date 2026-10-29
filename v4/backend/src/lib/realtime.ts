// File: Canal realtime (add-realtime-gateway): temas, sobre de eventos, publicación al bus y métricas.
// Created: 2026-10-26
// Updated: 2026-10-29
// Author: Erick Hernández Silva

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { campaignKey, canonicalOperatorId } from './identity';

/** Tipos de cliente aceptados en `$connect` (`?client=`). */
export const CLIENT_TYPES = ['desktop', 'cli', 'admin'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];
export const isClientType = (v: unknown): v is ClientType => CLIENT_TYPES.includes(v as ClientType);

/** Catálogo v1 (design D6): a quién va cada tipo. */
export const USER_EVENTS = ['jobs.changed', 'assignment.pending', 'assignment.published', 'publications.changed', 'results.changed'] as const;
export const CAMPAIGN_EVENTS = ['uploads.changed', 'review.changed', 'roster.changed'] as const;
export const SETTINGS_EVENT = 'settings.changed' as const;
/** Versión publicada del CLI o del desktop (add-in-session-updates D8): a todas las conexiones del tipo. */
export const RELEASE_EVENT = 'release.available' as const;
/** Mensaje de control de la actualización forzada (design D12). */
export const REFRESH_EVENT = 'session.refresh' as const;

export type UserEventType = (typeof USER_EVENTS)[number];
export type CampaignEventType = (typeof CAMPAIGN_EVENTS)[number];
export type EventType = UserEventType | CampaignEventType | typeof SETTINGS_EVENT | typeof RELEASE_EVENT | typeof REFRESH_EVENT;
export const EVENT_TYPES: readonly EventType[] = [...USER_EVENTS, ...CAMPAIGN_EVENTS, SETTINGS_EVENT, RELEASE_EVENT, REFRESH_EVENT];

/** Llaves permitidas en `ref`: solo ids opacos, nunca datos de contacto. */
export const REF_KEYS = ['uploadId', 'srcKey', 'scope', 'source', 'reason'] as const;
export type RefKey = (typeof REF_KEYS)[number];
export type EventRef = Partial<Record<RefKey, string>>;

export const MAX_ENVELOPE_BYTES = 1024;
const MAX_REF_VALUE = 300;

export type RefreshReason = 'permissions' | 'roster' | 'settings' | 'manual';
export const REFRESH_REASONS: readonly RefreshReason[] = ['permissions', 'roster', 'settings', 'manual'];

/** Sobre que recibe el cliente (design D6). */
export interface Envelope {
  v: 1;
  type: EventType;
  id: string;
  at: number;
  campaign?: string;
  ref?: EventRef;
}

/** Evento que publica un productor; `users` decide destinatarios y no viaja al cliente. */
export interface RealtimeEmit {
  type: Exclude<EventType, typeof REFRESH_EVENT>;
  users?: string[];
  campaign?: string;
  ref?: EventRef;
}

/** Destino de una actualización forzada (design D12). */
export type ForceTarget =
  | { kind: 'user'; users: string[] }
  | { kind: 'campaign'; campaign: string }
  | { kind: 'role'; roleId: string }
  | { kind: 'client'; client: ClientType }
  | { kind: 'all' };

export interface ForceRequest {
  reason: RefreshReason;
  target: ForceTarget;
  by?: string;
}

// ---------- Temas (design D4) ----------

export const topicUser = (u: string) => `u#${canonicalOperatorId(u)}`;
export const topicClient = (c: ClientType) => `k#${c}`;
export const topicCampaign = (c: string) => `c#${c === '*' ? '*' : campaignKey(c)}`;
export const topicMember = (c: string) => `m#${c === '*' ? '*' : campaignKey(c)}`;
export const topicRole = (roleId: string) => `r#${roleId}`;
export const TOPIC_ROLE_UNKNOWN = 'r#unknown';

/** Mínimo de acceso que usa el registro de conexiones. */
export interface ConnectionAccess {
  campaigns: string[];
  roleIds: string[];
}

/**
 * Temas de una conexión: usuario + tipo; `admin` además `c#` por campaña; todos
 * `m#` por campaña y `r#` por rol para la actualización forzada. Sin acceso
 * (`null`) → `r#unknown`.
 */
export function connectionTopics(username: string, client: ClientType, access: ConnectionAccess | null): string[] {
  const topics = new Set<string>([topicUser(username), topicClient(client)]);
  if (!access) {
    topics.add(TOPIC_ROLE_UNKNOWN);
    return [...topics];
  }
  for (const c of access.campaigns) {
    if (!campaignKey(c)) continue;
    if (client === 'admin') topics.add(topicCampaign(c));
    topics.add(topicMember(c));
  }
  for (const r of access.roleIds) if (r) topics.add(topicRole(r));
  return [...topics];
}

/** Temas destino de un evento del catálogo. */
export function eventTopics(evt: RealtimeEmit): string[] {
  if ((USER_EVENTS as readonly string[]).includes(evt.type)) return [...new Set((evt.users ?? []).map(topicUser))];
  if ((CAMPAIGN_EVENTS as readonly string[]).includes(evt.type)) return [topicCampaign(evt.campaign ?? ''), topicCampaign('*')];
  if (evt.type === SETTINGS_EVENT) {
    const scope = evt.ref?.scope;
    return scope === 'cli' || scope === 'desktop' ? [topicClient(scope), topicClient('admin')] : [];
  }
  if (evt.type === RELEASE_EVENT) {
    // Solo el tipo de cliente publicado (no admins): cada uno lee su manifiesto.
    const scope = evt.ref?.scope;
    return scope === 'cli' || scope === 'desktop' ? [topicClient(scope)] : [];
  }
  return [];
}

/** Temas destino de una actualización forzada (design D12). */
export function forceTopics(t: ForceTarget): string[] {
  switch (t.kind) {
    case 'user':
      return [...new Set(t.users.map(topicUser))];
    case 'campaign':
      // Sin m#*: un usuario con todas las campañas no es "de" esa campaña.
      return [topicMember(t.campaign)];
    case 'role':
      return [topicRole(t.roleId), TOPIC_ROLE_UNKNOWN];
    case 'client':
      return [topicClient(t.client)];
    case 'all':
      return CLIENT_TYPES.map(topicClient);
  }
}

// ---------- Validación ----------

/** null si el evento es válido; si no, el motivo. */
export function validateEmit(evt: RealtimeEmit): string | null {
  if (!evt || !EVENT_TYPES.includes(evt.type) || evt.type === (REFRESH_EVENT as string)) return 'unknown_type';
  if ((USER_EVENTS as readonly string[]).includes(evt.type)) {
    const users = (evt.users ?? []).map(canonicalOperatorId).filter(Boolean);
    if (users.length === 0) return 'missing_users';
  }
  if ((CAMPAIGN_EVENTS as readonly string[]).includes(evt.type) && !campaignKey(evt.campaign)) return 'missing_campaign';
  if ((evt.type === SETTINGS_EVENT || evt.type === RELEASE_EVENT) && evt.ref?.scope !== 'cli' && evt.ref?.scope !== 'desktop')
    return 'invalid_scope';
  if (evt.ref !== undefined) {
    if (typeof evt.ref !== 'object' || evt.ref === null) return 'invalid_ref';
    for (const [k, v] of Object.entries(evt.ref)) {
      if (!(REF_KEYS as readonly string[]).includes(k)) return 'invalid_ref';
      if (typeof v !== 'string' || v.length > MAX_REF_VALUE) return 'invalid_ref';
    }
  }
  const probe = buildEnvelope(evt.type, { id: '00000000-0000-0000-0000-000000000000', at: Date.now(), campaign: evt.campaign, ref: evt.ref });
  if (Buffer.byteLength(JSON.stringify(probe)) > MAX_ENVELOPE_BYTES) return 'too_large';
  return null;
}

/** Sobre para el cliente: solo campos del contrato (nunca `users`). */
export function buildEnvelope(
  type: EventType,
  o: { id: string; at: number; campaign?: string; ref?: EventRef },
): Envelope {
  const env: Envelope = { v: 1, type, id: o.id, at: o.at };
  const c = campaignKey(o.campaign);
  if (c) env.campaign = c;
  if (o.ref && Object.keys(o.ref).length > 0) {
    const ref: EventRef = {};
    for (const k of REF_KEYS) if (typeof o.ref[k] === 'string') ref[k] = o.ref[k];
    env.ref = ref;
  }
  return env;
}

// ---------- Métricas (EMF) ----------

export const METRIC_NAMESPACE = 'AnaRealtime';

/** Métrica EMF (CloudWatch la extrae del log). Dimensión `Stage` siempre. */
export function metric(name: string, value = 1, dims: Record<string, string> = {}): void {
  const dimensions = { Stage: process.env.STAGE ?? 'dev', ...dims };
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          { Namespace: METRIC_NAMESPACE, Dimensions: [Object.keys(dimensions)], Metrics: [{ Name: name, Unit: 'Count' }] },
        ],
      },
      ...dimensions,
      [name]: value,
    }),
  );
}

export const realtimeEnabled = (): boolean => (process.env.REALTIME_ENABLED ?? 'true') !== 'false';

// ---------- Publicación al bus (design D5) ----------

export const EMIT_TIMEOUT_MS = 1000;
export const EVENT_SOURCE = 'ana.v4';
export const DETAIL_EVENT = 'ana.realtime.event';
export const DETAIL_FORCE = 'ana.realtime.force';

let eb: EventBridgeClient | null = null;
const client = () => (eb ??= new EventBridgeClient({}));

/** Solo pruebas: reemplaza el cliente de EventBridge. */
export function setEventBridgeClientForTests(c: EventBridgeClient | null): void {
  eb = c;
}

async function put(detailType: string, details: unknown[]): Promise<boolean> {
  const bus = process.env.REALTIME_BUS;
  // Sin bus configurado (local/pruebas) no se publica nada.
  if (!bus || details.length === 0) return false;
  try {
    for (let i = 0; i < details.length; i += 10) {
      const res = await client().send(
        new PutEventsCommand({
          Entries: details.slice(i, i + 10).map((d) => ({
            EventBusName: bus,
            Source: EVENT_SOURCE,
            DetailType: detailType,
            Detail: JSON.stringify(d),
          })),
        }),
        { abortSignal: AbortSignal.timeout(EMIT_TIMEOUT_MS) },
      );
      if ((res.FailedEntryCount ?? 0) > 0) throw Object.assign(new Error('failed entries'), { name: 'FailedEntries' });
    }
    return true;
  } catch (e) {
    console.error(JSON.stringify({ evt: 'realtime_emit_failed', detailType, error: (e as Error)?.name ?? 'error' }));
    metric('EmitFailed');
    return false;
  }
}

/**
 * Publica eventos del catálogo sin lanzar nunca (design D5): un fallo se
 * registra y cuenta `EmitFailed`; la operación que lo origina no cambia.
 */
export async function emitRealtime(events: RealtimeEmit | RealtimeEmit[]): Promise<boolean> {
  const list = Array.isArray(events) ? events : [events];
  const valid: RealtimeEmit[] = [];
  for (const e of list) {
    const err = validateEmit(e);
    if (err) {
      console.error(JSON.stringify({ evt: 'realtime_emit_invalid', type: (e as RealtimeEmit)?.type ?? null, error: err }));
      metric('EmitFailed');
      continue;
    }
    valid.push({
      type: e.type,
      ...(e.users ? { users: [...new Set(e.users.map(canonicalOperatorId).filter(Boolean))] } : {}),
      ...(e.campaign ? { campaign: campaignKey(e.campaign) } : {}),
      ...(e.ref ? { ref: e.ref } : {}),
    });
  }
  return put(DETAIL_EVENT, valid);
}

/** null si la petición es válida; si no, el motivo. */
export function validateForce(f: ForceRequest): string | null {
  if (!f || !REFRESH_REASONS.includes(f.reason)) return 'invalid_reason';
  const t = f.target;
  if (!t) return 'invalid_target';
  switch (t.kind) {
    case 'user':
      return Array.isArray(t.users) && t.users.map(canonicalOperatorId).filter(Boolean).length > 0 ? null : 'missing_users';
    case 'campaign':
      return campaignKey(t.campaign) && t.campaign.trim() !== '*' ? null : 'missing_campaign';
    case 'role':
      return typeof t.roleId === 'string' && t.roleId.trim() ? null : 'missing_role';
    case 'client':
      return isClientType(t.client) ? null : 'invalid_client';
    case 'all':
      return null;
    default:
      return 'invalid_target';
  }
}

/** Pide una actualización forzada (design D12). Nunca lanza. */
export async function forceRefresh(f: ForceRequest): Promise<boolean> {
  const err = validateForce(f);
  if (err) {
    console.error(JSON.stringify({ evt: 'realtime_force_invalid', error: err }));
    metric('EmitFailed');
    return false;
  }
  const target: ForceTarget =
    f.target.kind === 'user'
      ? { kind: 'user', users: [...new Set(f.target.users.map(canonicalOperatorId).filter(Boolean))] }
      : f.target.kind === 'campaign'
        ? { kind: 'campaign', campaign: campaignKey(f.target.campaign) }
        : f.target;
  return put(DETAIL_FORCE, [{ reason: f.reason, target, ...(f.by ? { by: f.by } : {}) }]);
}
