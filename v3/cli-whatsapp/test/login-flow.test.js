import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginFlow, MSG } from '../login-flow.js';
import { CognitoError } from '../cognito-auth.js';
import { loginOverlayScript } from '../login-overlay.js';

const quiet = { warn() {}, log() {}, error() {} };
const TOKENS = { idToken: 'id', accessToken: 'a', refreshToken: 'r', expiresIn: 3600 };

function fakeSession({ resumeUser = null } = {}) {
  return {
    agentId: resumeUser,
    campaign: null,
    logouts: 0,
    logins: [],
    async resume() {
      return resumeUser ? { username: resumeUser } : null;
    },
    async completeLogin(t) {
      this.logins.push(t);
      this.agentId = 'erick';
    },
    setCampaign(c) {
      this.campaign = c;
    },
    async logout() {
      this.logouts++;
      this.agentId = null;
    },
  };
}

const flowWith = ({ cognito = {}, session = fakeSession(), campaigns = ['prueba', 'ventas'], savedConfig = null } = {}) =>
  createLoginFlow({
    cognito,
    session,
    listCampaigns: async () => {
      if (campaigns instanceof Error) throw campaigns;
      return { campaigns };
    },
    savedConfig,
    qrDataUrl: async (uri) => `data:image/png;base64,QR(${uri.length})`,
    logger: quiet,
  });

test('sin sesión: formulario con usuario guardado', async () => {
  const f = flowWith({ savedConfig: { agent_id: 'erick', campaign: 'ventas' } });
  assert.deepEqual(await f.start(), { step: 'login', username: 'erick' });
});

test('campos incompletos no llaman a Cognito', async () => {
  const f = flowWith({ cognito: { startLogin: async () => assert.fail('no') } });
  await f.start();
  assert.equal((await f.submit('login', { username: 'erick', password: '' })).error, MSG.incomplete);
});

test('login simple → campaña con la guardada preseleccionada → done', async () => {
  const session = fakeSession();
  let sentUser;
  const f = flowWith({ session, savedConfig: { campaign: 'ventas' }, cognito: { startLogin: async (u) => ((sentUser = u), { kind: 'tokens', tokens: TOKENS }) } });
  await f.start();
  const v = await f.submit('login', { username: ' Erick.H ', password: 'x' });
  assert.equal(sentUser, 'Erick.H'); // sin forzar minúsculas
  assert.deepEqual(v, { step: 'campaign', username: 'erick', campaigns: ['prueba', 'ventas'], selected: 'ventas' });
  assert.equal((await f.submit('campaign', { campaign: 'otra' })).error, MSG.chooseCampaign);
  const done = await f.submit('campaign', { campaign: 'ventas' });
  assert.equal(done.step, 'done');
  assert.deepEqual(f.result, { agent_id: 'erick', campaign: 'ventas' });
  assert.equal(session.campaign, 'ventas');
});

test('campaña guardada ya no habilitada: sin preselección; una sola campaña: preseleccionada', async () => {
  const cognito = { startLogin: async () => ({ kind: 'tokens', tokens: TOKENS }) };
  const a = flowWith({ cognito, savedConfig: { campaign: 'vieja' } });
  await a.start();
  assert.equal((await a.submit('login', { username: 'e', password: 'x' })).selected, '');
  const b = flowWith({ cognito, campaigns: ['prueba'] });
  await b.start();
  assert.equal((await b.submit('login', { username: 'e', password: 'x' })).selected, 'prueba');
});

test('sin campañas: aviso y no continúa', async () => {
  const f = flowWith({ cognito: { startLogin: async () => ({ kind: 'tokens', tokens: TOKENS }) }, campaigns: [] });
  await f.start();
  const v = await f.submit('login', { username: 'e', password: 'x' });
  assert.deepEqual(v, { step: 'no_campaigns', username: 'erick', error: 'Tu usuario no está habilitado en ninguna campaña. Contacta a tu supervisor.' });
  assert.equal((await f.submit('campaign', { campaign: 'prueba' })).step, 'no_campaigns');
  assert.equal(f.result, null);
});

test('credenciales inválidas → mensaje y permanece en login', async () => {
  const f = flowWith({ cognito: { startLogin: async () => { throw new CognitoError('NotAuthorizedException', 'Incorrect username or password.'); } } });
  await f.start();
  assert.deepEqual(await f.submit('login', { username: 'erick', password: 'mala' }), { step: 'login', username: 'erick', error: 'Usuario o contraseña incorrectos' });
});

test('TOTP: código incorrecto conserva el paso; correcto completa', async () => {
  let attempts = 0;
  const cognito = {
    startLogin: async () => ({ kind: 'challenge', name: 'SOFTWARE_TOKEN_MFA', session: 'S', params: {}, username: 'erick' }),
    respondChallenge: async (_c, { code }) => {
      attempts++;
      if (code !== '123456') throw new CognitoError('CodeMismatchException', 'Invalid code');
      return { kind: 'tokens', tokens: TOKENS };
    },
  };
  const f = flowWith({ cognito });
  await f.start();
  assert.deepEqual(await f.submit('login', { username: 'erick', password: 'x' }), { step: 'code', channel: 'totp' });
  assert.equal((await f.submit('code', { code: '12' })).error, MSG.codeFormat);
  assert.equal(attempts, 0);
  const bad = await f.submit('code', { code: '000000' });
  assert.deepEqual(bad, { step: 'code', channel: 'totp', error: 'Código incorrecto' });
  assert.equal((await f.submit('code', { code: '123456' })).step, 'campaign');
});

test('desafío vencido → vuelve a usuario y contraseña', async () => {
  const cognito = {
    startLogin: async () => ({ kind: 'challenge', name: 'SMS_MFA', session: 'S', params: { CODE_DELIVERY_DESTINATION: '+52***1234' }, username: 'erick' }),
    respondChallenge: async () => { throw new CognitoError('NotAuthorizedException', 'Invalid session for the user, session is expired.'); },
  };
  const f = flowWith({ cognito });
  await f.start();
  assert.deepEqual(await f.submit('login', { username: 'erick', password: 'x' }), { step: 'code', channel: 'sms', destination: '+52***1234' });
  assert.deepEqual(await f.submit('code', { code: '123456' }), { step: 'login', username: 'erick', error: 'La sesión de inicio expiró, vuelve a intentarlo' });
});

test('selección de método muestra ambos y pide el código del elegido', async () => {
  const cognito = {
    startLogin: async () => ({ kind: 'challenge', name: 'SELECT_MFA_TYPE', session: 'S', params: { MFAS_CAN_CHOOSE: '["SMS_MFA","SOFTWARE_TOKEN_MFA"]' }, username: 'erick' }),
    respondChallenge: async (_c, { method }) => ({ kind: 'challenge', name: method, session: 'S2', params: {}, username: 'erick' }),
  };
  const f = flowWith({ cognito });
  await f.start();
  const v = await f.submit('login', { username: 'erick', password: 'x' });
  assert.deepEqual(v.options.map((o) => o.value), ['SMS_MFA', 'SOFTWARE_TOKEN_MFA']);
  assert.deepEqual(await f.submit('select_mfa', { method: 'SOFTWARE_TOKEN_MFA' }), { step: 'code', channel: 'totp' });
});

test('contraseña temporal: no coinciden sin llamar a Cognito; política → mensaje; luego MFA', async () => {
  const sent = [];
  const cognito = {
    startLogin: async () => ({ kind: 'challenge', name: 'NEW_PASSWORD_REQUIRED', session: 'S', params: {}, username: 'erick' }),
    respondChallenge: async (c, input) => {
      sent.push(input);
      if (input.newPassword === 'corta') throw new CognitoError('InvalidPasswordException', 'Password not long enough');
      return { kind: 'challenge', name: 'SOFTWARE_TOKEN_MFA', session: 'S3', params: {}, username: 'erick' };
    },
  };
  const f = flowWith({ cognito });
  await f.start();
  assert.equal((await f.submit('login', { username: 'erick', password: 'Temp1!' })).step, 'new_password');
  assert.equal((await f.submit('new_password', { password: 'a', confirm: 'b' })).error, 'Las contraseñas no coinciden');
  assert.equal(sent.length, 0);
  assert.deepEqual(await f.submit('new_password', { password: 'corta', confirm: 'corta' }), { step: 'new_password', error: 'Password not long enough' });
  assert.deepEqual(await f.submit('new_password', { password: 'Larga#2026x', confirm: 'Larga#2026x' }), { step: 'code', channel: 'totp' });
});

test('alta de TOTP: QR y clave; código incorrecto conserva el QR', async () => {
  const cognito = {
    startLogin: async () => ({ kind: 'challenge', name: 'MFA_SETUP', session: 'S', params: {}, username: 'erick' }),
    associateSoftwareToken: async (c) => ({ secretCode: 'JBSWY3DP', challenge: { ...c, session: 'S-assoc' } }),
    respondChallenge: async (c, { code }) => {
      assert.equal(c.session, 'S-assoc');
      if (code !== '111111') throw new CognitoError('EnableSoftwareTokenMFAException', 'Code mismatch');
      return { kind: 'tokens', tokens: TOKENS };
    },
  };
  const f = flowWith({ cognito });
  await f.start();
  const v = await f.submit('login', { username: 'erick', password: 'x' });
  assert.equal(v.step, 'setup_totp');
  assert.equal(v.secret, 'JBSWY3DP');
  assert.match(v.qr, /^data:image\/png/);
  const bad = await f.submit('code', { code: '222222' });
  assert.equal(bad.error, 'Código incorrecto');
  assert.equal(bad.qr, v.qr);
  assert.equal((await f.submit('code', { code: '111111' })).step, 'campaign');
});

test('la vista nunca contiene tokens ni la sesión de desafío', async () => {
  const views = [];
  const cognito = {
    startLogin: async () => ({ kind: 'challenge', name: 'SOFTWARE_TOKEN_MFA', session: 'SESION-SECRETA', params: {}, username: 'erick' }),
    respondChallenge: async () => ({ kind: 'tokens', tokens: { idToken: 'ID-SECRETO', accessToken: 'ACC-SECRETO', refreshToken: 'REF-SECRETO' } }),
  };
  const f = flowWith({ cognito });
  views.push(await f.start());
  views.push(await f.submit('login', { username: 'erick', password: 'PASS-SECRETA' }));
  views.push(await f.submit('code', { code: '123456' }));
  views.push(await f.submit('campaign', { campaign: 'prueba' }));
  const all = JSON.stringify(views);
  for (const s of ['SESION-SECRETA', 'ID-SECRETO', 'ACC-SECRETO', 'REF-SECRETO', 'PASS-SECRETA', '123456']) assert.ok(!all.includes(s), s);
});

test('sesión reanudada: "Sesión activa" → Continuar o Cambiar de usuario', async () => {
  const session = fakeSession({ resumeUser: 'erick' });
  const f = flowWith({ session, savedConfig: { campaign: 'prueba' } });
  assert.deepEqual(await f.start(), { step: 'active', username: 'erick', campaigns: ['prueba', 'ventas'], selected: 'prueba' });
  assert.deepEqual(await f.submit('switch_user'), { step: 'login', username: '' });
  assert.equal(session.logouts, 1);

  const g = flowWith({ session: fakeSession({ resumeUser: 'erick' }) });
  await g.start();
  assert.equal((await g.submit('continue', { campaign: 'ventas' })).step, 'done');
});

test('error al obtener campañas → reintentar', async () => {
  let fail = true;
  const f = createLoginFlow({
    cognito: { startLogin: async () => ({ kind: 'tokens', tokens: TOKENS }) },
    session: fakeSession(),
    listCampaigns: async () => {
      if (fail) throw Object.assign(new Error('x'), { status: 500 });
      return { campaigns: ['prueba'] };
    },
    logger: quiet,
  });
  await f.start();
  assert.equal((await f.submit('login', { username: 'e', password: 'x' })).error, MSG.campaignsError);
  fail = false;
  assert.equal((await f.submit('retry_campaigns')).selected, 'prueba');
});

test('el script del overlay es JavaScript válido y no usa innerHTML', () => {
  const src = loginOverlayScript();
  assert.doesNotThrow(() => new Function(src));
  assert.ok(!src.includes('innerHTML'));
  assert.ok(src.includes('anaLoginAction'));
});
