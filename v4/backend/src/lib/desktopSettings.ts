// File: Configuración remota del desktop v4: catálogo, validación y merge (v4-add-desktop-remote-settings).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';

export type SettingType = 'integer' | 'boolean';

export interface SettingDef {
  key: string;
  type: SettingType;
  min?: number;
  max?: number;
  default: number | boolean;
  label: string;
  description: string;
}

/** Catálogo cerrado (design D2). Agregar una llave = cambio de código. */
export const DESKTOP_SETTINGS: readonly SettingDef[] = [
  {
    key: 'sendMinGapSeconds',
    type: 'integer',
    min: 60,
    max: 600,
    default: 120,
    label: 'Separación mínima entre mensajes (segundos)',
    description: 'Tiempo mínimo que espera el desktop entre un envío de campaña y el siguiente.',
  },
  {
    key: 'sendMaxPerWindow',
    type: 'integer',
    min: 1,
    max: 20,
    default: 7,
    label: 'Máximo de mensajes por ventana',
    description: 'Cuántos envíos de campaña se permiten como máximo dentro de la ventana de tiempo.',
  },
  {
    key: 'sendWindowMinutes',
    type: 'integer',
    min: 5,
    max: 60,
    default: 20,
    label: 'Ventana de envío (minutos)',
    description: 'Duración de la ventana en la que se cuenta el máximo de mensajes.',
  },
  {
    key: 'openChatInteraction',
    type: 'boolean',
    default: false,
    label: 'Registrar "Atención WhatsApp" al abrir un chat',
    description: 'Si está activo, el desktop registra en el CRM la atención al abrir una conversación propia.',
  },
];

export type DesktopSettingsValues = Record<string, number | boolean>;

/** Item `{PK:"CONFIG", SK:"DESKTOP_SETTINGS"}` en la tabla de permisos de rol (design D1). */
export interface StoredSettings {
  schemaVersion: 1;
  version: number;
  values: Record<string, unknown>;
  audit: Record<string, { updatedBy: string; updatedAt: string }>;
}

export const SETTINGS_KEY = { PK: 'CONFIG', SK: 'DESKTOP_SETTINGS' } as const;
const TABLE = () => process.env.ROLEPERMS_TABLE!;

const defOf = (key: string) => DESKTOP_SETTINGS.find((d) => d.key === key);

/** ¿`value` es válido para la llave (tipo y límites)? */
export function isValidValue(def: SettingDef, value: unknown): boolean {
  if (def.type === 'boolean') return typeof value === 'boolean';
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (def.min === undefined || value >= def.min) &&
    (def.max === undefined || value <= def.max)
  );
}

/** Valores efectivos: guardados válidos sobre los por defecto (los inválidos se registran). */
export function effectiveSettings(stored?: Pick<StoredSettings, 'values'> | null): DesktopSettingsValues {
  const out: DesktopSettingsValues = {};
  for (const def of DESKTOP_SETTINGS) {
    const v = stored?.values?.[def.key];
    if (v !== undefined && !isValidValue(def, v)) {
      console.warn(JSON.stringify({ evt: 'desktop_setting_invalid', key: def.key }));
    }
    out[def.key] = v !== undefined && isValidValue(def, v) ? (v as number | boolean) : def.default;
  }
  return out;
}

/** Valida un `values` de PUT: llaves del catálogo y valores en límites. */
export function validateUpdate(values: unknown): { ok: true; values: DesktopSettingsValues } | { ok: false; error: string } {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, error: 'values inválido' };
  const entries = Object.entries(values as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: 'values vacío' };
  for (const [k] of entries) if (!defOf(k)) return { ok: false, error: `configuración desconocida: ${k}` };
  for (const [k, v] of entries) if (!isValidValue(defOf(k)!, v)) return { ok: false, error: `valor inválido: ${k}` };
  return { ok: true, values: values as DesktopSettingsValues };
}

/** Vista de administración (`GET /admin/desktop-settings`). */
export function adminView(stored: StoredSettings | null) {
  const eff = effectiveSettings(stored);
  return {
    version: stored?.version ?? 0,
    settings: DESKTOP_SETTINGS.map((d) => ({
      key: d.key,
      label: d.label,
      description: d.description,
      type: d.type,
      ...(d.min !== undefined ? { min: d.min } : {}),
      ...(d.max !== undefined ? { max: d.max } : {}),
      default: d.default,
      value: eff[d.key],
      updatedBy: stored?.audit?.[d.key]?.updatedBy ?? null,
      updatedAt: stored?.audit?.[d.key]?.updatedAt ?? null,
    })),
  };
}

export async function readSettings(): Promise<StoredSettings | null> {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE(), Key: { ...SETTINGS_KEY } }));
  return (Item as StoredSettings | undefined) ?? null;
}

/**
 * Guarda `values` sobre lo guardado si la versión sigue siendo `expected`
 * (concurrencia optimista). false = la configuración cambió (409).
 */
export async function writeSettings(
  current: StoredSettings | null,
  expected: number,
  values: DesktopSettingsValues,
  by: string,
  now = new Date(),
): Promise<StoredSettings | false> {
  const at = now.toISOString();
  const next: StoredSettings = {
    schemaVersion: 1,
    version: expected + 1,
    values: { ...(current?.values ?? {}), ...values },
    audit: { ...(current?.audit ?? {}) },
  };
  for (const k of Object.keys(values)) next.audit[k] = { updatedBy: by, updatedAt: at };
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE(),
        Item: { ...SETTINGS_KEY, ...next },
        ...(expected === 0
          ? { ConditionExpression: 'attribute_not_exists(PK)' }
          : { ConditionExpression: 'version = :v', ExpressionAttributeValues: { ':v': expected } }),
      }),
    );
    return next;
  } catch (e) {
    if ((e as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}
