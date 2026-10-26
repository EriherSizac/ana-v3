// File: Núcleo del auto-update (puro: sin Electron; el updater se inyecta).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/**
 * Estado y listeners del updater, registrados UNA sola vez por proceso.
 * Si el renderer vuelve a pedir el chequeo (recarga), solo se re-emite la
 * última fase conocida, sin nuevos listeners ni intervalos.
 *
 * Fases enviadas al renderer (`update:status`):
 *  checking | downloading (+percent) | installing (+waitingForJob) | none (+bypass) | error (+message)
 */

export interface UpdateStatus {
  phase: 'checking' | 'downloading' | 'installing' | 'none' | 'error';
  percent?: number;
  version?: string;
  message?: string;
  /** installing: esperando a que termine el job en curso. */
  waitingForJob?: boolean;
  /** none por acceso de emergencia de Sistemas (sin actualizar). */
  bypass?: boolean;
}

/** Lo mínimo de electron-updater que se usa (inyectable en pruebas). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface InstallHooks {
  /** Deja de iniciar jobs nuevos. */
  pauseNewJobs?: () => void;
  /** ¿Hay un job enviándose? */
  hasJobInFlight?: () => boolean;
  /** Espera a que termine el job en curso (máx `ms`). */
  waitIdle?: (ms: number) => Promise<void>;
  /** Cierra WhatsApp/Chromium antes de instalar. */
  beforeInstall?: () => Promise<void>;
}

export interface UpdaterCoreDeps {
  updater: UpdaterLike;
  isPackaged: boolean;
  setInterval?: (fn: () => void, ms: number) => unknown;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

export const CHECK_EVERY_MS = 30 * 60 * 1000; // chequeo periódico cada 30 min
export const MAX_JOB_WAIT_MS = 3 * 60 * 1000; // espera máxima del job en curso
const FEED_MISSING = /404|latest\.yml|Not Found|ERR_FILE_NOT_FOUND/i;

export class UpdaterCore {
  private initialized = false;
  private last: UpdateStatus | null = null;
  private bypassed = false;
  private send: (s: UpdateStatus) => void = () => {};
  private hooks: InstallHooks = {};

  constructor(private deps: UpdaterCoreDeps) {}

  private emit(s: UpdateStatus) {
    this.last = s;
    this.send(s);
  }

  /** Última fase emitida (o null si aún no hay). */
  lastStatus(): UpdateStatus | null {
    return this.last;
  }

  /**
   * Registra listeners + intervalo la primera vez; después solo actualiza el
   * destino de los eventos y re-emite la última fase conocida.
   */
  setup(send: (s: UpdateStatus) => void, hooks: InstallHooks = {}): void {
    this.send = send;
    this.hooks = hooks;
    if (this.initialized) {
      if (this.last) send(this.last);
      return;
    }
    this.initialized = true;

    if (!this.deps.isPackaged) {
      this.emit({ phase: 'none' }); // dev: nada que actualizar
      return;
    }

    const u = this.deps.updater;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;

    u.on('checking-for-update', () => {
      // Con acceso de emergencia activo, un chequeo periódico no re-bloquea la UI.
      if (!this.bypassed) this.emit({ phase: 'checking' });
    });
    u.on('update-available', (i: { version?: string }) =>
      this.emit({ phase: 'downloading', version: i?.version, percent: 0 }),
    );
    u.on('download-progress', (p: { percent: number }) =>
      this.emit({ phase: 'downloading', percent: Math.round(p?.percent ?? 0) }),
    );
    u.on('update-downloaded', () => void this.installWhenIdle());
    u.on('update-not-available', () => this.emit({ phase: 'none' }));
    // Un 404 del feed (latest.yml ausente) = "no hay canal publicado" → none.
    u.on('error', (e: unknown) => this.onError(e));

    void this.check();
    (this.deps.setInterval ?? setInterval)(() => void this.check(), CHECK_EVERY_MS);
  }

  /** Reintento manual o automático desde la pantalla de error. */
  retry(): void {
    if (!this.initialized || !this.deps.isPackaged) return;
    void this.check();
  }

  /** Acceso de emergencia validado: desbloquea solo este proceso (no se persiste). */
  markBypassed(): void {
    this.bypassed = true;
    this.emit({ phase: 'none', bypass: true });
  }

  isBypassed(): boolean {
    return this.bypassed;
  }

  private onError(e: unknown) {
    const msg = String(e);
    if (FEED_MISSING.test(msg)) {
      if (!this.bypassed) this.emit({ phase: 'none' });
      return;
    }
    // Con bypass activo no se vuelve a bloquear por un error del chequeo periódico.
    if (this.bypassed) {
      console.warn('[updater] error con acceso de emergencia activo:', msg);
      return;
    }
    this.emit({ phase: 'error', message: msg });
  }

  private async check() {
    try {
      await this.deps.updater.checkForUpdates();
    } catch (e) {
      this.onError(e);
    }
  }

  /** Deja de iniciar jobs, espera el job en curso (máx 3 min) y luego instala. */
  private async installWhenIdle() {
    const h = this.hooks;
    h.pauseNewJobs?.();
    const busy = h.hasJobInFlight?.() ?? false;
    this.emit({ phase: 'installing', waitingForJob: busy });
    if (busy) {
      try {
        await h.waitIdle?.(MAX_JOB_WAIT_MS);
      } catch {
        /* se instala igual */
      }
      this.emit({ phase: 'installing', waitingForJob: false });
    }
    // Cierra WhatsApp/Chromium ANTES de instalar: si sigue vivo, bloquea los
    // archivos y el instalador NSIS se cuelga.
    try {
      await h.beforeInstall?.();
    } catch {
      /* aun así intentamos instalar */
    }
    // isSilent=false → instalador visible; isForceRunAfter=true → reabre la app.
    (this.deps.setTimeout ?? setTimeout)(() => this.deps.updater.quitAndInstall(false, true), 500);
  }
}
