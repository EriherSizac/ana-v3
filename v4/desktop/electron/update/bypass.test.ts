import { describe, it, expect } from 'vitest';
import {
  BypassGuard,
  hashBypassPassword,
  parseBypassHash,
  verifyBypassPassword,
  MAX_ATTEMPTS,
  LOCK_MS,
  type AttemptState,
} from './bypass';

const SALT = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const HASH = hashBypassPassword('Maestra#2026', SALT);

const memStorage = (init: AttemptState | null = null) => {
  let s = init;
  return { load: () => s, save: (v: AttemptState) => (s = { ...v }), get: () => s };
};

describe('parseBypassHash', () => {
  it('acepta scrypt$sal$hash', () => {
    const p = parseBypassHash(HASH)!;
    expect(p.salt.equals(SALT)).toBe(true);
    expect(p.hash).toHaveLength(32);
  });
  it('rechaza vacío o malformado', () => {
    expect(parseBypassHash(undefined)).toBeNull();
    expect(parseBypassHash('')).toBeNull();
    expect(parseBypassHash('Maestra#2026')).toBeNull();
    expect(parseBypassHash('bcrypt$aa$bb')).toBeNull();
  });
  it('el hash no contiene la contraseña en claro', () => expect(HASH).not.toContain('Maestra'));
});

describe('verifyBypassPassword', () => {
  const p = parseBypassHash(HASH)!;
  it('correcta → true', () => expect(verifyBypassPassword('Maestra#2026', p)).toBe(true));
  it('incorrecta → false', () => {
    expect(verifyBypassPassword('maestra#2026', p)).toBe(false);
    expect(verifyBypassPassword('', p)).toBe(false);
  });
});

describe('BypassGuard', () => {
  it('sin hash configurado no ofrece bypass', () => {
    const g = new BypassGuard(undefined, memStorage());
    expect(g.status().available).toBe(false);
    expect(g.verify('Maestra#2026')).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('contraseña correcta → ok y reinicia intentos', () => {
    const st = memStorage({ failures: 3, lockedUntil: 0 });
    const g = new BypassGuard(HASH, st);
    expect(g.verify('Maestra#2026')).toEqual({ ok: true });
    expect(st.get()).toEqual({ failures: 0, lockedUntil: 0 });
  });

  it('5 fallos bloquean 15 min; luego se desbloquea', () => {
    let now = 1_000_000;
    const st = memStorage();
    const g = new BypassGuard(HASH, st, () => now);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(g.verify('mal')).toMatchObject({ ok: false, reason: 'invalid', attemptsLeft: MAX_ATTEMPTS - i });
    }
    expect(g.verify('mal')).toMatchObject({ ok: false, reason: 'locked', lockedUntil: now + LOCK_MS });
    // Bloqueado: ni la correcta entra.
    expect(g.verify('Maestra#2026')).toMatchObject({ ok: false, reason: 'locked' });
    now += LOCK_MS;
    expect(g.status()).toMatchObject({ locked: false, attemptsLeft: MAX_ATTEMPTS });
    expect(g.verify('Maestra#2026')).toEqual({ ok: true });
  });

  it('el bloqueo persiste entre instancias (reinicio de la app)', () => {
    const now = 5_000_000;
    const st = memStorage();
    const g1 = new BypassGuard(HASH, st, () => now);
    for (let i = 0; i < MAX_ATTEMPTS; i++) g1.verify('mal');
    const g2 = new BypassGuard(HASH, st, () => now + 60_000);
    expect(g2.status().locked).toBe(true);
  });
});
