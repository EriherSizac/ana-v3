/**
 * Descarga verificada del instalador (add-in-session-updates D7).
 *
 * Escribe a `<destino>.part`, calcula SHA-256 en el flujo y, al terminar,
 * verifica el tamaño (`expectedSize` del manifiesto o, si falta,
 * `Content-Length`) y el hash si el manifiesto lo trae. Solo entonces renombra
 * a `<destino>`. Ante cualquier error borra el parcial y rechaza.
 */

import fs from 'fs';
import crypto from 'crypto';

export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

export class DownloadVerificationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DownloadVerificationError';
    this.code = code;
  }
}

/**
 * Comprueba tamaño y hash de lo descargado. Devuelve null si es válido o el
 * Error a reportar.
 */
export function verifyDownload({ received, contentLength, expectedSize, expectedSha256, actualSha256 }) {
  const want = expectedSize ?? (contentLength > 0 ? contentLength : null);
  if (want == null) return new DownloadVerificationError('No se puede verificar el tamaño (sin size ni Content-Length)', 'no_size');
  if (received !== want) {
    return new DownloadVerificationError(`Tamaño inesperado: ${received} bytes (se esperaban ${want})`, 'size_mismatch');
  }
  if (expectedSha256 && String(actualSha256).toLowerCase() !== String(expectedSha256).toLowerCase()) {
    return new DownloadVerificationError('El SHA-256 del instalador no coincide con el manifiesto', 'sha256_mismatch');
  }
  return null;
}

const safeUnlink = (p) => {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignorar */
  }
};

/**
 * @param {{ url: string, dest: string, expectedSize?: number|null, expectedSha256?: string|null,
 *   onProgress?: (p: { received: number, total: number, pct: number }) => void,
 *   httpsGet?: Function, idleTimeoutMs?: number }} o
 * @returns {Promise<{ path: string, size: number, sha256: string }>}
 */
export async function downloadVerified({
  url,
  dest,
  expectedSize = null,
  expectedSha256 = null,
  onProgress = () => {},
  httpsGet,
  idleTimeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS,
}) {
  const get = httpsGet || (await import('https')).get;
  const part = `${dest}.part`;
  safeUnlink(part);
  try {
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      let file = null;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        // En Windows no se puede borrar un archivo abierto: se cierra antes de rechazar.
        if (file && !file.closed) file.destroy();
        if (file && !file.closed) file.once('close', () => reject(e));
        else reject(e);
      };
      const req = get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          res.resume();
          fail(new Error(`HTTP ${status} descargando update`));
          return;
        }
        const contentLength = Number(res.headers['content-length'] || 0) || 0;
        const total = expectedSize || contentLength || 0;
        const hash = crypto.createHash('sha256');
        file = fs.createWriteStream(part);
        let received = 0;
        let lastPct = -1;
        res.on('data', (chunk) => {
          received += chunk.length;
          hash.update(chunk);
          if (!total) return;
          const pct = Math.min(100, Math.floor((received / total) * 100));
          if (pct === lastPct) return;
          lastPct = pct;
          try {
            onProgress({ received, total, pct });
          } catch {
            /* el progreso no debe romper la descarga */
          }
        });
        res.on('error', fail);
        res.on('aborted', () => fail(new Error('Descarga interrumpida')));
        file.on('error', fail);
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            if (settled) return;
            const actualSha256 = hash.digest('hex');
            const err = verifyDownload({ received, contentLength, expectedSize, expectedSha256, actualSha256 });
            if (err) return fail(err);
            settled = true;
            resolve({ size: received, sha256: actualSha256 });
          });
        });
      });
      req.on('error', fail);
      req.setTimeout(idleTimeoutMs, () => {
        try {
          req.destroy(new Error('Timeout descargando update'));
        } catch {
          /* ya cerrado */
        }
      });
    });
    safeUnlink(dest);
    fs.renameSync(part, dest);
    return { path: dest, ...result };
  } catch (e) {
    safeUnlink(part);
    throw e;
  }
}
