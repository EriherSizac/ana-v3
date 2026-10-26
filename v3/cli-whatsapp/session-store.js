import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Sesión de Cognito en disco (`<datos>/.agent-session`) protegida con DPAPI
 * del usuario de Windows (migrate-cli-to-cognito-login, design D7).
 *
 * Se guarda `{username, refreshToken, issuedAt}` cifrado con
 * `ProtectedData.Protect(..., CurrentUser)` invocando PowerShell con
 * `-Command -`: el script y el secreto viajan por stdin (nunca por argumentos;
 * tampoco `-EncodedCommand`, que algunos antivirus bloquean). ID/access tokens nunca se persisten.
 * Sin DPAPI (fuera de Windows) no se persiste nada y se pide login en cada arranque.
 */

export const SESSION_FILE_NAME = '.agent-session';
const FILE_VERSION = 1;
// Entropía fija de la aplicación (no es secreta): evita que otro programa del
// mismo usuario descifre el blob con un Unprotect genérico sin conocerla.
const ENTROPY_B64 = Buffer.from('ANA-v3-cli-agent-session').toString('base64');

/** Script de PowerShell (una línea) con el dato en base64; se envía por stdin. */
export const psScript = (op, dataB64) =>
  [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    `$bytes = [Convert]::FromBase64String('${dataB64}')`,
    `$entropy = [Convert]::FromBase64String('${ENTROPY_B64}')`,
    `$out = [System.Security.Cryptography.ProtectedData]::${op}($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ') + '\n';

/**
 * Protector DPAPI vía `powershell.exe -NoProfile -NonInteractive -Command -`.
 * `spawnImpl` es inyectable para pruebas.
 */
export function createDpapiProtector({ spawnImpl = spawn, powershell = 'powershell.exe', timeoutMs = 20000, platform = process.platform } = {}) {
  const run = (op, input) =>
    new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl(powershell, ['-NoProfile', '-NonInteractive', '-Command', '-'], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        reject(new Error('dpapi_unavailable'));
        return;
      }
      let out = '';
      let done = false;
      const finish = (err, val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(val);
      };
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        finish(new Error('dpapi_timeout'));
      }, timeoutMs);
      child.stdout.on('data', (d) => {
        out += d.toString('utf8');
      });
      // stderr se descarta: PowerShell puede incluir fragmentos de la entrada en errores.
      child.stderr.on('data', () => {});
      child.on('error', () => finish(new Error('dpapi_unavailable')));
      child.on('close', (code) => {
        if (code !== 0) return finish(new Error(`dpapi_${op.toLowerCase()}_failed`));
        try {
          const buf = Buffer.from(out.trim(), 'base64');
          if (!buf.length) return finish(new Error(`dpapi_${op.toLowerCase()}_failed`));
          finish(null, buf);
        } catch {
          finish(new Error(`dpapi_${op.toLowerCase()}_failed`));
        }
      });
      child.stdin.end(psScript(op, Buffer.from(input).toString('base64')));
    });

  return {
    available: platform === 'win32',
    protect: (buf) => run('Protect', buf),
    unprotect: (buf) => run('Unprotect', buf),
  };
}

/** Protector nulo: sin cifrado disponible, nunca persiste. */
export const unavailableProtector = Object.freeze({
  available: false,
  protect: async () => {
    throw new Error('dpapi_unavailable');
  },
  unprotect: async () => {
    throw new Error('dpapi_unavailable');
  },
});

/**
 * @param {{ dir: string, protector?: ReturnType<typeof createDpapiProtector>, logger?: Console }} opts
 */
export function createSessionStore({ dir, protector = createDpapiProtector(), logger = console } = {}) {
  const filePath = path.join(dir, SESSION_FILE_NAME);

  const clear = () => {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (e) {
      logger.warn?.('[Sesión] No se pudo borrar la sesión guardada:', e?.code || e?.name || 'error');
    }
  };

  return {
    filePath,
    get canPersist() {
      return !!protector?.available;
    },

    /** Guarda `{username, refreshToken, issuedAt}` cifrado. Devuelve true si se persistió. */
    async save({ username, refreshToken, issuedAt = new Date().toISOString() }) {
      if (!protector?.available || !refreshToken) return false;
      try {
        const plain = Buffer.from(JSON.stringify({ username, refreshToken, issuedAt }), 'utf8');
        const blob = await protector.protect(plain);
        const tmp = `${filePath}.tmp`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify({ v: FILE_VERSION, protection: 'dpapi-currentuser', data: blob.toString('base64') }));
        fs.renameSync(tmp, filePath);
        return true;
      } catch (e) {
        logger.warn?.('[Sesión] No se pudo proteger la sesión; se pedirá login en el próximo arranque:', e?.message || 'error');
        return false;
      }
    },

    /**
     * Sesión guardada o null. Un archivo ilegible o que no se puede descifrar
     * (otra cuenta de Windows u otra máquina) se descarta y se borra.
     */
    async load() {
      if (!fs.existsSync(filePath)) return null;
      if (!protector?.available) return null;
      try {
        const file = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (file?.v !== FILE_VERSION || typeof file.data !== 'string') throw new Error('formato');
        const plain = await protector.unprotect(Buffer.from(file.data, 'base64'));
        const s = JSON.parse(plain.toString('utf8'));
        if (!s || typeof s.refreshToken !== 'string' || !s.refreshToken || typeof s.username !== 'string') throw new Error('contenido');
        return { username: s.username, refreshToken: s.refreshToken, issuedAt: s.issuedAt || null };
      } catch (e) {
        if (e?.message === 'dpapi_unavailable' || e?.message === 'dpapi_timeout') {
          // Fallo transitorio de PowerShell: no se borra; se pide login en este arranque.
          logger.warn?.('[Sesión] No se pudo leer la sesión guardada (protección no disponible)');
          return null;
        }
        logger.warn?.('[Sesión] La sesión guardada no se puede usar en esta cuenta; se descarta');
        clear();
        return null;
      }
    },

    clear,
  };
}
