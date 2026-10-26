// File: ¿Se notifica POST /interactions/open al abrir un chat? (v4-add-desktop-remote-settings)
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/**
 * Solo en la propia sesión y con `openChatInteraction` en true. Sin
 * configuración leída el main entrega el default (false): no se notifica.
 */
export function shouldReportOpen(settings: { openChatInteraction?: boolean } | null | undefined, viewingOther: boolean): boolean {
  return !viewingOther && settings?.openChatInteraction === true;
}
