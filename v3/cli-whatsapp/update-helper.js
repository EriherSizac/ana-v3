/**
 * Ayudante de instalación desacoplado (add-in-session-updates D4/D5/D6).
 *
 *  - `resolveInstallLayout`: carpeta de la instalación portable de Inno
 *    (`{app}\nodejs\node.exe` → `{app}\ANA.bat`); null fuera de ella.
 *  - `relaunchArgs`: solo indicadores `--nombre` (sin `--reset-*`/`--logout`).
 *  - `buildHelperScript`: script PowerShell que espera a que termine el CLI,
 *    corre el instalador en silencio, registra en `update.log`, escribe
 *    `update-result.json` y reabre ANA. Todo valor va como literal entre
 *    comillas simples (nunca interpretado por un shell).
 *  - `readPreviousResult`: lee y borra el resultado de la actualización anterior.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export const UPDATE_LOG = 'update.log';
export const UPDATE_RESULT = 'update-result.json';
export const INSTALLER_ARGS = Object.freeze(['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS']);
export const WAIT_PID_SECONDS = 180;
export const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * @param {{ execPath: string, isPkg: boolean, exists?: (p: string) => boolean }} o
 * @returns {{ appDir: string, launcher: string } | null}
 */
export function resolveInstallLayout({ execPath, isPkg, exists = fs.existsSync, pathImpl = path.win32 }) {
  if (isPkg || !execPath) return null;
  const nodeDir = pathImpl.dirname(execPath);
  if (pathImpl.basename(nodeDir).toLowerCase() !== 'nodejs') return null;
  const appDir = pathImpl.dirname(nodeDir);
  const launcher = pathImpl.join(appDir, 'ANA.bat');
  if (!exists(launcher) || !exists(pathImpl.join(appDir, 'app', 'index.js'))) return null;
  return { appDir, launcher };
}

const ONE_SHOT = /^--(reset-|logout$)/;

/** Indicadores que se reenvían al reabrir (`process.argv.slice(2)`). */
export function relaunchArgs(argv = []) {
  return argv.filter((a) => typeof a === 'string' && /^--[a-z0-9][a-z0-9-]*$/i.test(a) && !ONE_SHOT.test(a));
}

/**
 * Literal de PowerShell entre comillas simples. PowerShell también trata como
 * comilla simple ‘ ’ ‚ ‛, así que se duplican igual. NUL y saltos de línea se
 * rechazan (ninguna ruta o versión válida los trae).
 */
export function psLiteral(value) {
  const s = String(value ?? '');
  if (/[\u0000\r\n]/.test(s)) throw new Error('Valor inválido para el ayudante de actualización');
  return `'${s.replace(/['‘’‚‛]/g, (c) => c + c)}'`;
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * @param {{ pid: number, installer: string, launcher: string, appDir: string, args?: string[],
 *   logPath: string, resultPath: string, installLogPath: string, version: string, fromVersion: string }} o
 */
export function buildHelperScript(o) {
  if (!Number.isSafeInteger(o.pid) || o.pid <= 0) throw new Error('PID inválido');
  if (!VERSION_RE.test(String(o.version))) throw new Error('Versión destino inválida');
  const from = VERSION_RE.test(String(o.fromVersion)) ? o.fromVersion : '0.0.0';
  const args = relaunchArgs(o.args || []);
  for (const k of ['installer', 'launcher', 'appDir', 'logPath', 'resultPath', 'installLogPath']) {
    if (!o[k] || typeof o[k] !== 'string') throw new Error(`Falta ${k}`);
  }
  const L = psLiteral;
  const argsList = args.length ? `@(${args.map(L).join(', ')})` : '@()';
  const installerArgs = INSTALLER_ARGS.map(L).join(', ');
  return [
    '# Ayudante de actualizacion de ANA (add-in-session-updates). Generado por el CLI.',
    "$ErrorActionPreference = 'Continue'",
    `$log = ${L(o.logPath)}`,
    'function Log([string]$m) { try { Add-Content -LiteralPath $log -Value ("[" + (Get-Date).ToString("s") + "] " + $m) -Encoding UTF8 } catch {} }',
    `$cliPid = ${o.pid}`,
    `$installer = ${L(o.installer)}`,
    `$launcher = ${L(o.launcher)}`,
    `$appDir = ${L(o.appDir)}`,
    `$resultPath = ${L(o.resultPath)}`,
    `$installLog = ${L(o.installLogPath)}`,
    `$target = ${L(o.version)}`,
    `$from = ${L(from)}`,
    `$relaunchArgs = ${argsList}`,
    'Log ("Actualizacion " + $from + " -> " + $target + ": esperando que termine ANA (PID " + $cliPid + ")")',
    `try { Wait-Process -Id $cliPid -Timeout ${WAIT_PID_SECONDS} -ErrorAction SilentlyContinue } catch {}`,
    'if (Get-Process -Id $cliPid -ErrorAction SilentlyContinue) {',
    `  Log 'ANA no termino en ${WAIT_PID_SECONDS} s; se fuerza el cierre'`,
    '  try { Stop-Process -Id $cliPid -Force -ErrorAction SilentlyContinue } catch {}',
    '}',
    'Start-Sleep -Seconds 2',
    '$code = -1',
    'try {',
    `  $instArgs = @(${installerArgs}, ('/LOG="' + $installLog + '"'))`,
    '  Log "Ejecutando instalador en modo silencioso"',
    '  $p = Start-Process -FilePath $installer -ArgumentList $instArgs -PassThru',
    '  $null = $p.Handle',
    `  if ($p.WaitForExit(${INSTALL_TIMEOUT_MS})) { $code = $p.ExitCode } else { Log 'El instalador no termino en 15 min; se detiene'; try { $p.Kill() } catch {}; $code = -2 }`,
    '} catch { Log ("No se pudo ejecutar el instalador: " + $_.Exception.Message); $code = -3 }',
    '$ok = ($code -eq 0)',
    'Log ("Instalador termino con codigo " + $code)',
    'try { [ordered]@{ ok = $ok; version = $target; from = $from; exitCode = $code; at = (Get-Date).ToString("o"); installLog = $installLog } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8 } catch { Log "No se pudo escribir el resultado" }',
    'if ($ok) { try { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue } catch {} }',
    'try {',
    '  if ($relaunchArgs.Count -gt 0) { Start-Process -FilePath $launcher -ArgumentList $relaunchArgs -WorkingDirectory $appDir }',
    '  else { Start-Process -FilePath $launcher -WorkingDirectory $appDir }',
    '  Log "ANA reabierto"',
    '} catch { Log ("No se pudo reabrir ANA: " + $_.Exception.Message) }',
    '',
  ].join('\r\n');
}

/** Comando del ayudante (oculto, sin perfil); el script va como archivo, no como texto. */
export function helperCommand(scriptPath) {
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
  };
}

/** Escribe el script en una carpeta temporal nueva (UTF-8 con BOM: rutas con acentos en PowerShell 5.1). */
export function writeHelperScript(content, { tmpDir = os.tmpdir() } = {}) {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'ana-upd-'));
  const file = path.join(dir, 'apply-update.ps1');
  fs.writeFileSync(file, `﻿${content}`, 'utf-8');
  return file;
}

/**
 * Lanza el ayudante desacoplado. Resuelve cuando el proceso arrancó; rechaza
 * si no se pudo lanzar (el CLI entonces no se cierra).
 */
export function spawnHelper(scriptPath, { spawn }) {
  const { command, args } = helperCommand(scriptPath);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child);
    });
  });
}

/** Resultado de la actualización anterior (y lo borra), o null. */
export function readPreviousResult(dataDir, { fsImpl = fs } = {}) {
  const file = path.join(dataDir, UPDATE_RESULT);
  try {
    if (!fsImpl.existsSync(file)) return null;
    const raw = String(fsImpl.readFileSync(file, 'utf-8') || '').replace(/^﻿/, '');
    try {
      fsImpl.unlinkSync(file);
    } catch {
      /* se intenta de nuevo al siguiente arranque */
    }
    const r = JSON.parse(raw);
    return {
      ok: r.ok === true,
      version: String(r.version || ''),
      from: String(r.from || ''),
      exitCode: Number.isFinite(Number(r.exitCode)) ? Number(r.exitCode) : null,
      at: String(r.at || ''),
    };
  } catch {
    return null;
  }
}

/** Línea para `update.log` desde el CLI (antes de lanzar el ayudante). */
export function appendUpdateLog(dataDir, message, { fsImpl = fs, now = () => new Date() } = {}) {
  try {
    fsImpl.mkdirSync(dataDir, { recursive: true });
    fsImpl.appendFileSync(path.join(dataDir, UPDATE_LOG), `[${now().toISOString()}] ${message}\r\n`, 'utf-8');
  } catch {
    /* el registro no debe romper la actualización */
  }
}
