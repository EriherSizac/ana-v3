import { getText, isConditionalConflict, putJsonConditional } from './s3Json';

/**
 * Configuración remota del CLI v3 (add-cli-remote-settings).
 * Documento global en `config/cli-settings.json` con catálogo cerrado de flags.
 */

export const CLI_SETTINGS_KEY = 'config/cli-settings.json';
export const CLI_SETTINGS_WRITE_RETRIES = 3;

export type SettingType = 'boolean';

export interface CatalogEntry {
  key: string;
  type: SettingType;
  default: boolean;
  /** Nombre legible para ANA Admin. */
  label: string;
  description: string;
}

/** Catálogo cerrado: toda llave fuera de aquí se rechaza al escribir e ignora al leer. */
export const CLI_SETTINGS_CATALOG: readonly CatalogEntry[] = [
  {
    key: 'noWhatsappConsultRegistration',
    type: 'boolean',
    default: false,
    label: 'Registrar consulta de números sin WhatsApp',
    description:
      'Si está activo, la ventana manual del CLI ofrece registrar en el CRM el subdictamen "Consulta No Whatsapp" desde el modal "Números sin WhatsApp".',
  },
];

export type CliSettings = Record<string, boolean>;

export interface CliSettingsDoc {
  schemaVersion: 1;
  settings: CliSettings;
  updatedAt: string | null;
  updatedBy: string | null;
}

export class CliSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliSettingsError';
  }
}

export class CliSettingsConflictError extends Error {
  constructor() {
    super('La configuración cambió, intenta de nuevo');
    this.name = 'CliSettingsConflictError';
  }
}

export const defaultSettings = (): CliSettings =>
  Object.fromEntries(CLI_SETTINGS_CATALOG.map((c) => [c.key, c.default]));

const typeOk = (entry: CatalogEntry, v: unknown): v is boolean => entry.type === 'boolean' && typeof v === 'boolean';

/** Defaults del catálogo reemplazados por los valores guardados válidos (llave conocida y tipo correcto). */
export function effectiveSettings(saved: unknown): CliSettings {
  const out = defaultSettings();
  if (!saved || typeof saved !== 'object') return out;
  for (const entry of CLI_SETTINGS_CATALOG) {
    const v = (saved as Record<string, unknown>)[entry.key];
    if (typeOk(entry, v)) out[entry.key] = v;
  }
  return out;
}

/** Valida el documento guardado. Ilegible u otra versión → CliSettingsError. */
export function parseCliSettings(text: string): CliSettingsDoc {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CliSettingsError('config/cli-settings.json: JSON inválido');
  }
  if (!data || typeof data !== 'object' || data.schemaVersion !== 1) {
    throw new CliSettingsError('config/cli-settings.json: versión no soportada');
  }
  return {
    schemaVersion: 1,
    settings: effectiveSettings(data.settings),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

/** Configuración efectiva + ETag. Objeto inexistente = valores por defecto. */
export async function readCliSettings(): Promise<{ doc: CliSettingsDoc; etag: string | null }> {
  const obj = await getText(CLI_SETTINGS_KEY);
  if (obj.text === undefined) {
    return { doc: { schemaVersion: 1, settings: defaultSettings(), updatedAt: null, updatedBy: null }, etag: null };
  }
  return { doc: parseCliSettings(obj.text), etag: obj.etag };
}

/** Valida un cambio parcial `{llave: valor}` contra el catálogo. Devuelve el mensaje de error (400) o null. */
export function validateSettingsPatch(patch: unknown): string | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'settings debe ser un objeto';
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) return 'settings vacío';
  for (const [key, value] of entries) {
    const entry = CLI_SETTINGS_CATALOG.find((c) => c.key === key);
    if (!entry) return `Configuración desconocida: ${key}`;
    if (!typeOk(entry, value)) return `Tipo inválido para ${key}: se espera ${entry.type}`;
  }
  return null;
}

/** Guarda el cambio combinado con escritura condicional (hasta 3 intentos). */
export async function updateCliSettings(patch: CliSettings, by: string, now: () => Date = () => new Date()): Promise<CliSettingsDoc> {
  for (let attempt = 0; attempt < CLI_SETTINGS_WRITE_RETRIES; attempt++) {
    const { doc, etag } = await readCliSettings();
    const next: CliSettingsDoc = {
      schemaVersion: 1,
      settings: effectiveSettings({ ...doc.settings, ...patch }),
      updatedAt: now().toISOString(),
      updatedBy: by,
    };
    try {
      await putJsonConditional(CLI_SETTINGS_KEY, next, etag);
      return next;
    } catch (e) {
      if (!isConditionalConflict(e)) throw e;
    }
  }
  throw new CliSettingsConflictError();
}
