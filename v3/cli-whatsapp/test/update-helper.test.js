import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  INSTALLER_ARGS,
  buildHelperScript,
  helperCommand,
  psLiteral,
  readPreviousResult,
  relaunchArgs,
  resolveInstallLayout,
  spawnHelper,
  writeHelperScript,
} from '../update-helper.js';

const base = {
  pid: 4242,
  installer: 'C:\\Users\\Ana\\AppData\\Local\\Temp\\ANA-1.0.51.exe',
  launcher: 'C:\\Users\\Ana\\AppData\\Local\\Programs\\ANA\\ANA.bat',
  appDir: 'C:\\Users\\Ana\\AppData\\Local\\Programs\\ANA',
  logPath: 'C:\\Users\\Ana\\AppData\\Roaming\\ANA\\update.log',
  resultPath: 'C:\\Users\\Ana\\AppData\\Roaming\\ANA\\update-result.json',
  installLogPath: 'C:\\Users\\Ana\\AppData\\Local\\Temp\\ANA-1.0.51-install.log',
  version: '1.0.51',
  fromVersion: '1.0.50',
  args: ['--clipboard-media'],
};

test('psLiteral: comillas simples y tipográficas se duplican; saltos de línea se rechazan', () => {
  assert.equal(psLiteral("C:\\Users\\O'Neil\\x"), "'C:\\Users\\O''Neil\\x'");
  assert.equal(psLiteral('a\u2019b'), "'a\u2019\u2019b'");
  assert.equal(psLiteral('$(calc) `whoami` ; & | %PATH%'), "'$(calc) `whoami` ; & | %PATH%'");
  assert.throws(() => psLiteral('a\nb'));
  assert.throws(() => psLiteral('a\u0000b'));
});

test('el script lleva rutas como literales y los argumentos silenciosos de Inno', () => {
  const s = buildHelperScript({ ...base, installer: "C:\\Users\\Jo'; Remove-Item C:\\ -Recurse; '\\ANA.exe" });
  // La comilla inyectada queda duplicada dentro de un único literal.
  assert.ok(s.includes("$installer = 'C:\\Users\\Jo''; Remove-Item C:\\ -Recurse; ''\\ANA.exe'"));
  for (const a of INSTALLER_ARGS) assert.ok(s.includes(`'${a}'`));
  assert.ok(s.includes('$cliPid = 4242'));
  assert.ok(s.includes("$relaunchArgs = @('--clipboard-media')"));
  assert.ok(s.includes('Wait-Process -Id $cliPid'));
  assert.ok(s.includes('Start-Process -FilePath $launcher'));
  // Ninguna línea fuera de las asignaciones contiene las rutas (no se interpolan en comandos).
  const lines = s.split('\r\n').filter((l) => l.includes('Remove-Item C:'));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('$installer = '));
});

test('valida PID, versión y campos obligatorios', () => {
  assert.throws(() => buildHelperScript({ ...base, pid: '12; calc' }), /PID/);
  assert.throws(() => buildHelperScript({ ...base, pid: -1 }), /PID/);
  assert.throws(() => buildHelperScript({ ...base, version: "1.0.51'; calc" }), /Versión/);
  assert.throws(() => buildHelperScript({ ...base, launcher: '' }), /launcher/);
  assert.ok(buildHelperScript({ ...base, args: [] }).includes('$relaunchArgs = @()'));
});

test('relaunchArgs: solo indicadores --nombre, sin un solo uso ni valores', () => {
  assert.deepEqual(
    relaunchArgs(['--clipboard-media', '--reset-manual-session', '--logout', 'x', '--a=1', '--foo&calc', '--no-self-update']),
    ['--clipboard-media', '--no-self-update'],
  );
});

test('helperCommand: PowerShell oculto con -File (el script no viaja como texto)', () => {
  const c = helperCommand('C:\\t\\apply update.ps1');
  assert.equal(c.command, 'powershell.exe');
  assert.deepEqual(c.args.slice(-2), ['-File', 'C:\\t\\apply update.ps1']);
  assert.ok(c.args.includes('-NoProfile') && c.args.includes('Hidden'));
});

test('resolveInstallLayout: solo la instalación portable de Inno', () => {
  const exists = (p) => ['C:\\Prog\\ANA\\ANA.bat', 'C:\\Prog\\ANA\\app\\index.js'].includes(p);
  assert.deepEqual(resolveInstallLayout({ execPath: 'C:\\Prog\\ANA\\nodejs\\node.exe', isPkg: false, exists }), {
    appDir: 'C:\\Prog\\ANA',
    launcher: 'C:\\Prog\\ANA\\ANA.bat',
  });
  assert.equal(resolveInstallLayout({ execPath: 'C:\\Program Files\\nodejs\\node.exe', isPkg: false, exists }), null);
  assert.equal(resolveInstallLayout({ execPath: 'C:\\Prog\\ANA\\nodejs\\node.exe', isPkg: true, exists }), null);
});

test('writeHelperScript escribe UTF-8 con BOM; spawnHelper desacoplado y oculto', async () => {
  const file = writeHelperScript('Log "ñ"', { tmpDir: os.tmpdir() });
  assert.equal(fs.readFileSync(file, 'utf-8').charCodeAt(0), 0xfeff);
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.unref = () => (child.unrefed = true);
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  const child = await spawnHelper(file, { spawn });
  assert.equal(child.unrefed, true);
  assert.deepEqual(calls[0].opts, { detached: true, stdio: 'ignore', windowsHide: true });
  const failing = () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit('error', new Error('ENOENT')));
    return child;
  };
  await assert.rejects(spawnHelper(file, { spawn: failing }), /ENOENT/);
});

test('readPreviousResult: lee (con BOM), borra y tolera basura', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-res-'));
  const f = path.join(dir, 'update-result.json');
  fs.writeFileSync(f, '\uFEFF{"ok":false,"version":"1.0.51","from":"1.0.50","exitCode":5,"at":"x"}');
  assert.deepEqual(readPreviousResult(dir), { ok: false, version: '1.0.51', from: '1.0.50', exitCode: 5, at: 'x' });
  assert.equal(fs.existsSync(f), false);
  assert.equal(readPreviousResult(dir), null);
  fs.writeFileSync(f, 'nope');
  assert.equal(readPreviousResult(dir), null);
});
