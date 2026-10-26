import { isDeveloper, requireAdminAccess } from '../lib/adminAccess';
import { adminError, adminInternal, adminOk, parseJsonBody, type AdminEvent, type AdminResult } from '../lib/adminHttp';
import {
  CLI_SETTINGS_CATALOG,
  CliSettingsConflictError,
  CliSettingsError,
  readCliSettings,
  updateCliSettings,
  validateSettingsPatch,
  type CliSettings,
  type CliSettingsDoc,
} from '../lib/cliSettings';

/**
 * GET/POST /admin/cli-settings (authorizer `cognitoAdminJwt`): solo rol
 * Developer (de v4 GET /me), ser admin o líder no basta.
 * La respuesta para el CLI (`GET /agent/settings`) está en `agentSettingsResponse`.
 */

const view = (doc: CliSettingsDoc) => ({
  settings: doc.settings,
  catalog: CLI_SETTINGS_CATALOG.map((c) => ({ key: c.key, type: c.type, default: c.default, label: c.label, description: c.description })),
  updatedAt: doc.updatedAt,
  updatedBy: doc.updatedBy,
});

const developerOnly = async (event: AdminEvent) => {
  const auth = await requireAdminAccess(event, {});
  if (!auth.ok) return auth;
  if (!isDeveloper(auth.access)) return { ok: false as const, response: adminError(403, 'Solo Developer') };
  return auth;
};

const fail = (e: unknown, context: string): AdminResult => {
  if (e instanceof CliSettingsError) {
    console.error(JSON.stringify({ evt: 'cli_settings_error', context, message: e.message }));
    return adminError(500, 'Configuración ilegible');
  }
  if (e instanceof CliSettingsConflictError) return adminError(409, 'La configuración cambió, intenta de nuevo');
  return adminInternal(context, e);
};

export const getCliSettings = async (event: AdminEvent): Promise<AdminResult> => {
  const auth = await developerOnly(event);
  if (!auth.ok) return auth.response;
  try {
    return adminOk(view((await readCliSettings()).doc));
  } catch (e) {
    return fail(e, 'getCliSettings');
  }
};

export const updateCliSettingsHandler = async (event: AdminEvent): Promise<AdminResult> => {
  const auth = await developerOnly(event);
  if (!auth.ok) return auth.response;
  const body = parseJsonBody(event);
  if (body === undefined || !body || typeof body !== 'object') return adminError(400, 'Body inválido');
  const patch = (body as { settings?: unknown }).settings;
  const invalid = validateSettingsPatch(patch);
  if (invalid) return adminError(400, invalid);
  try {
    const doc = await updateCliSettings(patch as CliSettings, auth.username);
    console.log(JSON.stringify({ evt: 'cli_settings_update', by: auth.username, keys: Object.keys(patch as object), settings: doc.settings }));
    return adminOk(view(doc));
  } catch (e) {
    return fail(e, 'updateCliSettings');
  }
};

/**
 * Cuerpo de `GET /agent/settings` (configuración efectiva para el CLI).
 * La autenticación de agente (`requireAgentToken` + authorizer `cognitoAgentJwt`)
 * la aporta `migrate-cli-to-cognito-login`; esta función se envuelve con ella
 * cuando exista (tarea 1.3).
 */
export async function agentSettingsResponse(): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  try {
    const { doc } = await readCliSettings();
    return { statusCode: 200, headers, body: JSON.stringify({ settings: doc.settings, updatedAt: doc.updatedAt }) };
  } catch (e) {
    console.error(JSON.stringify({ evt: 'agent_settings_error', name: (e as Error)?.name ?? 'Error' }));
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuración no disponible' }) };
  }
}
