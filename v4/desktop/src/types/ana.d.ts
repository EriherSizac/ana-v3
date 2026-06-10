// File: ana.d
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Puente expuesto por electron/preload.ts (contextBridge `ana`).
export interface AnaBridge {
  setAuthToken: (token: string | null) => Promise<{ ok: boolean }>;
  registerAgent: (campaign: string) => Promise<{ ok: boolean }>;
  startWhatsApp: () => Promise<{ ok: boolean }>;
  stopWhatsApp: () => Promise<{ ok: boolean }>;
  resetWhatsApp: () => Promise<{ ok: boolean }>;
  getWaState: () => Promise<{ status: string; qr: string | null }>;
  sendReply: (jid: string, body: string) => Promise<{ ok: boolean; message?: any; error?: string }>;
  sendMedia: (
    jid: string,
    m: { dataBase64: string; mimetype: string; filename: string; caption?: string },
  ) => Promise<{ ok: boolean; message?: any; error?: string }>;
  setTyping: (jid: string, on: boolean) => Promise<{ ok: boolean }>;
  onWaEvent: (cb: (data: any) => void) => () => void;
  onWaMessage: (cb: (data: any) => void) => () => void;
  onWaSent: (cb: (data: any) => void) => () => void;
  onWaProgress: (cb: (data: SendProgress) => void) => () => void;
  onJobsAssignment: (cb: (jobs: AssignedJob[]) => void) => () => void;
  approveJobs: (
    jobIds: string[],
    template?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  getAssignment: () => Promise<AssignedJob[]>;
  checkUpdates: () => Promise<{ ok: boolean }>;
  onUpdateStatus: (cb: (data: UpdateStatus) => void) => () => void;
}

// Job asignado al agente (lo publica el poller del main). status separa
// pendientes (por enviar) de historial (sent/no_whatsapp/error).
export interface AssignedJob {
  jobId: string;
  campaignId: string;
  campaign?: string;
  phone: string;
  template: string;
  row: Record<string, string>;
  countryCode: string;
  srcKey: string;
  status?: 'pending' | 'leased' | 'sent' | 'no_whatsapp' | 'error';
  sentAt?: number;
  auto?: boolean;
}

export interface SendProgress {
  phase: 'idle' | 'sending' | 'waiting' | 'fileDone';
  campaignId?: string;
  total?: number;
  done?: number;
  sent?: number;
  failed?: number;
  waitMs?: number;
  phone?: string;
}

export interface UpdateStatus {
  phase: 'checking' | 'downloading' | 'installing' | 'none' | 'error';
  percent?: number;
  version?: string;
  message?: string;
}

declare global {
  interface Window {
    ana: AnaBridge;
  }
}

export {};
