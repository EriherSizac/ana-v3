// File: Aviso de asignación truncada en "Mi asignación" (v4-harden-send-job-queue).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

export interface AssignmentInfoLike {
  truncated: boolean;
  pendingTotal: number;
}

/**
 * Texto del aviso cuando el último poll trajo `truncated: true`; null sin truncado.
 * `received` = pendientes recibidos en ese poll.
 */
export function truncationNotice(info: AssignmentInfoLike | null | undefined, received: number): string | null {
  if (!info?.truncated) return null;
  return `Mostrando ${received} de ${info.pendingTotal} pendientes; envía los actuales para ver el resto.`;
}
