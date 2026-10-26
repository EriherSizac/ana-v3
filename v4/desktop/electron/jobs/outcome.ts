// File: Mapeo puro de la resolución del teléfono al resultado del job.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/** Resultado de `WaClient.resolveJid`: inválido ≠ sin WhatsApp. */
export type ResolveResult =
  | { kind: 'invalid' }
  | { kind: 'not_on_whatsapp' }
  | { kind: 'ok'; jid: string };

export const INVALID_PHONE_ERROR = 'Teléfono inválido';
export const NO_WHATSAPP_ERROR = 'No tiene WhatsApp';

/**
 * Qué hacer antes de enviar según la resolución. `null` = continuar con el envío.
 * Un teléfono inválido termina en `error` (se reporta `error`, NUNCA
 * `no_whatsapp`, para no marcar el teléfono sin WhatsApp en el CRM).
 */
export function outcomeForResolve(r: ResolveResult):
  | null
  | { success: false; error: string; noWhatsapp: boolean; report: 'no_whatsapp' | 'error' } {
  if (r.kind === 'ok') return null;
  if (r.kind === 'invalid')
    return { success: false, error: INVALID_PHONE_ERROR, noWhatsapp: false, report: 'error' };
  return { success: false, error: NO_WHATSAPP_ERROR, noWhatsapp: true, report: 'no_whatsapp' };
}
