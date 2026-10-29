/**
 * Manifiesto de versiones del CLI (`versions/latest.json`) — módulo puro
 * (add-in-session-updates D2/D7).
 *
 *  - `parseManifestText`: quita BOM, rechaza vacío/HTML/JSON inválido y
 *    normaliza `{ version, url, sha256?, size? }`. `sha256` y `size` son
 *    opcionales (manifiestos anteriores a este cambio).
 *  - `compareVersions`: `major.minor.patch` numérico (lo no numérico se ignora).
 *  - `isNewer`: solo estrictamente mayor (nunca downgrade).
 */

export const DEFAULT_MANIFEST_URL = 'https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/latest.json';
export const DEFAULT_DOWNLOAD_BASE_URL = 'https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-';

export const parseVersion = (v) => {
  const s = String(v || '').trim();
  const parts = s.split('.').map((x) => Number(String(x).replace(/[^0-9]/g, '')) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};

export const compareVersions = (a, b) => {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va[i] > vb[i]) return 1;
    if (va[i] < vb[i]) return -1;
  }
  return 0;
};

/** ¿`remote` es estrictamente mayor que `local`? */
export const isNewer = (remote, local) => compareVersions(remote, local) > 0;

/** Versión `N.N.N` limpia (sin BOM ni caracteres extra) o '' si no lo es. */
export function cleanVersion(v) {
  const s = String(v || '')
    .replace(/^﻿/, '')
    .trim()
    .replace(/[^0-9.]/g, '');
  return /^\d+\.\d+\.\d+$/.test(s) ? s : '';
}

const isHttpsUrl = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Texto del manifiesto → `{ version, url, sha256, size }` (sha256/size null si
 * faltan). Lanza Error con mensaje en español si no es usable.
 */
export function parseManifestText(text, { downloadBaseUrl = DEFAULT_DOWNLOAD_BASE_URL } = {}) {
  const cleaned = String(text || '').replace(/^﻿/, '').trim();
  if (!cleaned) throw new Error('Manifest vacío');
  if (/^<(!DOCTYPE|html)/i.test(cleaned)) {
    throw new Error(`Manifest no es JSON (HTML). Preview: ${cleaned.slice(0, 200).replace(/\s+/g, ' ')}`);
  }
  let raw;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new Error(`Manifest inválido (JSON). Preview: ${cleaned.slice(0, 200).replace(/\s+/g, ' ')}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('Manifest inválido (no es objeto)');
  const version = cleanVersion(raw.version);
  if (!version) throw new Error('Manifest sin versión válida');
  const url = String(raw.url || `${downloadBaseUrl}${version}.exe`).trim();
  if (!isHttpsUrl(url)) throw new Error('Manifest con url de descarga no https');
  let sha256 = null;
  if (raw.sha256 !== undefined && raw.sha256 !== null && raw.sha256 !== '') {
    const h = String(raw.sha256).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('Manifest con sha256 inválido');
    sha256 = h;
  }
  let size = null;
  if (raw.size !== undefined && raw.size !== null && raw.size !== '') {
    const n = Number(raw.size);
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Manifest con size inválido');
    size = n;
  }
  return { version, url, sha256, size };
}

/**
 * GET del manifiesto (`Cache-Control: no-cache`, 20 s) y parseo.
 * @param {string} url
 * @param {{ httpsGet?: Function, timeoutMs?: number }} [o]
 */
export async function fetchManifest(url, { httpsGet, timeoutMs = 20_000 } = {}) {
  const get = httpsGet || (await import('https')).get;
  const text = await new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status} leyendo manifest`));
        return;
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      try {
        req.destroy(new Error('Timeout leyendo manifest'));
      } catch {
        /* ya cerrado */
      }
    });
  });
  return parseManifestText(text);
}
