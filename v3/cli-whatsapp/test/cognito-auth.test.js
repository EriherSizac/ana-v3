import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CognitoError, cognitoConfigFromEnv, createCognitoClient, decodeJwtPayload, loginErrorMessage, isSessionRejected } from '../cognito-auth.js';

const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const TOKENS = { IdToken: jwt({ 'cognito:username': 'Erick', exp: 2000000000 }), AccessToken: 'acc', RefreshToken: 'ref', ExpiresIn: 3600 };

/** fetch falso que responde según X-Amz-Target y registra las llamadas. */
function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init) => {
    const op = init.headers['X-Amz-Target'].split('.').pop();
    const body = JSON.parse(init.body);
    calls.push({ url, op, body, headers: init.headers });
    const h = handlers[op];
    if (!h) throw new Error(`op inesperada ${op}`);
    const out = await h(body, calls.length);
    if (out instanceof Error) throw out;
    const status = out.__status || 200;
    delete out.__status;
    return new Response(JSON.stringify(out), { status });
  };
  fn.calls = calls;
  return fn;
}
const err = (type, message) => ({ __status: 400, __type: type, message });

test('config con overrides ANA_COGNITO_*', () => {
  assert.deepEqual(cognitoConfigFromEnv({}), { region: 'us-east-2', userPoolId: 'us-east-2_UepfOyKpd', clientId: '1r6niimhkl2fmias6kk85n4ou4' });
  assert.deepEqual(cognitoConfigFromEnv({ ANA_COGNITO_CLIENT_ID: 'abc', ANA_COGNITO_REGION: 'us-east-1', ANA_COGNITO_USER_POOL_ID: 'p' }), {
    region: 'us-east-1',
    userPoolId: 'p',
    clientId: 'abc',
  });
});

test('login simple: USER_PASSWORD_AUTH a la API JSON pública', async () => {
  const f = fakeFetch({ InitiateAuth: () => ({ AuthenticationResult: TOKENS }) });
  const c = createCognitoClient({ region: 'us-east-2', clientId: 'cli', fetchImpl: f });
  const r = await c.startLogin('Erick.H', 'secreta');
  assert.equal(r.kind, 'tokens');
  assert.equal(r.tokens.refreshToken, 'ref');
  assert.equal(f.calls[0].url, 'https://cognito-idp.us-east-2.amazonaws.com/');
  assert.equal(f.calls[0].headers['Content-Type'], 'application/x-amz-json-1.1');
  assert.deepEqual(f.calls[0].body, { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: 'cli', AuthParameters: { USERNAME: 'Erick.H', PASSWORD: 'secreta' } });
});

test('desafío TOTP y respuesta con USER_ID_FOR_SRP', async () => {
  const f = fakeFetch({
    InitiateAuth: () => ({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'S1', ChallengeParameters: { USER_ID_FOR_SRP: 'erick' } }),
    RespondToAuthChallenge: () => ({ AuthenticationResult: TOKENS }),
  });
  const c = createCognitoClient({ region: 'us-east-2', clientId: 'cli', fetchImpl: f });
  const ch = await c.startLogin('Erick', 'x');
  assert.equal(ch.kind, 'challenge');
  assert.equal(ch.username, 'erick');
  const r = await c.respondChallenge(ch, { code: '123456' });
  assert.equal(r.kind, 'tokens');
  assert.deepEqual(f.calls[1].body, {
    ChallengeName: 'SOFTWARE_TOKEN_MFA',
    ClientId: 'cli',
    Session: 'S1',
    ChallengeResponses: { USERNAME: 'erick', SOFTWARE_TOKEN_MFA_CODE: '123456' },
  });
});

test('SMS, selección de método y contraseña nueva', async () => {
  const f = fakeFetch({
    RespondToAuthChallenge: (b) => {
      if (b.ChallengeName === 'SELECT_MFA_TYPE') return { ChallengeName: 'SMS_MFA', Session: 'S2', ChallengeParameters: {} };
      return { AuthenticationResult: TOKENS };
    },
  });
  const c = createCognitoClient({ region: 'us-east-2', clientId: 'cli', fetchImpl: f });
  const base = { kind: 'challenge', session: 'S', params: {}, username: 'erick' };
  const sms = await c.respondChallenge({ ...base, name: 'SELECT_MFA_TYPE' }, { method: 'SMS_MFA' });
  assert.equal(sms.name, 'SMS_MFA');
  assert.deepEqual(f.calls[0].body.ChallengeResponses, { USERNAME: 'erick', ANSWER: 'SMS_MFA' });
  await c.respondChallenge(sms, { code: '654321' });
  assert.deepEqual(f.calls[1].body.ChallengeResponses, { USERNAME: 'erick', SMS_MFA_CODE: '654321' });
  await c.respondChallenge({ ...base, name: 'NEW_PASSWORD_REQUIRED' }, { newPassword: 'Nueva#2026' });
  assert.deepEqual(f.calls[2].body.ChallengeResponses, { USERNAME: 'erick', NEW_PASSWORD: 'Nueva#2026' });
});

test('alta de TOTP: Associate → Verify → MFA_SETUP con la sesión devuelta', async () => {
  const f = fakeFetch({
    AssociateSoftwareToken: () => ({ SecretCode: 'JBSWY3DPEHPK3PXP', Session: 'S-assoc' }),
    VerifySoftwareToken: (b) => (b.UserCode === '111111' ? { Status: 'SUCCESS', Session: 'S-verify' } : err('EnableSoftwareTokenMFAException', 'Code mismatch')),
    RespondToAuthChallenge: () => ({ AuthenticationResult: TOKENS }),
  });
  const c = createCognitoClient({ region: 'us-east-2', clientId: 'cli', fetchImpl: f });
  const { secretCode, challenge } = await c.associateSoftwareToken({ kind: 'challenge', name: 'MFA_SETUP', session: 'S0', params: {}, username: 'erick' });
  assert.equal(secretCode, 'JBSWY3DPEHPK3PXP');
  await assert.rejects(() => c.respondChallenge(challenge, { code: '000000' }), (e) => e.code === 'EnableSoftwareTokenMFAException');
  const r = await c.respondChallenge(challenge, { code: '111111' });
  assert.equal(r.kind, 'tokens');
  const last = f.calls.at(-1);
  assert.equal(last.body.ChallengeName, 'MFA_SETUP');
  assert.equal(last.body.Session, 'S-verify');
});

test('refresh y revoke', async () => {
  const f = fakeFetch({
    InitiateAuth: () => ({ AuthenticationResult: { IdToken: TOKENS.IdToken, AccessToken: 'a2', ExpiresIn: 3600 } }),
    RevokeToken: () => ({}),
  });
  const c = createCognitoClient({ region: 'us-east-2', clientId: 'cli', fetchImpl: f });
  const t = await c.refresh('ref');
  assert.equal(t.refreshToken, null);
  assert.deepEqual(f.calls[0].body, { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: 'cli', AuthParameters: { REFRESH_TOKEN: 'ref' } });
  await c.revoke('ref');
  assert.deepEqual(f.calls[1].body, { Token: 'ref', ClientId: 'cli' });
});

test('errores: código de Cognito, red y sin client id', async () => {
  const c = createCognitoClient({ region: 'us-east-2', clientId: 'cli', fetchImpl: fakeFetch({ InitiateAuth: () => err('com.amazonaws#NotAuthorizedException', 'Incorrect username or password.') }) });
  await assert.rejects(() => c.startLogin('a', 'b'), (e) => e instanceof CognitoError && e.code === 'NotAuthorizedException');
  const net = createCognitoClient({ region: 'us-east-2', clientId: 'cli', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => net.startLogin('a', 'b'), (e) => e.code === 'NetworkError');
  const none = createCognitoClient({ region: 'us-east-2', clientId: '', fetchImpl: async () => assert.fail('no debe llamar') });
  await assert.rejects(() => none.startLogin('a', 'b'), (e) => e.code === 'ConfigError');
});

test('los errores no incluyen la contraseña ni la sesión', async () => {
  const f = fakeFetch({ RespondToAuthChallenge: () => err('NotAuthorizedException', 'Invalid session for the user, session is expired.') });
  const c = createCognitoClient({ region: 'us-east-2', clientId: 'cli', fetchImpl: f });
  try {
    await c.respondChallenge({ name: 'SMS_MFA', session: 'SESION-SECRETA', username: 'erick' }, { code: '123456' });
    assert.fail('debía fallar');
  } catch (e) {
    const s = `${e.message} ${e.code} ${e.stack}`;
    assert.ok(!s.includes('SESION-SECRETA'));
    assert.ok(!s.includes('123456'));
  }
});

test('mensajes para el agente', () => {
  const e = (code, message) => new CognitoError(code, message);
  assert.equal(loginErrorMessage(e('NotAuthorizedException', 'Incorrect username or password.')), 'Usuario o contraseña incorrectos');
  assert.equal(loginErrorMessage(e('UserNotFoundException')), 'Usuario o contraseña incorrectos');
  assert.equal(loginErrorMessage(e('NotAuthorizedException', 'Password attempts exceeded')), 'Demasiados intentos, espera unos minutos');
  assert.equal(loginErrorMessage(e('TooManyRequestsException')), 'Demasiados intentos, espera unos minutos');
  assert.equal(loginErrorMessage(e('PasswordResetRequiredException')), 'Debes restablecer tu contraseña; contacta a tu supervisor');
  assert.equal(loginErrorMessage(e('NetworkError')), 'Error de conexión con el servidor');
  assert.equal(loginErrorMessage(e('CodeMismatchException'), 'challenge'), 'Código incorrecto');
  assert.equal(loginErrorMessage(e('NotAuthorizedException', 'Invalid session for the user, session is expired.'), 'challenge'), 'La sesión de inicio expiró, vuelve a intentarlo');
  assert.equal(loginErrorMessage(e('InvalidPasswordException', 'Password must have symbol characters')), 'Password must have symbol characters');
  assert.ok(isSessionRejected(e('NotAuthorizedException')));
  assert.ok(!isSessionRejected(e('NetworkError')));
});

test('decodeJwtPayload', () => {
  assert.deepEqual(decodeJwtPayload(jwt({ a: 1 })), { a: 1 });
  assert.equal(decodeJwtPayload('basura'), null);
});
