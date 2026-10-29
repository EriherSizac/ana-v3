import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { compareVersions, fetchManifest, DEFAULT_MANIFEST_URL } from './update-manifest.js';
import { downloadVerified } from './update-download.js';

const isPkg = typeof process.pkg !== 'undefined';

const renderProgressBar = (pct) => {
  const clamped = Math.max(0, Math.min(100, Math.floor(pct || 0)));
  const width = 20;
  const filled = Math.round((clamped / 100) * width);
  const bar = `${'#'.repeat(filled)}${'.'.repeat(Math.max(0, width - filled))}`;
  return `${String(clamped).padStart(3, ' ')}% [${bar}]`;
};

const writeUpdaterScript = (payload) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-upd-'));
  const scriptPath = path.join(tmp, 'apply-update.ps1');

  const content = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$source = "${payload.source.replace(/"/g, '""')}"`,
    `$target = "${payload.target.replace(/"/g, '""')}"`,
    `$argsLine = "${payload.argsLine.replace(/"/g, '""')}"`,
    'Start-Sleep -Milliseconds 500',
    'for ($i=0; $i -lt 90; $i++) {',
    '  try {',
    '    if (Test-Path -LiteralPath $target) {',
    '      try { Move-Item -LiteralPath $target -Destination ($target + ".bak") -Force } catch {}',
    '    }',
    '    Move-Item -LiteralPath $source -Destination $target -Force',
    '    break',
    '  } catch {',
    '    Start-Sleep -Milliseconds 500',
    '  }',
    '}',
    'try { Start-Process -FilePath $target -ArgumentList $argsLine -WorkingDirectory (Split-Path -Parent $target) } catch {}',
  ].join('\r\n');

  fs.writeFileSync(scriptPath, content, 'utf-8');
  return scriptPath;
};

const readLocalPackageVersion = () => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, 'package.json');
    if (!fs.existsSync(pkgPath)) return '';
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const cleaned = String(raw || '').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned);
    return String(parsed?.version || '').trim();
  } catch (_) {
    return '';
  }
};

/** Versión del CLI (inyectada en el bundle o de package.json); 'unknown' si no se puede leer. */
export const getCliVersion = () => String(process.env.ANA_VERSION || readLocalPackageVersion() || 'unknown').trim();

const writeLaunchInstallerScript = (payload) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-upd-'));
  const scriptPath = path.join(tmp, 'launch-installer.ps1');

  const content = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$installer = "${payload.installer.replace(/"/g, '""')}"`,
    'try { Start-Process -FilePath $installer -WorkingDirectory (Split-Path -Parent $installer) } catch {}',
  ].join('\r\n');

  fs.writeFileSync(scriptPath, content, 'utf-8');
  return scriptPath;
};

export async function checkForUpdatesAndApply(options = {}) {
  const manifestUrl = String(options.manifestUrl || process.env.ANA_UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL || '').trim();
  if (!manifestUrl) {
    if (options?.log !== false) console.log('🔄 Auto-update: sin manifestUrl, saltando');
    return false;
  }

  const currentVersion = String(process.env.ANA_VERSION || readLocalPackageVersion() || '0.0.0');
  if (compareVersions(currentVersion, '0.0.0') <= 0) {
    if (options?.log !== false) console.log('🔄 Auto-update: no se pudo determinar versión local, saltando');
    return false;
  }

  if (options?.log !== false) {
    console.log(`🔄 Auto-update: versión actual ${currentVersion}`);
    console.log(`🔄 Auto-update: manifest ${manifestUrl}`);
  }

  let manifest;
  try {
    // BOM, HTML, versión y url https; sha256/size opcionales (update-manifest.js).
    manifest = await fetchManifest(manifestUrl);
  } catch (e) {
    if (options?.log !== false) console.error('⚠️  Auto-update: error leyendo manifest:', e?.message || e);
    return false;
  }

  const safeLatestVersion = manifest.version;
  if (options?.log !== false) console.log(`🔄 Auto-update: versión remota ${safeLatestVersion}`);
  // Nunca downgrade: solo una versión estrictamente mayor.
  if (compareVersions(safeLatestVersion, currentVersion) <= 0) {
    if (options?.log !== false) console.log('🔄 Auto-update: no hay actualización disponible');
    return false;
  }

  const url = manifest.url;

  const tmpExeRaw = path.join(os.tmpdir(), `ANA-${safeLatestVersion}.exe`);
  const tmpExe = String(tmpExeRaw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[\\/\s]+$/g, '');
  if (options?.log !== false) {
    console.log('🔄 Auto-update: tmpExe(raw)=', JSON.stringify(tmpExeRaw));
    console.log('🔄 Auto-update: tmpExe(clean)=', JSON.stringify(tmpExe));
  }

  try {
    if (options?.log !== false) console.log(`⬇️  Auto-update: descargando update desde ${url}`);
    const isInteractive = Boolean(process.stdout && process.stdout.isTTY);
    // Tamaño y SHA-256 verificados (si el manifiesto trae sha256); si no cuadran, no se instala.
    await downloadVerified({ url, dest: tmpExe, expectedSize: manifest.size, expectedSha256: manifest.sha256, onProgress: ({ pct }) => {
      if (!isInteractive) {
        if (pct % 5 !== 0) return;
        console.log(`⬇️  Descargando update: ${pct}%`);
        return;
      }
      process.stdout.write(`\r⬇️  Descargando update: ${renderProgressBar(pct)}   `);
      if (pct >= 100) process.stdout.write('\n');
    } });
    if (options?.log !== false) console.log(`⬇️  Auto-update: descarga completa -> ${tmpExe}`);
  } catch (e) {
    try {
      if (fs.existsSync(tmpExe)) fs.unlinkSync(tmpExe);
    } catch (_) {}
    if (options?.log !== false) console.error('⚠️  Auto-update: error descargando update:', e?.message || e);
    return false;
  }

  if (isPkg) {
    const exePath = process.execPath;
    const argsLine = process.argv.slice(1).map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
    const ps1 = writeUpdaterScript({ source: tmpExe, target: exePath, argsLine });

    try {
      const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (e) {
      return false;
    }
  } else {
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', tmpExe], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      if (options?.log !== false) console.log('⬇️  Auto-update: lanzando instalador (portable)');
    } catch (e) {
      if (options?.log !== false) console.error('⚠️  Auto-update: no se pudo lanzar instalador via cmd/start:', e?.message || e);

      try {
        const child = spawn(tmpExe, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        if (options?.log !== false) console.log('⬇️  Auto-update: lanzando instalador (portable) [fallback]');
      } catch (e2) {
        if (options?.log !== false) console.error('⚠️  Auto-update: no se pudo lanzar instalador (fallback):', e2?.message || e2);
        return false;
      }
    }
  }

  try {
    await new Promise((r) => setTimeout(r, 1000));
  } catch (_) {
    // ignore
  }

  return true;
}
