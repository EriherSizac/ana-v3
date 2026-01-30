import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import https from 'https';
import { fileURLToPath } from 'url';

const isPkg = typeof process.pkg !== 'undefined';

const parseVersion = (v) => {
  const s = String(v || '').trim();
  const parts = s.split('.').map((x) => Number(String(x).replace(/[^0-9]/g, '')) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};

const compareVersions = (a, b) => {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va[i] > vb[i]) return 1;
    if (va[i] < vb[i]) return -1;
  }
  return 0;
};

const httpGetJson = (url) =>
  new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${status} leyendo manifest`));
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const cleaned = String(data || '').replace(/^\uFEFF/, '').trim();
          if (!cleaned) {
            return reject(new Error('Manifest vacío'));
          }
          if (cleaned.startsWith('<!DOCTYPE') || cleaned.startsWith('<html') || cleaned.startsWith('<HTML')) {
            const preview = cleaned.slice(0, 200).replace(/\s+/g, ' ');
            return reject(new Error(`Manifest no es JSON (HTML). Preview: ${preview}`));
          }
          resolve(JSON.parse(cleaned));
        } catch (e) {
          const preview = String(data || '').slice(0, 200).replace(/\s+/g, ' ');
          reject(new Error(`Manifest inválido (JSON). Preview: ${preview}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      try {
        req.destroy(new Error('Timeout leyendo manifest'));
      } catch (_) {}
    });
  });

const renderProgressBar = (pct) => {
  const clamped = Math.max(0, Math.min(100, Math.floor(pct || 0)));
  const width = 20;
  const filled = Math.round((clamped / 100) * width);
  const bar = `${'#'.repeat(filled)}${'.'.repeat(Math.max(0, width - filled))}`;
  return `${String(clamped).padStart(3, ' ')}% [${bar}]`;
};

const httpDownloadToFile = (url, outPath, onProgress) =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    const req = https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        res.resume();
        try {
          file.close();
        } catch (_) {}
        return reject(new Error(`HTTP ${status} descargando update`));
      }

      const total = Number(res.headers['content-length'] || 0) || 0;
      let received = 0;
      let lastEmitAt = 0;
      let lastPct = -1;

      res.on('data', (chunk) => {
        received += chunk?.length || 0;
        if (!total) return;
        const pct = Math.floor((received / total) * 100);
        const now = Date.now();
        if (pct === lastPct) return;
        if (now - lastEmitAt < 200) return;
        lastEmitAt = now;
        lastPct = pct;
        try {
          onProgress?.({ received, total, pct });
        } catch (_) {
          // ignore
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(null));
      });
    });
    req.on('error', (err) => {
      try {
        file.close();
      } catch (_) {}
      reject(err);
    });
    req.setTimeout(60000, () => {
      try {
        req.destroy(new Error('Timeout descargando update'));
      } catch (_) {}
    });
  });

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
  const defaultManifestUrl = 'https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/latest.json';
  const manifestUrl = String(options.manifestUrl || process.env.ANA_UPDATE_MANIFEST_URL || defaultManifestUrl || '').trim();
  if (!manifestUrl) {
    if (options?.log !== false) console.log('🔄 Auto-update: sin manifestUrl, saltando');
    return false;
  }

  const defaultDownloadBaseUrl = 'https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-';

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
    manifest = await httpGetJson(manifestUrl);
  } catch (e) {
    if (options?.log !== false) console.error('⚠️  Auto-update: error leyendo manifest:', e?.message || e);
    return false;
  }

  const latestVersion = String(manifest?.version || '0.0.0');
  const safeLatestVersion = String(latestVersion || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[^0-9.]/g, '');
  if (options?.log !== false) {
    console.log(`🔄 Auto-update: versión remota ${latestVersion}`);
    console.log(`🔄 Auto-update: versión remota (safe) ${safeLatestVersion}`);
  }
  if (compareVersions(safeLatestVersion, currentVersion) <= 0) {
    if (options?.log !== false) console.log('🔄 Auto-update: no hay actualización disponible');
    return false;
  }

  const url = String(manifest?.url || `${defaultDownloadBaseUrl}${safeLatestVersion}.exe` || '').trim();
  if (!url) {
    if (options?.log !== false) console.error('⚠️  Auto-update: manifest sin url de descarga');
    return false;
  }

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
    await httpDownloadToFile(url, tmpExe, ({ pct }) => {
      if (!isInteractive) {
        if (pct % 5 !== 0) return;
        console.log(`⬇️  Descargando update: ${pct}%`);
        return;
      }
      process.stdout.write(`\r⬇️  Descargando update: ${renderProgressBar(pct)}   `);
      if (pct >= 100) process.stdout.write('\n');
    });
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
