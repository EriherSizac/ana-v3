/**
 * Identidad CRM del agente para las interacciones (crm-interactions-agent-identity).
 *
 *  - `GET /agent/campaigns` trae `crmUserId`/`displayName` (API de Roles vía v3);
 *    se guardan SOLO en memoria (no se persisten) asociados al username.
 *  - Toda interacción usa el `crmUserId` del agente como `user_id`; si falta,
 *    el user_id legado fijo y el sufijo "Agente: {username} ({name})" en comments.
 *  - Si el CRM rechaza el user_id del agente (4xx), se reintenta UNA vez con el
 *    legado + sufijo del agente.
 *  - Siempre se marca en comments que se registró vía ANA (sin duplicar).
 */

export const LEGACY_INTERACTIONS_USER_ID = '6898b89b-ab72-4196-92b1-70d51781f68f';

/** Límite asumido de `comments` en el CRM (no documentado; conservador). */
export const MAX_COMMENTS_LENGTH = 500;
const MAX_NAME_LENGTH = 120;

const ANA_EMPTY = 'Registrado vía ANA';
const ANA_APPEND = ' | vía ANA';

let current = null; // { username, crmUserId, displayName }

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const norm = (v) => String(v || '').trim().toLowerCase();
const chars = (s) => Array.from(String(s || ''));

/** Guarda la identidad de la respuesta de `/agent/campaigns` (en memoria). */
export function setCrmIdentity({ username, crmUserId, displayName } = {}) {
  const user = norm(username);
  if (!user) return;
  current = { username: user, crmUserId: clean(crmUserId), displayName: clean(displayName) };
}

export function clearCrmIdentity() {
  current = null;
}

/**
 * Identidad vigente para el agente de la sesión. Si la guardada es de otro
 * username, solo se devuelve el username de la sesión (sin crmUserId).
 */
export function getCrmIdentity(sessionUsername) {
  const user = norm(sessionUsername) || current?.username || '';
  if (!user) return { username: '', crmUserId: null, displayName: null };
  if (current && current.username === user) return { ...current };
  return { username: user, crmUserId: null, displayName: null };
}

/** "Agente: {username} ({name})" o "Agente: {username}"; '' sin username. */
export function agentLabel({ username, displayName } = {}) {
  const user = norm(username);
  if (!user) return '';
  const name = clean(displayName);
  if (!name) return `Agente: ${user}`;
  const n = chars(name);
  return `Agente: ${user} (${n.length > MAX_NAME_LENGTH ? n.slice(0, MAX_NAME_LENGTH).join('') : name})`;
}

/** Quita una marca de ANA ya aplicada (evita doble marca en reintentos). */
export function stripAnaTag(comments) {
  return String(comments ?? '')
    .replace(/^Registrado vía ANA(?: · Agente: .*)?$/s, '')
    .replace(/ \| vía ANA(?: · Agente: .*)?$/s, '');
}

/**
 * Comments con la marca de ANA (y el agente si `agent` no está vacío),
 * dentro de `max`. Se trunca el comentario original, nunca la marca.
 */
export function tagComments(comments, { agent = '', max = MAX_COMMENTS_LENGTH } = {}) {
  const original = stripAnaTag(comments).trim();
  const agentPart = agent ? ` · ${agent}` : '';
  if (!original) return `${ANA_EMPTY}${agentPart}`;
  const tag = `${ANA_APPEND}${agentPart}`;
  const room = max - chars(tag).length;
  const orig = chars(original);
  if (room <= 0) return chars(`${ANA_EMPTY}${agentPart}`).slice(0, max).join('');
  const body = orig.length > room ? `${orig.slice(0, Math.max(0, room - 1)).join('')}…` : original;
  return `${body}${tag}`;
}

const isLegacyOrMissing = (id) => !id || id === LEGACY_INTERACTIONS_USER_ID;

/**
 * Prepara las interacciones: `user_id` del agente cuando hay `crmUserId` (si el
 * builder puso el legado o nada), si no el legado + sufijo del agente. Siempre
 * marca comments. `mode` = 'agent' | 'legacy_no_identity' | 'explicit'.
 */
export function applyIdentity(interactions, identity, { forceLegacy = false } = {}) {
  const label = agentLabel(identity);
  let mode = 'explicit';
  const out = (interactions || []).map((it) => {
    const next = { ...(it || {}) };
    let useAgentSuffix = false;
    if (isLegacyOrMissing(next.user_id)) {
      if (identity?.crmUserId && !forceLegacy) {
        next.user_id = identity.crmUserId;
        mode = 'agent';
      } else {
        next.user_id = LEGACY_INTERACTIONS_USER_ID;
        useAgentSuffix = true;
        mode = forceLegacy ? 'legacy_fallback' : 'legacy_no_identity';
      }
    }
    next.comments = tagComments(next.comments, { agent: useAgentSuffix ? label : '' });
    return next;
  });
  return { interactions: out, mode };
}

/**
 * Envía con la identidad del agente y aplica el fallback: si el CRM responde
 * 4xx con el user_id del agente, reintenta UNA vez con el legado + sufijo.
 * `send(interactions)` → `{ ok, status, ... }` (el resultado de insertInteractions).
 */
export async function sendWithAgentIdentity(rawInteractions, identity, send, logger = console) {
  const user = identity?.username || 'desconocido';
  const first = applyIdentity(rawInteractions, identity);
  const res = await send(first.interactions);
  if (first.mode === 'agent' && !res?.ok && res?.status >= 400 && res?.status < 500) {
    logger.warn?.(`[crm-identity] CRM rechazó el user_id del agente ${user} (${res.status}); reintento con user_id legado`);
    const retry = applyIdentity(rawInteractions, identity, { forceLegacy: true });
    const res2 = await send(retry.interactions);
    logger.log?.(`[crm-identity] user_id=legacy_fallback agente=${user} ok=${!!res2?.ok}`);
    return { ...res2, userIdPath: 'legacy_fallback' };
  }
  logger.log?.(`[crm-identity] user_id=${first.mode} agente=${user} ok=${!!res?.ok}`);
  return { ...res, userIdPath: first.mode };
}
