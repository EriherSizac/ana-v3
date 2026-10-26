import { isChallengeExpired, loginErrorMessage, SUPPORTED_CHALLENGES } from './cognito-auth.js';

/**
 * Máquina de estados del login del overlay (migrate-cli-to-cognito-login D8).
 * Vive en Node: la página solo envía las entradas del usuario (`submit`) y
 * recibe una vista `{ step, error?, ... }` sin tokens ni sesión de desafío.
 *
 * Pasos: login → [select_mfa] → [code | setup_totp] → [new_password] → campaign
 *        (o active al reanudar) → done.  `no_campaigns` es terminal salvo
 *        "Cambiar de usuario".
 */

export const MSG = Object.freeze({
  incomplete: 'Por favor completa todos los campos',
  mismatch: 'Las contraseñas no coinciden',
  noCampaigns: 'Tu usuario no está habilitado en ninguna campaña. Contacta a tu supervisor.',
  chooseCampaign: 'Elige una campaña de la lista',
  campaignsError: 'No se pudieron obtener tus campañas, intenta de nuevo',
  codeFormat: 'Escribe el código de 6 dígitos',
});

const MFA_LABELS = { SMS_MFA: 'Mensaje de texto (SMS)', SOFTWARE_TOKEN_MFA: 'App autenticadora' };

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(String(v || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
};

/**
 * @param {{ cognito, session, listCampaigns: () => Promise<{campaigns: string[]}>,
 *           savedConfig?: { agent_id?: string, campaign?: string } | null,
 *           qrDataUrl?: (otpauthUri: string) => Promise<string|null>, logger?: Console }} deps
 */
export function createLoginFlow({ cognito, session, listCampaigns, savedConfig = null, qrDataUrl = async () => null, logger = console }) {
  let view = null;
  let challenge = null; // desafío vigente (incluye la Session de Cognito); nunca sale de Node
  let loginUser = '';
  let result = null;
  let campaigns = [];

  const savedUser = String(savedConfig?.agent_id || '');
  const savedCampaign = String(savedConfig?.campaign || '').trim().toLowerCase();

  const set = (v) => {
    view = v;
    return v;
  };
  const loginView = (error, username = loginUser || savedUser) => {
    challenge = null;
    return set({ step: 'login', username, ...(error ? { error } : {}) });
  };

  const preselect = (list) => (list.includes(savedCampaign) ? savedCampaign : list.length === 1 ? list[0] : '');

  async function campaignView(step) {
    try {
      ({ campaigns } = await listCampaigns());
    } catch (e) {
      logger.warn?.('⚠️  No se pudieron obtener las campañas del agente:', e?.status || e?.message || 'error');
      return set({ step: step === 'active' ? 'active' : 'campaign', username: session.agentId, campaigns: [], selected: '', error: MSG.campaignsError });
    }
    campaigns = [...new Set(campaigns.map((c) => String(c).trim().toLowerCase()).filter(Boolean))].sort();
    if (campaigns.length === 0) return set({ step: 'no_campaigns', username: session.agentId, error: MSG.noCampaigns });
    return set({ step, username: session.agentId, campaigns, selected: preselect(campaigns) });
  }

  async function afterAuth(r) {
    if (r.kind === 'tokens') {
      challenge = null;
      await session.completeLogin(r.tokens);
      return campaignView('campaign');
    }
    challenge = r;
    switch (r.name) {
      case 'SMS_MFA':
        return set({ step: 'code', channel: 'sms', destination: r.params?.CODE_DELIVERY_DESTINATION || '' });
      case 'SOFTWARE_TOKEN_MFA':
        return set({ step: 'code', channel: 'totp' });
      case 'SELECT_MFA_TYPE': {
        const options = parseList(r.params?.MFAS_CAN_CHOOSE).filter((m) => MFA_LABELS[m]);
        return set({ step: 'select_mfa', options: options.map((m) => ({ value: m, label: MFA_LABELS[m] })) });
      }
      case 'NEW_PASSWORD_REQUIRED':
        return set({ step: 'new_password' });
      case 'MFA_SETUP': {
        const assoc = await cognito.associateSoftwareToken(r);
        challenge = assoc.challenge;
        const label = encodeURIComponent(`ANA:${r.username}`);
        const uri = `otpauth://totp/${label}?secret=${assoc.secretCode}&issuer=ANA`;
        let qr = null;
        try {
          qr = await qrDataUrl(uri);
        } catch {
          qr = null;
        }
        return set({ step: 'setup_totp', secret: assoc.secretCode, qr });
      }
      default:
        logger.warn?.(`⚠️  Desafío de Cognito no soportado: ${r.name}`);
        return loginView('No se pudo iniciar sesión, intenta de nuevo');
    }
  }

  const challengeError = (e) => {
    if (isChallengeExpired(e)) return loginView(loginErrorMessage(e, 'challenge'));
    return set({ ...view, error: loginErrorMessage(e, 'challenge') });
  };

  return {
    get view() {
      return view;
    },
    /** `{ agent_id, campaign }` al terminar, o null. */
    get result() {
      return result;
    },

    /** Vista inicial: reanuda la sesión guardada si Cognito la renueva. */
    async start() {
      const resumed = await session.resume();
      if (resumed) return campaignView('active');
      return loginView(null, savedUser);
    },

    /** Procesa una acción del overlay y devuelve la vista siguiente. */
    async submit(action, input = {}) {
      const step = view?.step;
      try {
        switch (action) {
          case 'login': {
            const username = String(input.username ?? '').trim();
            const password = String(input.password ?? '');
            if (!username || !password) return set({ step: 'login', username, error: MSG.incomplete });
            loginUser = username;
            let r;
            try {
              r = await cognito.startLogin(username, password);
            } catch (e) {
              return loginView(loginErrorMessage(e, 'login'), username);
            }
            if (r.kind === 'challenge' && !SUPPORTED_CHALLENGES.includes(r.name)) {
              logger.warn?.(`⚠️  Desafío de Cognito no soportado: ${r.name}`);
              return loginView('No se pudo iniciar sesión, intenta de nuevo', username);
            }
            return await afterAuth(r);
          }
          case 'select_mfa': {
            if (step !== 'select_mfa' || !challenge) return loginView();
            return await afterAuth(await cognito.respondChallenge(challenge, { method: input.method })).catch(challengeError);
          }
          case 'code': {
            if ((step !== 'code' && step !== 'setup_totp') || !challenge) return loginView();
            const code = String(input.code ?? '').replace(/\s+/g, '');
            if (!/^\d{6}$/.test(code)) return set({ ...view, error: MSG.codeFormat });
            return await afterAuth(await cognito.respondChallenge(challenge, { code })).catch(challengeError);
          }
          case 'new_password': {
            if (step !== 'new_password' || !challenge) return loginView();
            const pw = String(input.password ?? '');
            const confirm = String(input.confirm ?? '');
            if (!pw || !confirm) return set({ step: 'new_password', error: MSG.incomplete });
            if (pw !== confirm) return set({ step: 'new_password', error: MSG.mismatch });
            return await afterAuth(await cognito.respondChallenge(challenge, { newPassword: pw })).catch(challengeError);
          }
          case 'campaign':
          case 'continue': {
            if (step !== 'campaign' && step !== 'active') return view;
            const c = String(input.campaign ?? '').trim().toLowerCase();
            if (!campaigns.includes(c)) return set({ ...view, error: MSG.chooseCampaign });
            session.setCampaign(c);
            result = { agent_id: session.agentId, campaign: c };
            return set({ step: 'done', username: session.agentId, campaign: c });
          }
          case 'retry_campaigns':
            return await campaignView(step === 'active' ? 'active' : 'campaign');
          case 'switch_user':
          case 'cancel': {
            if (action === 'switch_user') await session.logout();
            loginUser = '';
            return loginView(null, '');
          }
          default:
            return view;
        }
      } catch (e) {
        // Error de red u otro inesperado dentro de un desafío
        if (challenge) return challengeError(e);
        return loginView(loginErrorMessage(e, 'login'));
      }
    },
  };
}
