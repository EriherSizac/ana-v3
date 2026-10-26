// File: Acceso de emergencia de Sistemas al gate de actualización (puro, sin Electron).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Si el chequeo de actualización falla (error distinto de 404), Sistemas puede
 * desbloquear la app SOLO en esa sesión con una contraseña maestra. La app no
 * guarda la contraseña: solo un hash scrypt con sal entregado al compilar
 * (`ANA_UPDATE_BYPASS_HASH="scrypt$<sal hex>$<hash hex>"`, ver
 * scripts/hash-bypass-password.mjs). Sin hash configurado no hay bypass.
 *
 * Intentos: máximo 5 fallidos; luego se bloquea 15 minutos. El estado de
 * intentos se persiste (storage inyectado) para que reiniciar la app no lo borre.
 */

// Parámetros scrypt fijos (deben coincidir con scripts/hash-bypass-password.mjs).
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60 * 1000;

const HASH_RE = /^scrypt\$([0-9a-f]{16,})\$([0-9a-f]{32,})$/i;

export interface ParsedHash {
  salt: Buffer;
  hash: Buffer;
}

/** `scrypt$<sal hex>$<hash hex>` → buffers; null si falta o es inválido. */
export function parseBypassHash(v: string | null | undefined): ParsedHash | null {
  const m = HASH_RE.exec((v ?? '').trim());
  if (!m) return null;
  return { salt: Buffer.from(m[1], 'hex'), hash: Buffer.from(m[2], 'hex') };
}

/** Genera el valor `scrypt$sal$hash` (mismo algoritmo que el script de Sistemas). */
export function hashBypassPassword(password: string, salt: Buffer): string {
  const dk = scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

/** Compara en tiempo constante la contraseña contra el hash. */
export function verifyBypassPassword(password: string, parsed: ParsedHash): boolean {
  const dk = scryptSync(password.normalize('NFKC'), parsed.salt, parsed.hash.length, SCRYPT_PARAMS);
  return dk.length === parsed.hash.length && timingSafeEqual(dk, parsed.hash);
}

export interface AttemptState {
  failures: number;
  lockedUntil: number; // epoch ms; 0 = sin bloqueo
}

export interface AttemptStorage {
  load(): AttemptState | null;
  save(s: AttemptState): void;
}

export interface BypassStatus {
  available: boolean;
  locked: boolean;
  lockedUntil: number;
  attemptsLeft: number;
}

export type BypassResult = { ok: true } | ({ ok: false; reason: 'unavailable' | 'locked' | 'invalid' } & BypassStatus);

export class BypassGuard {
  private parsed: ParsedHash | null;
  private state: AttemptState;

  constructor(
    hashValue: string | null | undefined,
    private storage: AttemptStorage,
    private now: () => number = Date.now,
  ) {
    this.parsed = parseBypassHash(hashValue);
    const s = storage.load();
    this.state = {
      failures: Number.isFinite(s?.failures) ? Math.max(0, s!.failures) : 0,
      lockedUntil: Number.isFinite(s?.lockedUntil) ? s!.lockedUntil : 0,
    };
  }

  private refreshLock() {
    if (this.state.lockedUntil && this.now() >= this.state.lockedUntil) {
      this.state = { failures: 0, lockedUntil: 0 };
      this.storage.save(this.state);
    }
  }

  status(): BypassStatus {
    this.refreshLock();
    const locked = this.state.lockedUntil > this.now();
    return {
      available: this.parsed !== null,
      locked,
      lockedUntil: locked ? this.state.lockedUntil : 0,
      attemptsLeft: locked ? 0 : Math.max(0, MAX_ATTEMPTS - this.state.failures),
    };
  }

  verify(password: string): BypassResult {
    if (!this.parsed) return { ok: false, reason: 'unavailable', ...this.status() };
    const st = this.status();
    if (st.locked) return { ok: false, reason: 'locked', ...st };

    if (typeof password === 'string' && password.length > 0 && password.length <= 256 &&
        verifyBypassPassword(password, this.parsed)) {
      this.state = { failures: 0, lockedUntil: 0 };
      this.storage.save(this.state);
      return { ok: true };
    }
    const failures = this.state.failures + 1;
    this.state = {
      failures,
      lockedUntil: failures >= MAX_ATTEMPTS ? this.now() + LOCK_MS : 0,
    };
    this.storage.save(this.state);
    const after = this.status();
    return { ok: false, reason: after.locked ? 'locked' : 'invalid', ...after };
  }
}
