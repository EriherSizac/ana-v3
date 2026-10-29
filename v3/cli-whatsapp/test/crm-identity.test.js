import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_INTERACTIONS_USER_ID as LEGACY,
  MAX_COMMENTS_LENGTH,
  agentLabel,
  applyIdentity,
  clearCrmIdentity,
  getCrmIdentity,
  sendWithAgentIdentity,
  setCrmIdentity,
  tagComments,
} from '../crm-identity.js';
import { insertInteractions } from '../agent-config.js';
import { createBackendClient } from '../backend-client.js';

const AGENT_ID = 'c8889644-1111-4222-8333-444455556666';
const ID = { username: 'miranda.rios', crmUserId: AGENT_ID, displayName: 'RIOS MIRANDA' };
const NO_ID = { username: 'miranda.rios', crmUserId: null, displayName: 'RIOS MIRANDA' };
const quiet = { log() {}, warn() {}, error() {} };
const base = (over = {}) => ({ credit_id: 'C1', user_id: LEGACY, phone_number: '5512345678', comments: 'hola', ...over });

// --- comments ---------------------------------------------------------------

test('tagComments: vacío → "Registrado vía ANA"; con contenido → " | vía ANA"', () => {
  assert.equal(tagComments(''), 'Registrado vía ANA');
  assert.equal(tagComments(null), 'Registrado vía ANA');
  assert.equal(tagComments('product=x'), 'product=x | vía ANA');
});

test('tagComments con agente (fallback)', () => {
  const agent = agentLabel(ID);
  assert.equal(agent, 'Agente: miranda.rios (RIOS MIRANDA)');
  assert.equal(tagComments('', { agent }), 'Registrado vía ANA · Agente: miranda.rios (RIOS MIRANDA)');
  assert.equal(tagComments('hola', { agent }), 'hola | vía ANA · Agente: miranda.rios (RIOS MIRANDA)');
  assert.equal(agentLabel({ username: 'Ana' }), 'Agente: ana');
});

test('tagComments no duplica la marca (reintento sobre comments ya marcados)', () => {
  const once = tagComments('hola', { agent: 'Agente: a' });
  assert.equal(tagComments(once, { agent: 'Agente: a' }), once);
  assert.equal(tagComments(tagComments('hola')), 'hola | vía ANA');
  assert.equal(tagComments(tagComments('')), 'Registrado vía ANA');
  // De marca simple a marca con agente sin acumular.
  assert.equal(tagComments(tagComments('hola'), { agent: 'Agente: a' }), 'hola | vía ANA · Agente: a');
});

test('tagComments trunca el comentario original, nunca la marca', () => {
  const agent = agentLabel(ID);
  const long = 'x'.repeat(MAX_COMMENTS_LENGTH * 2);
  const out = tagComments(long, { agent });
  assert.equal(Array.from(out).length, MAX_COMMENTS_LENGTH);
  assert.ok(out.endsWith(` | vía ANA · ${agent}`));
  assert.ok(out.includes('…'));
  // Corto: no se toca.
  assert.equal(tagComments('abc', { max: 50 }), 'abc | vía ANA');
  // Emojis (surrogate pairs) no se parten.
  const emo = tagComments('😀'.repeat(600));
  assert.equal(Array.from(emo).length, MAX_COMMENTS_LENGTH);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emo));
});

// --- user_id ----------------------------------------------------------------

test('applyIdentity: con crmUserId usa el id del agente y solo la marca de ANA', () => {
  const { interactions, mode } = applyIdentity([base()], ID);
  assert.equal(mode, 'agent');
  assert.equal(interactions[0].user_id, AGENT_ID);
  assert.equal(interactions[0].comments, 'hola | vía ANA');
});

test('applyIdentity: sin crmUserId → legado + sufijo del agente', () => {
  const { interactions, mode } = applyIdentity([base({ comments: '' })], NO_ID);
  assert.equal(mode, 'legacy_no_identity');
  assert.equal(interactions[0].user_id, LEGACY);
  assert.equal(interactions[0].comments, 'Registrado vía ANA · Agente: miranda.rios (RIOS MIRANDA)');
});

test('applyIdentity no muta la entrada', () => {
  const input = [base()];
  applyIdentity(input, ID);
  assert.equal(input[0].user_id, LEGACY);
  assert.equal(input[0].comments, 'hola');
});

test('getCrmIdentity ignora la identidad de otro username', () => {
  setCrmIdentity(ID);
  assert.equal(getCrmIdentity('miranda.rios').crmUserId, AGENT_ID);
  assert.equal(getCrmIdentity('otro').crmUserId, null);
  assert.equal(getCrmIdentity('otro').username, 'otro');
  clearCrmIdentity();
});

// --- fallback ---------------------------------------------------------------

test('sendWithAgentIdentity: éxito con el id del agente (un solo envío)', async () => {
  const sent = [];
  const r = await sendWithAgentIdentity([base()], ID, async (i) => (sent.push(i), { ok: true, status: 200 }), quiet);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].user_id, AGENT_ID);
  assert.equal(r.userIdPath, 'agent');
});

test('sendWithAgentIdentity: 4xx con el id del agente → un reintento con legado + sufijo', async () => {
  for (const status of [400, 404, 422]) {
    const sent = [];
    const answers = [{ ok: false, status }, { ok: true, status: 200 }];
    const r = await sendWithAgentIdentity([base()], ID, async (i) => (sent.push(i), answers.shift()), quiet);
    assert.equal(sent.length, 2);
    assert.equal(sent[1][0].user_id, LEGACY);
    assert.equal(sent[1][0].comments, 'hola | vía ANA · Agente: miranda.rios (RIOS MIRANDA)');
    assert.equal(r.ok, true);
    assert.equal(r.userIdPath, 'legacy_fallback');
  }
});

test('sendWithAgentIdentity: el reintento también falla → no hay un tercer envío', async () => {
  let n = 0;
  const r = await sendWithAgentIdentity([base()], ID, async () => (n++, { ok: false, status: 400 }), quiet);
  assert.equal(n, 2);
  assert.equal(r.ok, false);
});

test('sendWithAgentIdentity: 5xx o error de red no reintenta con legado', async () => {
  for (const res of [{ ok: false, status: 502 }, { ok: false, status: 0 }]) {
    let n = 0;
    await sendWithAgentIdentity([base()], ID, async () => (n++, res), quiet);
    assert.equal(n, 1);
  }
});

test('sendWithAgentIdentity: 4xx sin crmUserId (ya legado) no reintenta', async () => {
  let n = 0;
  const r = await sendWithAgentIdentity([base()], NO_ID, async () => (n++, { ok: false, status: 400 }), quiet);
  assert.equal(n, 1);
  assert.equal(r.userIdPath, 'legacy_no_identity');
});

// --- integración: insertInteractions (fetch simulado, nunca el CRM real) ----

let realFetch;
let calls;
beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  clearCrmIdentity();
});
const mockCrm = (statuses) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const status = statuses.length ? statuses.shift() : 200;
    return new Response(JSON.stringify({ status }), { status });
  };
};
const silence = async (fn) => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
};

test('insertInteractions: éxito con el id del agente', async () => {
  setCrmIdentity(ID);
  mockCrm([200]);
  const r = await silence(() => insertInteractions([base({ comments: '' })]));
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/interactions'));
  assert.equal(calls[0].body.interactions[0].user_id, AGENT_ID);
  assert.equal(calls[0].body.interactions[0].comments, 'Registrado vía ANA');
});

test('insertInteractions: 400 con el id del agente → reintento con legado + sufijo', async () => {
  setCrmIdentity(ID);
  mockCrm([400, 200]);
  const r = await silence(() => insertInteractions([base()]));
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.interactions[0].user_id, LEGACY);
  assert.equal(calls[1].body.interactions[0].comments, 'hola | vía ANA · Agente: miranda.rios (RIOS MIRANDA)');
});

test('insertInteractions: sin crmUserId → legado + sufijo del agente', async () => {
  setCrmIdentity(NO_ID);
  mockCrm([200]);
  await silence(() => insertInteractions([base()]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.interactions[0].user_id, LEGACY);
  assert.equal(calls[0].body.interactions[0].comments, 'hola | vía ANA · Agente: miranda.rios (RIOS MIRANDA)');
});

test('insertInteractions: sin identidad alguna → legado y solo la marca de ANA', async () => {
  mockCrm([200]);
  await silence(() => insertInteractions([base()]));
  assert.equal(calls[0].body.interactions[0].user_id, LEGACY);
  assert.equal(calls[0].body.interactions[0].comments, 'hola | vía ANA');
});

// --- backend-client: identidad desde /agent/campaigns -------------------------

test('fetchAgentCampaigns entrega crmUserId/displayName a onIdentity', async () => {
  const seen = [];
  const session = { getIdToken: async () => 't', noteBackendStatus() {}, authMessage: () => null };
  const body = { username: 'miranda.rios', campaigns: ['prueba'], crmUserId: AGENT_ID, displayName: 'RIOS MIRANDA' };
  const client = createBackendClient({
    baseUrl: 'https://v3.test.invalid',
    session,
    logger: quiet,
    fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
    onIdentity: (id) => seen.push(id),
  });
  assert.deepEqual(await client.fetchAgentCampaigns(), { username: 'miranda.rios', campaigns: ['prueba'] });
  assert.deepEqual(seen, [{ username: 'miranda.rios', crmUserId: AGENT_ID, displayName: 'RIOS MIRANDA' }]);
  const old = createBackendClient({
    baseUrl: 'https://v3.test.invalid',
    session,
    logger: quiet,
    fetchImpl: async () => new Response(JSON.stringify({ username: 'a', campaigns: [] }), { status: 200 }),
    onIdentity: (id) => seen.push(id),
  });
  await old.fetchAgentCampaigns();
  assert.deepEqual(seen[1], { username: 'a', crmUserId: null, displayName: null });
});
