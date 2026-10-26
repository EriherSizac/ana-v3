#!/usr/bin/env node
// Chequeo de tokens del sistema de diseño (docs/design-system.md §2 y §10):
//  - ningún color hex en archivos .tsx
//  - ninguna clase de la paleta Tailwind por defecto (bg-blue-500, text-gray-700, ...)
// Uso: node scripts/check-design-tokens.mjs <dir|archivo>...   (sale con 1 si hay hallazgos)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Paleta por defecto de Tailwind. `neutral` se excluye porque es un token
// propio (neutral-10..60); sus tonos por defecto 100..950 sí se marcan abajo.
const DEFAULT_COLORS = [
  'slate', 'gray', 'zinc', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose',
];
const SHADES = '50|100|200|300|400|500|600|700|800|900|950';
const UTILS =
  'bg|text|border|border-[trblxy]|ring|ring-offset|from|via|to|fill|stroke|outline|divide|placeholder|shadow|accent|caret|decoration';
// Excepciones permitidas por el propio design system (§7.5, mensajes inline).
const ALLOWED = new Set(['red-50', 'red-700', 'green-50', 'green-700']);

const paletteRe = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*(?:${UTILS})-(${DEFAULT_COLORS.join('|')}|neutral)-(${SHADES})(?![\\w-])`,
  'g',
);
const OWN_NEUTRAL = new Set(['50']); // neutral-50 es token propio
const hexRe = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;

function walk(path, out) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(join(path, entry), out);
    }
  } else if (/\.(tsx|ts|jsx|js)$/.test(path)) {
    out.push(path);
  }
  return out;
}

export function checkSource(source, file) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
      for (const m of line.matchAll(hexRe)) {
        findings.push({ file, line: i + 1, kind: 'hex', value: m[0] });
      }
    }
    for (const m of line.matchAll(paletteRe)) {
      const [, color, shade] = m;
      if (color === 'neutral' && OWN_NEUTRAL.has(shade)) continue;
      if (ALLOWED.has(`${color}-${shade}`)) continue;
      findings.push({ file, line: i + 1, kind: 'palette', value: m[0] });
    }
  });
  return findings;
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) targets.push('src');
  const files = targets.flatMap((t) => walk(t, []));
  const findings = files
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
    .flatMap((f) => checkSource(readFileSync(f, 'utf8'), f));
  if (findings.length > 0) {
    for (const f of findings) {
      const what = f.kind === 'hex' ? 'color hex en JSX' : 'clase de paleta Tailwind por defecto';
      console.error(`${relative(process.cwd(), f.file)}:${f.line}  ${what}: ${f.value}  (usa tokens del design system)`);
    }
    console.error(`\ncheck:design: ${findings.length} hallazgo(s).`);
    process.exit(1);
  }
  console.log(`check:design: OK (${files.length} archivos).`);
}

if ((process.argv[1] ?? '').replace(/\\/g, '/').endsWith('scripts/check-design-tokens.mjs')) {
  main();
}
