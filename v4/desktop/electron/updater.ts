// File: Auto-update obligatorio desde S3 (adaptador Electron de update/updaterCore).
// Created: 2026-06-10
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UpdaterCore, type InstallHooks } from './update/updaterCore';

/**
 * Auto-update obligatorio desde S3. Al arrancar, si hay versión nueva la UI se
 * bloquea (UpdateGate) mientras se descarga; luego espera el job en curso,
 * reinstala y reinicia. No se puede usar la app hasta estar al día, salvo el
 * acceso de emergencia de Sistemas (update/bypass.ts) cuando el chequeo falla.
 *
 * Los listeners y el intervalo se registran UNA vez por proceso (UpdaterCore);
 * si el renderer se recarga y vuelve a pedir el chequeo, solo se re-emite la
 * última fase. En dev (no empaquetado) se emite `none` sin consultar el feed.
 */
let core: UpdaterCore | null = null;
let target: BrowserWindow | null = null;

function getCore(): UpdaterCore {
  if (!core) core = new UpdaterCore({ updater: autoUpdater, isPackaged: app.isPackaged });
  return core;
}

export function setupUpdater(win: BrowserWindow, hooks: InstallHooks = {}): void {
  target = win;
  getCore().setup((s) => {
    if (target && !target.isDestroyed()) target.webContents.send('update:status', s);
  }, hooks);
}

/** Reintento del chequeo (botón "Reintentar" o reintento automático de 60 s). */
export function retryUpdate(): void {
  getCore().retry();
}

/** Desbloquea esta sesión del proceso (acceso de emergencia validado). */
export function markUpdateBypassed(): void {
  getCore().markBypassed();
}

/** Última fase emitida (para decidir si el bypass aplica). */
export function lastUpdateStatus() {
  return getCore().lastStatus();
}
