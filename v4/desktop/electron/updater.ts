// File: Auto-update obligatorio desde S3. Al arrancar, si hay versión nueva la UI se
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Auto-update obligatorio desde S3. Al arrancar, si hay versión nueva la UI se
 * bloquea (UpdateGate) mientras se descarga; luego reinstala y reinicia. No se
 * puede usar la app hasta estar al día.
 *
 * Eventos enviados al renderer (`update:status`):
 *  { phase: 'checking' | 'downloading' (+percent) | 'installing' | 'none' | 'error' }
 *
 * En dev (no empaquetado) se omite (no hay feed) → la UI se desbloquea sola.
 */
export function setupUpdater(win: BrowserWindow): void {
  const send = (s: Record<string, unknown>) => win.webContents.send('update:status', s);

  if (!app.isPackaged) {
    send({ phase: 'none' }); // dev: nada que actualizar
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send({ phase: 'checking' }));
  autoUpdater.on('update-available', (i) =>
    send({ phase: 'downloading', version: i.version, percent: 0 }),
  );
  autoUpdater.on('download-progress', (p) =>
    send({ phase: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', () => {
    send({ phase: 'installing' });
    // isSilent=true, isForceRunAfter=true → reinstala y reabre sin clicks.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
  });
  autoUpdater.on('update-not-available', () => send({ phase: 'none' }));
  // Un 404 del feed (latest.yml ausente) NO es un fallo bloqueante: significa
  // "no hay canal de updates publicado aún" → continuar como si estuviera al día.
  autoUpdater.on('error', (e) => {
    const msg = String(e);
    if (/404|latest\.yml|Not Found|ERR_FILE_NOT_FOUND/i.test(msg)) {
      send({ phase: 'none' });
      return;
    }
    send({ phase: 'error', message: msg });
  });

  autoUpdater.checkForUpdates().catch((e) => {
    const msg = String(e);
    if (/404|latest\.yml|Not Found|ERR_FILE_NOT_FOUND/i.test(msg)) {
      send({ phase: 'none' });
      return;
    }
    send({ phase: 'error', message: msg });
  });
}
