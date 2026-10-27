import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackendClient } from '../backend-client.js';
import { createAgentSession } from '../agent-session.js';

const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const capture = () => {
  const lines = [];
  const f = (...a) => lines.push(a.map(String).join(' '));
  return { lines, logger: { log: f, warn: f, error: f } };
};

async function setup(responses, { refreshToken = 'REFRESH' } = {}) {
  let n = 0;
  const cognito = { refresh: async () => ({ idToken: jwt({ 'cognito:username': 'erick', exp: 2e9, n: ++n }), accessToken: 'a' }) };
  const { lines, logger } = capture();
  const session = createAgentSession({ cognito, logger });
  await session.completeLogin({ idToken: jwt({ 'cognito:username': 'erick', exp: 2e9, n: 0 }), accessToken: 'a', refreshToken });
  session.setCampaign('prueba');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return typeof r === 'function' ? r(url, init) : new Response(r.body ?? '{}', { status: r.status });
  };
  const client = createBackendClient({ baseUrl: 'https://api.test/', session, cliVersion: '1.0.47', fetchImpl, logger });
  return { client, session, calls, lines };
}

test('agrega Authorization Bearer y X-Ana-Cli-Version', async () => {
  const { client, calls } = await setup([{ status: 200 }]);
  await client.fetch('/get/chats/erick/prueba');
  assert.equal(calls[0].url, 'https://api.test/get/chats/erick/prueba');
  assert.match(calls[0].init.headers.Authorization, /^Bearer h\./);
  assert.equal(calls[0].init.headers['X-Ana-Cli-Version'], '1.0.47');
});

test('401 → renovación forzada y un reintento con token nuevo', async () => {
  const { client, session, calls } = await setup([{ status: 401 }, { status: 200 }]);
  const res = await client.fetch('/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].init.headers.Authorization, calls[1].init.headers.Authorization);
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
  assert.equal(session.authMessage(), null);
});

test('401 persistente → sesión expirada; 403 → no habilitado', async () => {
  const a = await setup([{ status: 401 }, { status: 401 }]);
  await a.client.fetch('/get/chats/erick/prueba');
  assert.equal(a.calls.length, 2);
  assert.equal(a.session.authMessage(), 'Sesión expirada: cierra ANA y vuelve a iniciar sesión');

  const b = await setup([{ status: 403 }]);
  await b.client.fetch('/get/chats/erick/prueba');
  assert.equal(b.calls.length, 1);
  assert.equal(b.session.authMessage(), 'Tu usuario no está habilitado en esta campaña');
});

test('los logs solo llevan método, ruta y estado (sin token ni headers)', async () => {
  const { client, lines, calls } = await setup([{ status: 401 }, { status: 403 }]);
  await client.fetch('/backups/chat', { method: 'POST', body: JSON.stringify({ secret: 'cuerpo' }) });
  const all = lines.join('\n');
  for (const c of calls) {
    const token = c.init.headers.Authorization.slice('Bearer '.length);
    assert.ok(!all.includes(token));
  }
  assert.ok(!/Bearer|REFRESH|cuerpo/.test(all));
  assert.match(all, /POST \/backups\/chat → 403/);
});

test('error de red: se registra sin token y se propaga', async () => {
  const { client, lines } = await setup([() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }]);
  await assert.rejects(() => client.fetch('/media', { method: 'POST' }), TypeError);
  assert.match(lines.join('\n'), /POST \/media → error de red \(ENOTFOUND\)/);
  assert.ok(!lines.join('\n').includes('Bearer'));
});

test('fetchAgentCampaigns y recheckAuthorization', async () => {
  const { client, session } = await setup([{ status: 200, body: JSON.stringify({ username: 'erick', campaigns: ['prueba', 'ventas'] }) }]);
  assert.deepEqual(await client.fetchAgentCampaigns(), { username: 'erick', campaigns: ['prueba', 'ventas'] });
  session.noteBackendStatus(403);
  assert.equal(await client.recheckAuthorization(), null); // prueba sigue habilitada
  const off = await setup([{ status: 200, body: JSON.stringify({ username: 'erick', campaigns: ['ventas'] }) }]);
  off.session.noteBackendStatus(403);
  assert.equal(await off.client.recheckAuthorization(), 'Tu usuario no está habilitado en esta campaña');
  const ok = await setup([{ status: 500 }]);
  assert.equal(await ok.client.recheckAuthorization(), null);
  assert.equal(ok.calls.length, 0); // sin aviso no consulta
});

test('refreshAccess (actualización forzada): relee /agent/campaigns aun sin aviso y marca forbidden si ya no está la campaña', async () => {
  const { client, session, calls } = await setup([{ status: 200, body: JSON.stringify({ username: 'erick', campaigns: ['zendere'] }) }]);
  assert.equal(session.authStatus, 'ok');
  const msg = await client.refreshAccess();
  assert.equal(calls[0].url, 'https://api.test/agent/campaigns');
  assert.equal(session.authStatus, 'forbidden');
  assert.equal(msg, 'Tu usuario no está habilitado en esta campaña');
});

test('refreshAccess: campaña vigente → ok', async () => {
  const { client, session } = await setup([{ status: 200, body: JSON.stringify({ username: 'erick', campaigns: ['Prueba'] }) }]);
  session.noteBackendStatus(403);
  assert.equal(await client.refreshAccess(), null);
  assert.equal(session.authStatus, 'ok');
});
