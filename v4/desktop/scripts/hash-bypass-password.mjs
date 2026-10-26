// File: Genera el hash scrypt de la contraseña maestra de Sistemas (acceso de emergencia).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva
//
// Uso (Sistemas):
//   node scripts/hash-bypass-password.mjs          → pide la contraseña (sin eco)
//   echo "<contraseña>" | node scripts/hash-bypass-password.mjs   (no recomendado: historial)
// Imprime: scrypt$<sal hex>$<hash hex>
// Ese valor (no la contraseña) va en ANA_UPDATE_BYPASS_HASH al compilar:
//   $env:ANA_UPDATE_BYPASS_HASH="scrypt$..."; npm run dist
// Parámetros fijos: N=16384, r=8, p=1, 32 bytes, sal aleatoria de 16 bytes,
// contraseña normalizada NFKC (deben coincidir con electron/update/bypass.ts).

import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const MIN_LENGTH = 12;

function readHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      const rl = createInterface({ input: stdin });
      rl.once('line', (l) => {
        rl.close();
        resolve(l);
      });
      return;
    }
    process.stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stderr.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const pw = (await readHidden('Contraseña maestra: ')).normalize('NFKC');
if (pw.length < MIN_LENGTH) {
  console.error(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
  process.exit(1);
}
if (process.stdin.isTTY) {
  const again = (await readHidden('Repite la contraseña: ')).normalize('NFKC');
  if (again !== pw) {
    console.error('Las contraseñas no coinciden.');
    process.exit(1);
  }
}
const salt = randomBytes(16);
const dk = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
console.log(`scrypt$${salt.toString('hex')}$${dk.toString('hex')}`);
