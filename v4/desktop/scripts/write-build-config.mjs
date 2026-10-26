// File: Escribe dist-electron/build-config.json con valores inyectados al compilar.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva
//
// Hoy solo: ANA_UPDATE_BYPASS_HASH = "scrypt$<sal hex>$<hash hex>" (hash de la
// contraseña maestra de Sistemas para el acceso de emergencia del gate de
// actualización; se genera con scripts/hash-bypass-password.mjs). Sin la
// variable, el build no ofrece acceso de emergencia. NUNCA la contraseña en claro.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (process.env.ANA_UPDATE_BYPASS_HASH ?? '').trim();

if (hash && !/^scrypt\$[0-9a-f]{16,}\$[0-9a-f]{32,}$/i.test(hash)) {
  console.error(
    '[build-config] ANA_UPDATE_BYPASS_HASH inválido: se espera "scrypt$<sal hex>$<hash hex>" ' +
      '(genéralo con: node scripts/hash-bypass-password.mjs)',
  );
  process.exit(1);
}

const out = join(root, 'dist-electron', 'build-config.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(hash ? { updateBypassHash: hash } : {}, null, 2) + '\n');
console.log(
  `[build-config] ${out} — acceso de emergencia ${hash ? 'HABILITADO' : 'deshabilitado (sin ANA_UPDATE_BYPASS_HASH)'}`,
);
