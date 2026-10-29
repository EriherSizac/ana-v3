// File: Puente v3 → realtime: llave S3 del bucket de v3 → evento del catálogo y/o actualización forzada.
// Created: 2026-10-26
// Updated: 2026-10-29
// Author: Erick Hernández Silva

import { campaignKey, canonicalOperatorId } from './identity';
import type { ForceRequest, RealtimeEmit } from './realtime';

export type S3Change = 'created' | 'deleted';

export interface BridgeResult {
  /** La llave está bajo un prefijo del puente pero no sigue su patrón (`BridgeSkipped`). */
  skipped?: boolean;
  emit?: RealtimeEmit;
  force?: ForceRequest;
}

/** Prefijos que reenvía la regla de us-east-1 (spec v3/realtime-bridge). */
export const BRIDGE_PREFIXES = ['agents/', 'assignments/agents/', 'agent-publications/', 'review/', 'rosters/', 'uploads/'] as const;
export const CLI_SETTINGS_KEY = 'config/cli-settings.json';
/** Manifiesto del CLI v3: su creación = versión publicada (add-in-session-updates D8). */
export const CLI_RELEASE_KEY = 'versions/latest.json';
/** Feed del desktop (electron-builder, `path: updates`) en el bucket de updates. */
export const DESKTOP_RELEASE_KEY = 'updates/latest.yml';
export const DEFAULT_DESKTOP_UPDATES_BUCKET = 'ana-desktop-updates';

/** Llave de EventBridge → texto (decodifica escapes `%XX` si los trae). */
export function decodeS3Key(raw: string): string {
  if (!/%[0-9a-fA-F]{2}|\+/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

const seg = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const skipped: BridgeResult = { skipped: true };

/**
 * Traduce un cambio de objeto. null = la llave no le interesa al puente
 * (p. ej. `backups/` o un borrado donde solo cuenta la creación).
 */
export function translateS3(rawKey: string, change: S3Change): BridgeResult | null {
  const key = decodeS3Key(rawKey);

  if (key === CLI_RELEASE_KEY) {
    if (change !== 'created') return null;
    return { emit: { type: 'release.available', ref: { scope: 'cli', source: 'v3' } } };
  }

  if (key === CLI_SETTINGS_KEY) {
    if (change !== 'created') return null;
    return {
      emit: { type: 'settings.changed', ref: { scope: 'cli', source: 'v3' } },
      force: { reason: 'settings', target: { kind: 'client', client: 'cli' } },
    };
  }

  if (key.startsWith('assignments/agents/')) {
    const m = /^assignments\/agents\/([^/]+)\/([^/]+)-contacts-[^/]*\.csv$/.exec(key);
    const c = campaignKey(m?.[1]);
    const agent = canonicalOperatorId(m?.[2]);
    if (!m || !c || !agent) return skipped;
    return { emit: { type: 'assignment.pending', users: [agent], campaign: c, ref: { source: 'v3' } } };
  }

  if (key.startsWith('agents/')) {
    const m = /^agents\/([^/]+)\/([^/]+)-contacts-[^/]*\.csv$/.exec(key);
    const c = campaignKey(m?.[1]);
    const agent = canonicalOperatorId(m?.[2]);
    if (!m || !c || !agent) return skipped;
    if (change !== 'created') return null;
    return { emit: { type: 'assignment.published', users: [agent], campaign: c, ref: { source: 'v3' } } };
  }

  if (key.startsWith('agent-publications/')) {
    const m = /^agent-publications\/([^/]+)\/([^/]+)\/.+$/.exec(key);
    const c = campaignKey(m?.[1]);
    const agent = canonicalOperatorId(m?.[2]);
    if (!m || !c || !agent) return skipped;
    if (change !== 'created') return null;
    return { emit: { type: 'publications.changed', users: [agent], campaign: c, ref: { source: 'v3' } } };
  }

  if (key.startsWith('review/')) {
    const m = /^review\/([^/]+)\/.+$/.exec(key);
    const c = campaignKey(m?.[1]);
    if (!m || !c) return skipped;
    return { emit: { type: 'review.changed', campaign: c, ref: { source: 'v3' } } };
  }

  if (key.startsWith('uploads/')) {
    const m = /^uploads\/([^/]+)\/([^/]+)$/.exec(key);
    const c = campaignKey(m?.[1]);
    if (!m || !c) return skipped;
    const uploadId = seg(m[2]).replace(/\.json$/, '');
    return { emit: { type: 'uploads.changed', campaign: c, ref: { source: 'v3', ...(uploadId ? { uploadId } : {}) } } };
  }

  if (key.startsWith('rosters/')) {
    const m = /^rosters\/([^/]+)\.json$/.exec(key);
    const c = campaignKey(m?.[1]);
    if (!m || !c) return skipped;
    return {
      emit: { type: 'roster.changed', campaign: c, ref: { source: 'v3' } },
      // El evento de S3 no dice qué agentes cambiaron: toda la campaña (design D12).
      force: { reason: 'roster', target: { kind: 'campaign', campaign: c } },
    };
  }

  return null;
}

/**
 * Cambio de objeto del bucket de updates del desktop (regla del bus por
 * defecto de us-east-2): solo la creación de `updates/latest.yml` cuenta.
 */
export function translateDesktopRelease(rawKey: string, change: S3Change): BridgeResult | null {
  if (change !== 'created' || decodeS3Key(rawKey) !== DESKTOP_RELEASE_KEY) return null;
  return { emit: { type: 'release.available', ref: { scope: 'desktop', source: 'desktop-updates' } } };
}

/** `Object Created` / `Object Deleted` de EventBridge → cambio. */
export function changeOf(detailType: string | undefined): S3Change | null {
  if (detailType === 'Object Created') return 'created';
  if (detailType === 'Object Deleted') return 'deleted';
  return null;
}
