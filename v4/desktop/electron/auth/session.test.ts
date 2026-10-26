import { describe, it, expect } from 'vitest';
import { decideSetToken, shouldHeartbeat, usernameFromJwt } from './session';

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: Record<string, unknown>) => `${b64u({ alg: 'none' })}.${b64u(claims)}.sig`;

describe('decideSetToken', () => {
  const tA = jwt({ 'cognito:username': 'ana.a' });
  it('mismo operador con sesión activa → solo reemplaza el token (no reinicia)', () => {
    expect(decideSetToken({ token: tA, activeOperator: 'ana.a', lastOperator: 'ana.a' })).toEqual({
      kind: 'refresh',
      operator: 'ana.a',
    });
  });
  it('otro operador → flujo de cambio de usuario (borra WhatsApp local)', () => {
    expect(decideSetToken({ token: tA, activeOperator: 'otro', lastOperator: 'otro' })).toEqual({
      kind: 'login',
      operator: 'ana.a',
      wipeLocal: true,
    });
  });
  it('mismo operador tras expirar → login sin borrar WhatsApp local', () => {
    expect(decideSetToken({ token: tA, activeOperator: null, lastOperator: 'ana.a' })).toEqual({
      kind: 'login',
      operator: 'ana.a',
      wipeLocal: false,
    });
  });
  it('primer login en la máquina', () => {
    expect(decideSetToken({ token: tA, activeOperator: null, lastOperator: null })).toMatchObject({
      kind: 'login',
      wipeLocal: false,
    });
  });
  it('null con reason expired → expired; null sin razón → logout', () => {
    expect(
      decideSetToken({ token: null, reason: 'expired', activeOperator: 'a', lastOperator: 'a' }).kind,
    ).toBe('expired');
    expect(decideSetToken({ token: null, activeOperator: 'a', lastOperator: 'a' }).kind).toBe('logout');
  });
});

describe('usernameFromJwt', () => {
  it('usa cognito:username, cae a sub y luego a ana', () => {
    expect(usernameFromJwt(jwt({ 'cognito:username': 'u1', sub: 's' }))).toBe('u1');
    expect(usernameFromJwt(jwt({ sub: 'x-1' }))).toBe('x-1');
    expect(usernameFromJwt('no-jwt')).toBe('ana');
  });

  it('canónico: Ana.Lopez → ana.lopez', () => {
    expect(usernameFromJwt(jwt({ 'cognito:username': ' Ana.Lopez ' }))).toBe('ana.lopez');
  });
});

describe('decideSetToken con grafías distintas (v4-canonical-identity-keys)', () => {
  it('Ana.Lopez vs ana.lopez → mismo operador (no borra WhatsApp local)', () => {
    const t = jwt({ 'cognito:username': 'Ana.Lopez' });
    expect(decideSetToken({ token: t, activeOperator: null, lastOperator: 'ana.lopez' })).toEqual({
      kind: 'login',
      operator: 'ana.lopez',
      wipeLocal: false,
    });
    const t2 = jwt({ 'cognito:username': 'ana.lopez' });
    expect(decideSetToken({ token: t2, activeOperator: null, lastOperator: 'Ana.Lopez' }).kind).toBe('login');
    expect((decideSetToken({ token: t2, activeOperator: null, lastOperator: 'Ana.Lopez' }) as any).wipeLocal).toBe(false);
    expect(decideSetToken({ token: t2, activeOperator: 'Ana.Lopez', lastOperator: 'Ana.Lopez' }).kind).toBe('refresh');
  });
});

describe('shouldHeartbeat', () => {
  it('solo con campaña y WhatsApp connected', () => {
    expect(shouldHeartbeat({ status: 'connected' }, 'bancoppel')).toBe(true);
    expect(shouldHeartbeat({ status: 'qr' }, 'bancoppel')).toBe(false);
    expect(shouldHeartbeat({ status: 'authenticated' }, 'bancoppel')).toBe(false);
    expect(shouldHeartbeat({ status: 'connected' }, null)).toBe(false);
  });
});
