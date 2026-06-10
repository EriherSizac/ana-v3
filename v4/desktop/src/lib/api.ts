// File: Pide presign, sube el CSV a S3 (dispara csvTrigger → tabla jobs).
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { currentToken } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await currentToken();
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export interface Conversation {
  chatId: string;
  contactName?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount?: number;
}

export interface Message {
  id: string;
  chatId: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  type: string;
  mediaKey?: string;
  mimetype?: string;
  filename?: string;
}

/** Presign GET para ver media de un mensaje (autz como la vista de conversación). */
export async function getMediaUrl(key: string): Promise<string> {
  const res = await fetch(`${API_BASE}/media/url?key=${encodeURIComponent(key)}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('no se pudo cargar la media');
  return (await res.json()).url;
}

// operatorId opcional: ver conversaciones de un agente (líder/admin).
export async function getConversations(operatorId?: string): Promise<Conversation[]> {
  const qs = operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : '';
  const res = await fetch(`${API_BASE}/conversations${qs}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('no se pudieron cargar conversaciones');
  return (await res.json()).conversations ?? [];
}

export async function getMessages(chatId: string, operatorId?: string): Promise<Message[]> {
  const qs = operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : '';
  const res = await fetch(
    `${API_BASE}/conversations/${encodeURIComponent(chatId)}/messages${qs}`,
    { headers: await authHeaders() },
  );
  if (!res.ok) throw new Error('no se pudieron cargar mensajes');
  return (await res.json()).messages ?? [];
}

export interface AgentEntry {
  campaign: string;
  operatorId: string;
  lastSeen: number;
  active: boolean;
}

export async function getCampaigns(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/agents/campaigns`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('no se pudieron cargar campañas');
  return (await res.json()).campaigns ?? [];
}

export async function getAgents(campaign?: string): Promise<AgentEntry[]> {
  const qs = campaign ? `?campaign=${encodeURIComponent(campaign)}` : '';
  const res = await fetch(`${API_BASE}/agents${qs}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('no se pudieron cargar agentes');
  return (await res.json()).agents ?? [];
}

/**
 * Registra en el CRM que el agente abrió/atendió este chat (como la ventana
 * manual de v3). Idempotente por chat/día en el backend. Fire-and-forget.
 */
export async function reportChatOpen(chatId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/interactions/open`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ chatId }),
    });
  } catch {
    /* no crítico para la UI */
  }
}

export interface ManualInteraction {
  chatId: string;
  subdictamen: string;
  comments?: string;
  contactable?: boolean;
  promiseDate?: string;
  promiseAmount?: number;
}

/** Registra una gestión manual en el CRM desde el chat. */
export async function reportManualInteraction(
  i: ManualInteraction,
): Promise<{ reported: boolean; creditId?: string }> {
  const res = await fetch(`${API_BASE}/interactions/manual`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(i),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'no se pudo registrar la gestión');
  }
  return await res.json();
}

// --- Líder/admin: send-jobs por campaña ---
export interface JobsOperatorSummary {
  operatorId: string;
  pending: number;
  leased: number;
  files: string[];
}

/** Pendientes por agente de una campaña (vista del líder). */
export async function getJobsSummary(
  campaign: string,
): Promise<{ total: number; operators: JobsOperatorSummary[] }> {
  const res = await fetch(
    `${API_BASE}/jobs/summary?campaign=${encodeURIComponent(campaign)}`,
    { headers: await authHeaders() },
  );
  if (!res.ok) throw new Error('no se pudo cargar el resumen de envíos');
  return await res.json();
}

/** Mueve los jobs pendientes de un agente a otro (agente desconectado, etc.). */
export async function reassignJobs(
  campaign: string,
  from: string,
  to: string,
): Promise<{ moved: number; skippedLeased: number }> {
  const res = await fetch(`${API_BASE}/jobs/reassign`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ campaign, from, to }),
  });
  if (!res.ok) throw new Error('no se pudieron reasignar los envíos');
  return await res.json();
}

// --- Admin: permisos por rol ---
export interface RoleSummary {
  role_id: string;
  role_name: string;
  campaign_name: string;
}

export async function getRoles(): Promise<RoleSummary[]> {
  const res = await fetch(`${API_BASE}/admin/roles`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('no se pudieron cargar los roles');
  return (await res.json()).roles ?? [];
}

export async function getRolePerms(roleId: string): Promise<string[]> {
  const res = await fetch(
    `${API_BASE}/admin/role-permissions/${encodeURIComponent(roleId)}`,
    { headers: await authHeaders() },
  );
  if (!res.ok) throw new Error('no se pudieron cargar permisos del rol');
  return (await res.json()).permissions ?? [];
}

export async function setRolePerms(roleId: string, permissions: string[]): Promise<void> {
  const res = await fetch(
    `${API_BASE}/admin/role-permissions/${encodeURIComponent(roleId)}`,
    { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ permissions }) },
  );
  if (!res.ok) throw new Error('no se pudieron guardar permisos');
}

export interface UserAccess {
  username: string;
  roleIds: string[];
  roleNames: string[];
  campaigns: string[];
  permissions: string[];
  isAdmin: boolean;
  isLeader: boolean;
}

export async function getMe(): Promise<UserAccess> {
  const res = await fetch(`${API_BASE}/me`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('no se pudo cargar el acceso');
  return (await res.json()).access;
}

export interface CampaignConfig {
  filename: string;
  template: string;
  countryCode: string;
  phoneColumn: string;
  campaignId: string;
  campaign?: string;
  distribute?: boolean;
  // Reparto explícito por pesos {operatorId: peso}; requiere distribute.
  assignments?: Record<string, number>;
}

/** Pide presign, sube el CSV a S3 (dispara csvTrigger → tabla jobs). */
export async function uploadCsv(file: File, cfg: CampaignConfig): Promise<void> {
  const presignRes = await fetch(`${API_BASE}/uploads/presign`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(cfg),
  });
  if (!presignRes.ok) throw new Error('no se pudo obtener presign');
  const { url } = await presignRes.json();

  // La metadata ya va firmada en la query del presigned URL (no como header).
  // Tampoco mandamos content-type (no está firmado) → evita mismatch de firma.
  const put = await fetch(url, { method: 'PUT', body: file });
  if (!put.ok) throw new Error(`falló la subida a S3 (${put.status})`);
}

/** Enmascara número para mostrar (regla: masking solo visual). */
export function maskPhone(jid: string): string {
  const digits = jid.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}
