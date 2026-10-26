/**
 * Cliente mínimo del User Pool de Cognito sobre su API JSON pública
 * (migrate-cli-to-cognito-login, design D1/D2): `fetch` global de Node 18,
 * sin SDK ni firma SigV4 (app client público `ana-v3-cli`, sin secreto).
 *
 * Operaciones: InitiateAuth (USER_PASSWORD_AUTH, REFRESH_TOKEN_AUTH),
 * RespondToAuthChallenge (SMS_MFA, SOFTWARE_TOKEN_MFA, SELECT_MFA_TYPE,
 * MFA_SETUP, NEW_PASSWORD_REQUIRED), AssociateSoftwareToken,
 * VerifySoftwareToken y RevokeToken.
 *
 * Este módulo NUNCA registra contraseñas, códigos, la sesión de desafío ni
 * tokens: los errores solo llevan el código de Cognito y su mensaje.
 */

export const DEFAULT_COGNITO = Object.freeze({
  region: 'us-east-2',
  userPoolId: 'us-east-2_UepfOyKpd',
  // Id del App Client público `ana-v3-cli` (pendiente de crear, tarea 1.1):
  // se configura con ANA_COGNITO_CLIENT_ID hasta fijarlo aquí en el release.
  clientId: '1r6niimhkl2fmias6kk85n4ou4',
});

/** Configuración efectiva con overrides `ANA_COGNITO_*`. */
export function cognitoConfigFromEnv(env = process.env) {
  return {
    region: String(env.ANA_COGNITO_REGION || DEFAULT_COGNITO.region).trim(),
    userPoolId: String(env.ANA_COGNITO_USER_POOL_ID || DEFAULT_COGNITO.userPoolId).trim(),
    clientId: String(env.ANA_COGNITO_CLIENT_ID || DEFAULT_COGNITO.clientId).trim(),
  };
}

/** Error de Cognito (o de red: `code === 'NetworkError'`). */
export class CognitoError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'CognitoError';
    this.code = code;
  }
}

export const SUPPORTED_CHALLENGES = Object.freeze(['SMS_MFA', 'SOFTWARE_TOKEN_MFA', 'SELECT_MFA_TYPE', 'MFA_SETUP', 'NEW_PASSWORD_REQUIRED']);

const DEFAULT_TIMEOUT_MS = 15000;

/** Payload (sin verificar) de un JWT; solo para leer `exp` y `cognito:username` del ID token propio. */
export function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {{ region: string, clientId: string, fetchImpl?: typeof fetch, endpoint?: string, timeoutMs?: number }} opts
 */
export function createCognitoClient({ region, clientId, fetchImpl, endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = endpoint || `https://cognito-idp.${region}.amazonaws.com/`;
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));

  async function call(operation, body) {
    if (!clientId && operation !== 'AssociateSoftwareToken' && operation !== 'VerifySoftwareToken') {
      throw new CognitoError('ConfigError', 'Falta el App Client de Cognito (ANA_COGNITO_CLIENT_ID)');
    }
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new CognitoError('NetworkError', e?.name || 'fetch failed');
    }
    let data = {};
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      const rawType = String(data.__type || data.code || `HTTP_${res.status}`);
      const code = rawType.includes('#') ? rawType.split('#').pop() : rawType;
      throw new CognitoError(code, typeof data.message === 'string' ? data.message : data.Message);
    }
    return data;
  }

  /** Normaliza la respuesta de InitiateAuth/RespondToAuthChallenge. */
  function toResult(data, username) {
    if (data.AuthenticationResult) {
      const r = data.AuthenticationResult;
      return {
        kind: 'tokens',
        tokens: {
          idToken: r.IdToken,
          accessToken: r.AccessToken,
          refreshToken: r.RefreshToken || null,
          expiresIn: Number(r.ExpiresIn) || 3600,
        },
      };
    }
    if (data.ChallengeName) {
      const params = data.ChallengeParameters || {};
      return {
        kind: 'challenge',
        name: data.ChallengeName,
        session: data.Session || null,
        params,
        username: params.USER_ID_FOR_SRP || username,
      };
    }
    throw new CognitoError('UnexpectedResponse', 'Respuesta de Cognito sin tokens ni desafío');
  }

  /** Paso 1: usuario + contraseña. */
  async function startLogin(username, password) {
    const data = await call('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    });
    return toResult(data, username);
  }

  async function respond(challenge, name, responses, session = challenge.session) {
    const data = await call('RespondToAuthChallenge', {
      ChallengeName: name,
      ClientId: clientId,
      Session: session,
      ChallengeResponses: { USERNAME: challenge.username, ...responses },
    });
    return toResult(data, challenge.username);
  }

  /**
   * Responde un desafío. `input` según el desafío:
   *  - SMS_MFA / SOFTWARE_TOKEN_MFA: `{ code }`
   *  - SELECT_MFA_TYPE: `{ method: 'SMS_MFA' | 'SOFTWARE_TOKEN_MFA' }`
   *  - NEW_PASSWORD_REQUIRED: `{ newPassword }`
   *  - MFA_SETUP: `{ code }` tras `associateSoftwareToken` (usa la sesión que devolvió)
   */
  async function respondChallenge(challenge, input = {}) {
    switch (challenge?.name) {
      case 'SMS_MFA':
        return respond(challenge, 'SMS_MFA', { SMS_MFA_CODE: String(input.code || '') });
      case 'SOFTWARE_TOKEN_MFA':
        return respond(challenge, 'SOFTWARE_TOKEN_MFA', { SOFTWARE_TOKEN_MFA_CODE: String(input.code || '') });
      case 'SELECT_MFA_TYPE':
        return respond(challenge, 'SELECT_MFA_TYPE', { ANSWER: String(input.method || '') });
      case 'NEW_PASSWORD_REQUIRED':
        return respond(challenge, 'NEW_PASSWORD_REQUIRED', { NEW_PASSWORD: String(input.newPassword || '') });
      case 'MFA_SETUP': {
        const v = await call('VerifySoftwareToken', {
          Session: challenge.session,
          UserCode: String(input.code || ''),
          FriendlyDeviceName: 'ANA',
        });
        if (v.Status !== 'SUCCESS') throw new CognitoError('CodeMismatchException', 'Código incorrecto');
        return respond(challenge, 'MFA_SETUP', {}, v.Session || challenge.session);
      }
      default:
        throw new CognitoError('UnsupportedChallenge', `Desafío no soportado: ${challenge?.name}`);
    }
  }

  /** Alta de TOTP (MFA_SETUP): devuelve la clave secreta y el desafío con la sesión nueva. */
  async function associateSoftwareToken(challenge) {
    const data = await call('AssociateSoftwareToken', { Session: challenge.session });
    return { secretCode: data.SecretCode, challenge: { ...challenge, session: data.Session || challenge.session } };
  }

  /** Renovación con el refresh token (sin rotación, Cognito no devuelve refresh nuevo). */
  async function refresh(refreshToken) {
    const data = await call('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: clientId,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    const r = toResult(data, '');
    if (r.kind !== 'tokens') throw new CognitoError('UnexpectedResponse', 'La renovación pidió un desafío');
    return r.tokens;
  }

  /** Revoca el refresh token (y los tokens emitidos con él). */
  async function revoke(refreshToken) {
    await call('RevokeToken', { Token: refreshToken, ClientId: clientId });
  }

  return { startLogin, respondChallenge, associateSoftwareToken, refresh, revoke, call };
}

/** ¿El error indica que el refresh token ya no sirve (vencido o revocado)? */
export const isSessionRejected = (e) => e?.code === 'NotAuthorizedException' || e?.code === 'UserNotFoundException';

/**
 * Mensaje para el agente (spec v3/cli-agent-session). `phase` es 'login'
 * (usuario+contraseña) o 'challenge' (código / contraseña nueva).
 */
export function loginErrorMessage(e, phase = 'login') {
  const code = e?.code || '';
  const msg = String(e?.message || '');
  if (code === 'NetworkError') return 'Error de conexión con el servidor';
  if (code === 'ConfigError') return 'ANA no tiene configurado el inicio de sesión; contacta a soporte';
  if (code === 'PasswordResetRequiredException') return 'Debes restablecer tu contraseña; contacta a tu supervisor';
  if (['TooManyRequestsException', 'LimitExceededException', 'TooManyFailedAttemptsException'].includes(code)) {
    return 'Demasiados intentos, espera unos minutos';
  }
  if (code === 'NotAuthorizedException' && /attempts exceeded/i.test(msg)) return 'Demasiados intentos, espera unos minutos';
  if (code === 'CodeMismatchException' || code === 'EnableSoftwareTokenMFAException' || code === 'ExpiredCodeException') {
    return 'Código incorrecto';
  }
  if (code === 'InvalidPasswordException') return msg || 'La contraseña no cumple la política';
  if (phase === 'challenge' && (code === 'NotAuthorizedException' || /session is expired/i.test(msg))) {
    return 'La sesión de inicio expiró, vuelve a intentarlo';
  }
  if (code === 'UserNotConfirmedException') return 'Tu usuario no está confirmado; contacta a tu supervisor';
  if (code === 'NotAuthorizedException' || code === 'UserNotFoundException') return 'Usuario o contraseña incorrectos';
  return 'No se pudo iniciar sesión, intenta de nuevo';
}

/** ¿El error de un desafío obliga a volver a usuario y contraseña? */
export const isChallengeExpired = (e) =>
  e?.code === 'NotAuthorizedException' && !/attempts exceeded/i.test(String(e?.message || ''));
