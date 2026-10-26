#!/usr/bin/env node
// Verifica que ningún secreto de servidor llegue al bundle del navegador.
// Lee los valores FALSOS de .env.test (ROLES_API_KEY y AWS_*) y falla si alguno
// aparece en .next/static. Debe correrse después de `next build` hecho con esas
// mismas variables en el entorno:
//   set -a; . ./.env.test; set +a; npm run build && npm run check:bundle
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const envFile = join(root, '.env.test');
const staticDir = join(root, '.next', 'static');

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function findLeaks(files, secrets) {
  const leaks = [];
  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    for (const [name, value] of Object.entries(secrets)) {
      if (value && content.includes(value)) leaks.push({ file: f, name });
    }
  }
  return leaks;
}

function main() {
  if (!existsSync(envFile)) {
    console.error('check:bundle: falta .env.test');
    process.exit(2);
  }
  if (!existsSync(staticDir)) {
    console.error('check:bundle: no existe .next/static; corre `npm run build` primero');
    process.exit(2);
  }
  const env = parseEnv(readFileSync(envFile, 'utf8'));
  const secrets = Object.fromEntries(
    Object.entries(env).filter(([k]) => k === 'ROLES_API_KEY' || k.startsWith('AWS_')),
  );
  if (Object.keys(secrets).length === 0) {
    console.error('check:bundle: .env.test no define ROLES_API_KEY ni AWS_*');
    process.exit(2);
  }
  const leaks = findLeaks(walk(staticDir), secrets);
  if (leaks.length > 0) {
    for (const l of leaks) console.error(`check:bundle: ${l.name} aparece en ${l.file}`);
    process.exit(1);
  }
  console.log(`check:bundle: OK (${Object.keys(secrets).join(', ')} ausentes de .next/static).`);
}

main();
