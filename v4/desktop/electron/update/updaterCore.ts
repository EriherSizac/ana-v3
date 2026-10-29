// File: Núcleo del auto-update (puro: sin Electron; el updater se inyecta).
// Created: 2026-10-26
// Updated: 2026-10-29
// Author: Erick Hernández Silva

/**
 * Estado y listeners del updater, registrados UNA sola vez por proceso.
 * Si el renderer vuelve a pedir el chequeo (recarga), solo se re-emite la
 * última fase conocida, sin nuevos listeners ni intervalos.
 *
 * Fases enviadas al renderer (`update:status`):
 *  checking | downloading (+percent) | installing (+waitingForJob) | restarting (+secondsLeft)
 *  | none (+bypass) | error (+message)
 *
 * Arranque vs sesión (add-in-session-updates D9): hasta la primera fase `none`
 * rige la pantalla bloqueante de siempre. Después (`inSession`), una versión
 * nueva es obligatoria pero no bloquea: deja de tomar jobs al detectarla,
 * descarga, espera el job en curso (≤ 3 min), cuenta 60 s (`restarting`) e
 * instala en silencio reabriendo la app. Un error ahí reanuda los jobs.
 */

export interface UpdateStatus {
  phase: 'checking' | 'downloading' | 'installing' | 'restarting' | 'none' | 'error';
  percent?: number;
  version?: string;
  message?: string;
  /** installing: esperando a que termine el job en curso. */
  waitingForJob?: boolean;
  /** none por acceso de emergencia de Sistemas (sin actualizar). */
  bypass?: boolean;
  /** Actualización a media sesión (aviso no bloqueante en el renderer). */
  inSession?: boolean;
  /** restarting: segundos para reiniciar e instalar. */
  secondsLeft?: number;
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
  /** Vuelve a tomar jobs (la actualización a media sesión falló). */
  resumeJobs?: () => void;
}

export interface UpdaterCoreDeps {
  updater: UpdaterLike;
  isPackaged: boolean;
  setInterval?: (fn: () => void, ms: number) => unknown;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

export const CHECK_EVERY_MS = 30 * 60 * 1000; // chequeo periódico cada 30 min
export const MAX_JOB_WAIT_MS = 3 * 60 * 1000; // espera máxima del job en curso
export const RESTART_COUNTDOWN_S = 60; // cuenta regresiva antes de instalar a media sesión
export const RELEASE_JITTER_MS = 30_000; // espera aleatoria tras release.available
const FEED_MISSING = /404|latest\.yml|Not Found|ERR_FILE_NOT_FOUND/i;

export class UpdaterCore {
  private initialized = false;
  private last: UpdateStatus | null = null;
  private bypassed = false;
  private send: (s: UpdateStatus) => void = () => {};
  private hooks: InstallHooks = {};
  /** Ya pasó la pantalla de arranque: lo siguiente es "a media sesión". */
  private inSession = false;
  /** Actualización a media sesión en curso (detectada → instalada). */
  private sessionBusy = false;
  private version: string | undefined;
  private soon = false;

  constructor(private deps: UpdaterCoreDeps) {}

  private sleep(ms: number) {
    return new Promise<void>((r) => (this.deps.setTimeout ?? setTimeout)(r, ms));
  }

  private emit(s: UpdateStatus) {
    this.last = s;
    // La primera fase `none` cierra la pantalla de arranque.
    if (s.phase === 'none') this.inSession = true;
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
      // Con acceso de emergencia activo o a media sesión, un chequeo no bloquea la UI.
      if (!this.bypassed && !this.inSession) this.emit({ phase: 'checking' });
    });
    u.on('update-available', (i: { version?: string }) => {
      this.version = i?.version;
      if (this.inSession) {
        // Obligatoria y sin posponer: deja de tomar jobs desde ya.
        this.sessionBusy = true;
        this.hooks.pauseNewJobs?.();
        this.emit({ phase: 'downloading', version: this.version, percent: 0, inSession: true });
        return;
      }
      this.emit({ phase: 'downloading', version: i?.version, percent: 0 });
    });
    u.on('download-progress', (p: { percent: number }) =>
      this.emit(
        this.inSession
          ? { phase: 'downloading', version: this.version, percent: Math.round(p?.percent ?? 0), inSession: true }
          : { phase: 'downloading', percent: Math.round(p?.percent ?? 0) },
      ),
    );
    u.on('update-downloaded', () => void (this.inSession ? this.installInSession() : this.installWhenIdle()));
    u.on('update-not-available', () => {
      if (this.inSession && !this.sessionBusy) return; // nada que mostrar a media sesión
      this.emit({ phase: 'none' });
    });
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

  /**
   * Chequeo inmediato (reanudación del equipo o aviso realtime
   * `release.available`). Se ignora si ya hay una actualización en curso.
   */
  checkNow(): boolean {
    if (!this.initialized || !this.deps.isPackaged || this.sessionBusy) return false;
    void this.check();
    return true;
  }

  /**
   * Aviso realtime `release.available`: chequeo tras una espera aleatoria
   * (0–30 s) para que la flota no consulte el feed a la vez; agrupa avisos.
   */
  checkSoon(maxDelayMs = RELEASE_JITTER_MS, random: () => number = Math.random): void {
    if (this.soon || this.sessionBusy) return;
    this.soon = true;
    (this.deps.setTimeout ?? setTimeout)(() => {
      this.soon = false;
      this.checkNow();
    }, Math.round(random() * maxDelayMs));
  }

  /** ¿Hay una actualización a media sesión en curso? */
  isUpdatingInSession(): boolean {
    return this.sessionBusy;
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
    if (this.inSession) {
      // A media sesión nunca se bloquea: si había descarga en curso, se
      // reanudan los jobs y se avisa; un chequeo fallido solo se registra.
      if (!this.sessionBusy) {
        if (!FEED_MISSING.test(msg)) console.warn('[updater] chequeo a media sesión falló:', msg);
        return;
      }
      this.sessionBusy = false;
      this.hooks.resumeJobs?.();
      this.emit({ phase: 'error', version: this.version, message: msg, inSession: true });
      return;
    }
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

  /**
   * A media sesión: los jobs ya están en pausa; espera el job en curso (máx
   * 3 min), cuenta 60 s, cierra WhatsApp e instala en silencio reabriendo la app.
   */
  private async installInSession() {
    const h = this.hooks;
    const version = this.version;
    h.pauseNewJobs?.();
    const busy = h.hasJobInFlight?.() ?? false;
    if (busy) {
      this.emit({ phase: 'installing', version, waitingForJob: true, inSession: true });
      try {
        await h.waitIdle?.(MAX_JOB_WAIT_MS);
      } catch {
        /* se instala igual */
      }
    }
    for (let s = RESTART_COUNTDOWN_S; s > 0; s--) {
      this.emit({ phase: 'restarting', version, secondsLeft: s, inSession: true });
      await this.sleep(1000);
    }
    this.emit({ phase: 'installing', version, waitingForJob: false, inSession: true });
    try {
      await h.beforeInstall?.();
    } catch {
      /* aun así intentamos instalar */
    }
    // isSilent=true → sin asistente; isForceRunAfter=true → reabre la app.
    this.deps.updater.quitAndInstall(true, true);
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
