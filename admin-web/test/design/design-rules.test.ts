// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';

const root = join(__dirname, '..', '..');
const fixtures = join(root, 'test', 'fixtures', 'design');

function runCheck(...targets: string[]) {
  return spawnSync(process.execPath, [join(root, 'scripts', 'check-design-tokens.mjs'), ...targets], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('check:design (scripts/check-design-tokens.mjs)', () => {
  it('falla con clases de la paleta por defecto, indicando archivo y clase', () => {
    const r = runCheck(join(fixtures, 'default-palette.tsx'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('default-palette.tsx:2');
    expect(r.stderr).toContain('bg-blue-500');
    expect(r.stderr).toContain('text-gray-700');
  });

  it('falla con colores hex en JSX', () => {
    const r = runCheck(join(fixtures, 'hex.tsx'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('#145CB3');
  });

  it('acepta tokens y las excepciones red/green 50/700', () => {
    expect(runCheck(join(fixtures, 'good.tsx')).status).toBe(0);
  });

  it('el código real pasa', () => {
    const r = runCheck('src');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

describe('Tailwind: theme.colors reemplazado', () => {
  it('bg-blue-500 no produce CSS y bg-primary sí', async () => {
    const result = await postcss([
      tailwindcss({
        ...tailwindConfig,
        content: [{ raw: '<div class="bg-blue-500 text-gray-700 bg-primary text-text-light bg-red-50 text-2xs shadow-card"></div>', extension: 'html' }],
      }),
    ]).process('@tailwind utilities;', { from: undefined });
    expect(result.css).not.toContain('.bg-blue-500');
    expect(result.css).not.toContain('.text-gray-700');
    expect(result.css).toContain('.bg-primary');
    expect(result.css).toContain('.text-text-light');
    expect(result.css).toContain('.bg-red-50');
    expect(result.css).toContain('.text-2xs');
    expect(result.css).toContain('.shadow-card');
  });
});

describe('ESLint: reglas obligatorias', () => {
  const eslint = new ESLint({ cwd: root });
  const lint = async (code: string) => {
    const [res] = await eslint.lintText(code, { filePath: join(root, 'src', '__fixture__.tsx') });
    return res!.messages.map((m) => m.ruleId);
  };

  it.each([
    ['alert()', `export function f() { alert('x'); }`, 'no-alert'],
    ['window.confirm', `export function f() { return window.confirm('x'); }`, 'no-alert'],
    ['confirm()', `export function f() { return confirm('x'); }`, 'no-restricted-globals'],
    ['prompt()', `export function f() { return prompt('x'); }`, 'no-restricted-globals'],
    ['<select>', `export function F() { return <select><option>a</option></select>; }`, 'no-restricted-syntax'],
  ])('%s falla', async (_n, code, rule) => {
    expect(await lint(code)).toContain(rule);
  }, 60_000);

  it('código válido no reporta reglas del design system', async () => {
    const rules = await lint(`export function F() { return <div className="bg-primary">ok</div>; }`);
    expect(rules).not.toContain('no-alert');
    expect(rules).not.toContain('no-restricted-syntax');
  }, 60_000);
});
