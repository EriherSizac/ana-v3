// File: preload
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // auth: el renderer (Amplify) pasa el token al main para poller/backend
  setAuthToken: (token: string | null) => ipcRenderer.invoke('auth:set-token', token),

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

  // Dispara el chequeo de update (el renderer lo llama tras montar el listener)
  checkUpdates: () => ipcRenderer.invoke('update:check'),

  // Estado del auto-update (gate obligatorio)
  onUpdateStatus: (cb: (data: any) => void) => {
    const fn = (_: unknown, d: any) => cb(d);
    ipcRenderer.on('update:status', fn);
    return () => ipcRenderer.removeListener('update:status', fn);
  },
};

contextBridge.exposeInMainWorld('ana', api);

export type AnaApi = typeof api;
