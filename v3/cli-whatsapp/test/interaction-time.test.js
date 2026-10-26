import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { interactionDateTime, INTERACTIONS_TIME_ZONE } from '../interaction-time.js';

const CASES = [
  ['2026-10-27T01:40:00Z', { contact_date: '2026-10-26', contact_time: '19:40', range_time: '19:00 - 20:00' }],
  ['2026-10-27T05:59:00Z', { contact_date: '2026-10-26', contact_time: '23:59', range_time: '23:00 - 00:00' }],
  ['2026-10-27T06:05:00Z', { contact_date: '2026-10-27', contact_time: '00:05', range_time: '00:00 - 01:00' }],
  // Abril (antiguo horario de verano): México sigue en UTC-6 desde 2022
  ['2026-04-15T16:15:00Z', { contact_date: '2026-04-15', contact_time: '10:15', range_time: '10:00 - 11:00' }],
];

test('zona por defecto', () => {
  assert.equal(INTERACTIONS_TIME_ZONE, 'America/Mexico_City');
});

for (const [iso, expected] of CASES) {
  test(`interactionDateTime(${iso})`, () => {
    assert.deepEqual(interactionDateTime(new Date(iso)), expected);
  });
}

test('sin argumentos usa el instante actual', () => {
  const r = interactionDateTime();
  assert.match(r.contact_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.contact_time, /^([01]\d|2[0-3]):[0-5]\d$/);
  assert.match(r.range_time, /^([01]\d|2[0-3]):00 - ([01]\d|2[0-3]):00$/);
});

test('zona inválida hace fallback a hora local sin lanzar', () => {
  const d = new Date('2026-10-27T01:40:00Z');
  const r = interactionDateTime(d, 'Zona/Inexistente');
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(r.contact_time, `${pad(d.getHours())}:${pad(d.getMinutes())}`);
});

test('mismo resultado con TZ=UTC y TZ=Asia/Tokyo en el proceso', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const moduleUrl = pathToFileURL(path.join(here, '..', 'interaction-time.js')).href;
  const script = `import(${JSON.stringify(moduleUrl)}).then((m) => {
    const isos = ${JSON.stringify(CASES.map((c) => c[0]))};
    process.stdout.write(JSON.stringify(isos.map((i) => m.interactionDateTime(new Date(i)))));
  });`;
  const expected = CASES.map((c) => c[1]);
  for (const TZ of ['UTC', 'Asia/Tokyo']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ },
      encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(out), expected, `TZ=${TZ}`);
  }
});
