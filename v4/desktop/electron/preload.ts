// File: preload
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // auth: el renderer (Amplify) pasa el token al main para poller/backend
  // opts.reason = 'expired' → sesión no renovable (no borra WhatsApp local).
  setAuthToken: (token: string | null, opts?: { reason?: 'expired' }) =>
    ipcRenderer.invoke('auth:set-token', token, opts),
  // El main pide un token renovado (al suyo le quedan < 2 min o recibió 401).
  onTokenRequest: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on('auth:token-request', fn);
    return () => ipcRenderer.removeListener('auth:token-request', fn);
  },
  // Respuesta a onTokenRequest (null = no se pudo renovar ahora).
  provideToken: (token: string | null) => ipcRenderer.invoke('auth:provide-token', token),
  onAuthExpired: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on('auth:expired', fn);
    return () => ipcRenderer.removeListener('auth:expired', fn);
  },

  // registra la campaña del agente (para heartbeat → reparto del líder)
  registerAgent: (campaign: string) => ipcRenderer.invoke('agent:register', campaign),

  // WhatsApp
  startWhatsApp: () => ipcRenderer.invoke('wa:start'),
  stopWhatsApp: () => ipcRenderer.invoke('wa:stop'),
  resetWhatsApp: () => ipcRenderer.invoke('wa:reset'),
  getWaState: () => ipcRenderer.invoke('wa:get-state'),
  sendReply: (jid: string, body: string) => ipcRenderer.invoke('wa:send-reply', jid, body),
  sendMedia: (
    jid: string,
    m: { dataBase64: string; mimetype: string; filename: string; caption?: string },
  ) => ipcRenderer.invoke('wa:send-media', jid, m),
  setTyping: (jid: string, on: boolean) => ipcRenderer.invoke('wa:typing', jid, on),

  onWaEvent: (cb: (data: any) => void) => {
    const fn = (_: unknown, d: any) => cb(d);
    ipcRenderer.on('wa:event', fn);
    return () => ipcRenderer.removeListener('wa:event', fn);
  },
  onWaMessage: (cb: (data: any) => void) => {
    const fn = (_: unknown, d: any) => cb(d);
    ipcRenderer.on('wa:message', fn);
    return () => ipcRenderer.removeListener('wa:message', fn);
  },
  onWaSent: (cb: (data: any) => void) => {
    const fn = (_: unknown, d: any) => cb(d);
    ipcRenderer.on('wa:sent', fn);
    return () => ipcRenderer.removeListener('wa:sent', fn);
  },
  onWaProgress: (cb: (data: any) => void) => {
    const fn = (_: unknown, d: any) => cb(d);
    ipcRenderer.on('wa:progress', fn);
    return () => ipcRenderer.removeListener('wa:progress', fn);
  },

  // Asignación de envíos pendientes (vista "Mi asignación")
  onJobsAssignment: (cb: (jobs: any[]) => void) => {
    const fn = (_: unknown, d: any[]) => cb(d);
    ipcRenderer.on('jobs:assignment', fn);
    return () => ipcRenderer.removeListener('jobs:assignment', fn);
  },
  // templates: plantilla aprobada por archivo (clave srcKey o campaignId).
  approveJobs: (jobIds: string[], templates: Record<string, string>) =>
    ipcRenderer.invoke('jobs:approve', jobIds, templates),
  getAssignment: () => ipcRenderer.invoke('jobs:get-assignment'),

  // Dispara el chequeo de update (el renderer lo llama tras montar el listener)
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  // Reintenta el chequeo tras un error (botón o cada 60 s).
  retryUpdate: () => ipcRenderer.invoke('update:retry'),
  // Acceso de emergencia de Sistemas (contraseña maestra verificada en el main).
  getUpdateBypassStatus: () => ipcRenderer.invoke('update:bypass-status'),
  tryUpdateBypass: (password: string) => ipcRenderer.invoke('update:bypass', password),

  // Estado del auto-update (gate obligatorio)
  onUpdateStatus: (cb: (data: any) => void) => {
    const fn = (_: unknown, d: any) => cb(d);
    ipcRenderer.on('update:status', fn);
    return () => ipcRenderer.removeListener('update:status', fn);
  },
};

contextBridge.exposeInMainWorld('ana', api);

export type AnaApi = typeof api;
