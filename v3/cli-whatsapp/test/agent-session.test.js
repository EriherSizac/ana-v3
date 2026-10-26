import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSession, AUTH_MESSAGES } from '../agent-session.js';
import { CognitoError } from '../cognito-auth.js';

const quiet = { warn() {}, log() {}, error() {} };
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const idToken = (expSec, user = 'Erick') => jwt({ 'cognito:username': user, exp: expSec });

const memStore = (initial = null) => {
  let saved = initial;
  return {
    saves: [],
    cleared: 0,
    async save(s) {
      saved = s;
      this.saves.push(s);
      return true;
    },
    async load() {
      return saved;
    },
    clear() {
      saved = null;
      this.cleared++;
    },
  };
};

test('completeLogin: agent_id en minúsculas y refresh token persistido', async () => {
  const store = memStore();
  const s = createAgentSession({ cognito: {}, store, logger: quiet });
  await s.completeLogin({ idToken: idToken(2e9), accessToken: 'a', refreshToken: 'r1', expiresIn: 3600 });
  assert.equal(s.agentId, 'erick');
  assert.deepEqual(store.saves, [{ username: 'Erick', refreshToken: 'r1' }]);
  assert.equal(s.identity(), null); // falta campaña
  s.setCampaign(' Prueba ');
  assert.deepEqual(s.identity(), { agent_id: 'erick', campaign: 'prueba' });
});

test('renueva cuando faltan ≤ 5 min y no antes', async () => {
  let now = 1_000_000_000_000;
  let refreshes = 0;
  const cognito = { refresh: async () => (refreshes++, { idToken: idToken(Math.floor(now / 1000) + 3600), accessToken: 'a', refreshToken: null }) };
  const s = createAgentSession({ cognito, store: memStore(), now: () => now, logger: quiet });
  await s.completeLogin({ idToken: idToken(Math.floor(now / 1000) + 3600), accessToken: 'a', refreshToken: 'r' });
  const t1 = await s.getIdToken();
  assert.equal(refreshes, 0);
  now += 56 * 60 * 1000; // faltan 4 min
  const t2 = await s.getIdToken();
  assert.equal(refreshes, 1);
  assert.notEqual(t1, t2);
});

test('single-flight: dos llamadas simultáneas → una sola renovación', async () => {
  let refreshes = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const cognito = { refresh: async () => { refreshes++; await gate; return { idToken: idToken(2e9), accessToken: 'a', refreshToken: null }; } };
  const s = createAgentSession({ cognito, store: memStore(), logger: quiet });
  await s.completeLogin({ idToken: idToken(1), accessToken: 'a', refreshToken: 'r' }); // vencido
  const p = Promise.all([s.getIdToken(), s.getIdToken(), s.getIdToken({ force: true })]);
  release();
  const tokens = await p;
  assert.equal(refreshes, 1);
  assert.equal(new Set(tokens).size, 1);
});

test('refresh token nuevo reemplaza al guardado', async () => {
  const store = memStore();
  const cognito = { refresh: async () => ({ idToken: idToken(2e9), accessToken: 'a', refreshToken: 'r2' }) };
  const s = createAgentSession({ cognito, store, logger: quiet });
  await s.completeLogin({ idToken: idToken(1), accessToken: 'a', refreshToken: 'r1' });
  await s.getIdToken();
  assert.equal(store.saves.at(-1).refreshToken, 'r2');
});

test('resume: renueva la sesión guardada o la borra si fue revocada', async () => {
  const ok = createAgentSession({ cognito: { refresh: async () => ({ idToken: idToken(2e9, 'erick'), accessToken: 'a' }) }, store: memStore({ username: 'erick', refreshToken: 'r' }), logger: quiet });
  assert.deepEqual(await ok.resume(), { username: 'erick' });

  const store = memStore({ username: 'erick', refreshToken: 'r' });
  const revoked = createAgentSession({ cognito: { refresh: async () => { throw new CognitoError('NotAuthorizedException', 'Refresh Token has been revoked'); } }, store, logger: quiet });
  assert.equal(await revoked.resume(), null);
  assert.equal(store.cleared, 1);

  const netStore = memStore({ username: 'erick', refreshToken: 'r' });
  const offline = createAgentSession({ cognito: { refresh: async () => { throw new CognitoError('NetworkError'); } }, store: netStore, logger: quiet });
  assert.equal(await offline.resume(), null);
  assert.equal(netStore.cleared, 0);
});

test('renovación rechazada → aviso de sesión expirada', async () => {
  const cognito = { refresh: async () => { throw new CognitoError('NotAuthorizedException', 'revoked'); } };
  const s = createAgentSession({ cognito, store: memStore(), logger: quiet });
  await s.completeLogin({ idToken: idToken(1), accessToken: 'a', refreshToken: 'r' });
  assert.equal(await s.getIdToken(), null);
  assert.equal(s.authMessage(), AUTH_MESSAGES.expired);
});

test('estado del backend: 401 → expired, 403 → forbidden, 200 → ok', () => {
  const s = createAgentSession({ cognito: {}, logger: quiet });
  s.noteBackendStatus(403);
  assert.equal(s.authMessage(), 'Tu usuario no está habilitado en esta campaña');
  s.noteBackendStatus(401);
  assert.equal(s.authMessage(), 'Sesión expirada: cierra ANA y vuelve a iniciar sesión');
  s.noteBackendStatus(500);
  assert.equal(s.authStatus, 'expired');
  s.noteBackendStatus(404);
  assert.equal(s.authMessage(), null);
});

test('logout: revoca y borra; sin red borra igual', async () => {
  const store = memStore();
  let revoked = null;
  const s = createAgentSession({ cognito: { revoke: async (rt) => { revoked = rt; } }, store, logger: quiet });
  await s.completeLogin({ idToken: idToken(2e9), accessToken: 'a', refreshToken: 'r1' });
  await s.logout();
  assert.equal(revoked, 'r1');
  assert.equal(store.cleared, 1);
  assert.equal(s.isLoggedIn, false);

  const store2 = memStore({ username: 'erick', refreshToken: 'r9' });
  const offline = createAgentSession({ cognito: { revoke: async () => { throw new CognitoError('NetworkError'); } }, store: store2, logger: quiet });
  await offline.logout(); // sin sesión en memoria: usa la guardada
  assert.equal(store2.cleared, 1);
});
