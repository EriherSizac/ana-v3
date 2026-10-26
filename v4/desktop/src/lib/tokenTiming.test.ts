import { describe, it, expect } from 'vitest';
import { renewDelayMs, jwtExpMs, RENEW_BEFORE_MS } from './tokenTiming';

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: Record<string, unknown>) => `${b64u({ alg: 'none' })}.${b64u(claims)}.sig`;
const NOW = 1_800_000_000_000;

describe('renewDelayMs', () => {
  it('programa la renovación 5 min antes de exp', () => {
    const t = jwt({ exp: (NOW + 60 * 60_000) / 1000 });
    expect(renewDelayMs(t, NOW)).toBe(60 * 60_000 - RENEW_BEFORE_MS);
  });
  it('si faltan menos de 5 min renueva ya (0)', () => {
    expect(renewDelayMs(jwt({ exp: (NOW + 60_000) / 1000 }), NOW)).toBe(0);
    expect(renewDelayMs(jwt({ exp: (NOW - 60_000) / 1000 }), NOW)).toBe(0);
  });
  it('sin exp → null', () => {
    expect(renewDelayMs(jwt({ sub: 'x' }), NOW)).toBeNull();
    expect(renewDelayMs('basura', NOW)).toBeNull();
  });
  it('lee exp con base64url sin padding', () => {
    expect(jwtExpMs(jwt({ exp: 1234567890, 'cognito:username': 'ñandú~?' }))).toBe(1234567890_000);
  });
});
