import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAssignmentCsv } from '../assignment-csv.js';
import { createJournal, loadJournal } from '../assignment-journal.js';
import {
  buildResultItem,
  createResultsOutbox,
  errorCodeOf,
  outboxFileName,
  resultId,
  BASE_RETRY_MS,
  MAX_RETRY_MS,
} from '../results-outbox.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ana-outbox-'));
const silent = { log() {}, warn() {}, error() {} };

/** Temporizador manual: `run()` dispara lo programado. */
function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false, unref() {} };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) t.cancelled = true;
    },
    async run() {
      const due = timers.splice(0).filter((t) => !t.cancelled);
      for (const t of due) await t.fn();
    },
    lastDelay: () => timers.filter((t) => !t.cancelled).at(-1)?.ms,
  };
}

const CSV = [
  'phone_number,first_name,message,credit,ana_upload_id',
  '5215500000001,Ana,"Hola Ana, paga hoy",CR-1,20261028T0900-11112222',
  '5500000002,Beto,Hola Beto,CR-2,',
].join('\n');

const item = (i, campaign = 'prueba', assignmentId = 'A1') => ({
  ...buildResultItem({
    contact: parseAssignmentCsv(CSV)[0],
    result: { status: 'sent', sent_at: '2026-10-29T17:00:00.000Z' },
    assignmentId,
    campaign,
    rowIndex: i,
  }),
});

const makeOutbox = (dir, post, timers = fakeTimers(), now = () => 0) => ({
  timers,
  outbox: createResultsOutbox({ dir, agentId: 'Erick', post, logger: silent, setTimer: timers.setTimer, clearTimer: timers.clearTimer, now }),
});

test('buildResultItem: id, teléfono normalizado, uploadId, crédito, hash y extracto', () => {
  const [ana, beto] = parseAssignmentCsv(CSV);
  const it = buildResultItem({
    contact: ana,
    result: { status: 'sent', sent_at: '2026-10-29T17:00:00.000Z', message_sent: ana.message },
    assignmentId: '20261029T1000-ab12cd34',
    sourceKey: 'agents/prueba/erick-contacts-1.csv',
    campaign: 'Prueba',
  });
  assert.equal(it.id, '20261029T1000-ab12cd34#0#1');
  assert.equal(it.campaign, 'prueba');
  assert.equal(it.phone, '525500000001');
  assert.equal(it.uploadId, '20261028T0900-11112222');
  assert.equal(it.credit, 'CR-1');
  assert.equal(it.status, 'sent');
  assert.equal(it.errorCode, null);
  assert.equal(it.error, null);
  assert.equal(it.sentAt, '2026-10-29T17:00:00.000Z');
  assert.match(it.messageHash, /^[a-f0-9]{64}$/);
  assert.equal(it.messagePreview, 'Hola Ana, paga hoy');
  assert.equal(it.sourceKey, 'agents/prueba/erick-contacts-1.csv');

  const err = buildResultItem({ contact: beto, result: { status: 'no_whatsapp', error: 'No tiene WhatsApp' }, assignmentId: 'A1', campaign: 'prueba', now: new Date('2026-10-29T18:00:00Z') });
  assert.equal(err.rowIndex, 1);
  assert.equal(err.uploadId, null);
  assert.equal(err.errorCode, 'no_whatsapp');
  assert.equal(err.sentAt, '2026-10-29T18:00:00.000Z');

  const long = buildResultItem({ contact: { ...ana, message: 'x'.repeat(400) }, assignmentId: 'A1', campaign: 'prueba', status: 'por_revisar', rowIndex: 7 });
  assert.equal(long.messagePreview.length, 160);
  assert.equal(long.id, 'A1#7#1');
  assert.equal(long.errorCode, 'interrupted');
});

test('errorCodeOf', () => {
  assert.equal(errorCodeOf('error', 'Contacto sin teléfono (phone vacío)'), 'no_phone');
  assert.equal(errorCodeOf('error', 'Timeout 30000ms exceeded'), 'timeout');
  assert.equal(errorCodeOf('error', 'boom'), 'send_error');
  assert.equal(resultId('A', 3), 'A#3#1');
});

test('enqueue no espera la red, deduplica por id y persiste en disco', async () => {
  const dir = tmpDir();
  let calls = 0;
  const { outbox, timers } = makeOutbox(dir, async () => {
    calls++;
    return { status: 200, body: { success: true, data: { accepted: 1, rejected: [] } } };
  });
  assert.equal(outbox.enqueue(item(0)), true);
  assert.equal(outbox.enqueue(item(0)), false); // misma llave
  assert.equal(calls, 0); // encolar no llama al backend
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, outboxFileName('Erick')), 'utf8'));
  assert.equal(onDisk.pending.length, 1);
  await timers.run();
  assert.equal(calls, 1);
  assert.equal(outbox.pendingCount(), 0);
  assert.equal(outbox.enqueue(item(0)), false); // ya enviado
});

test('lotes de hasta 100 por campaña, sin el campo campaign en los items', async () => {
  const dir = tmpDir();
  const posts = [];
  const { outbox } = makeOutbox(dir, async (campaign, items) => {
    posts.push({ campaign, n: items.length, hasCampaign: items.some((i) => 'campaign' in i) });
    return { status: 200 };
  });
  for (let i = 0; i < 150; i++) outbox.enqueue(item(i, 'prueba'));
  outbox.enqueue(item(0, 'otra', 'B1'));
  await outbox.flush();
  assert.deepEqual(posts, [
    { campaign: 'prueba', n: 100, hasCampaign: false },
    { campaign: 'prueba', n: 50, hasCampaign: false },
    { campaign: 'otra', n: 1, hasCampaign: false },
  ]);
  assert.equal(outbox.pendingCount(), 0);
});

test('backend caído: conserva, reintenta con espera creciente y quita al recibir 200', async () => {
  const dir = tmpDir();
  const statuses = [503, 503, 200];
  let t = 0;
  const { outbox, timers } = makeOutbox(
    dir,
    async () => ({ status: statuses.shift() }),
    undefined,
    () => t,
  );
  outbox.enqueue(item(0));
  await timers.run(); // 503
  assert.equal(outbox.pendingCount(), 1);
  assert.equal(timers.lastDelay(), BASE_RETRY_MS);
  // Encolar durante la espera no adelanta el reintento.
  outbox.enqueue(item(1));
  assert.equal(timers.lastDelay(), BASE_RETRY_MS);
  t += BASE_RETRY_MS;
  await timers.run(); // 503
  assert.equal(timers.lastDelay(), BASE_RETRY_MS * 2);
  t += BASE_RETRY_MS * 2;
  await timers.run(); // 200
  assert.equal(outbox.pendingCount(), 0);
});

test('error de red y espera máxima de 10 min', async () => {
  const dir = tmpDir();
  const { outbox, timers } = makeOutbox(dir, async () => {
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  });
  outbox.enqueue(item(0));
  for (let i = 0; i < 8; i++) await timers.run();
  assert.equal(outbox.pendingCount(), 1);
  assert.equal(timers.lastDelay(), MAX_RETRY_MS);
});

test('400 descarta el lote (veneno) y sigue con el siguiente', async () => {
  const dir = tmpDir();
  const seen = [];
  const { outbox } = makeOutbox(dir, async (campaign) => {
    seen.push(campaign);
    return { status: campaign === 'mala' ? 400 : 200 };
  });
  outbox.enqueue(item(0, 'mala', 'B1'));
  outbox.enqueue(item(1, 'prueba'));
  await outbox.flush();
  assert.deepEqual(seen, ['mala', 'prueba']);
  assert.equal(outbox.pendingCount(), 0);
});

test('reinicio con pendientes: los envía una sola vez al iniciar', async () => {
  const dir = tmpDir();
  const first = makeOutbox(dir, async () => {
    throw new Error('offline');
  });
  for (let i = 0; i < 5; i++) first.outbox.enqueue(item(i));
  await first.timers.run();
  first.outbox.stop();
  assert.equal(first.outbox.pendingCount(), 5);

  const sent = [];
  const second = makeOutbox(dir, async (_c, items) => {
    sent.push(...items.map((i) => i.id));
    return { status: 200 };
  });
  assert.equal(second.outbox.pendingCount(), 5);
  second.outbox.start();
  await second.timers.run();
  assert.deepEqual(sent, ['A1#0#1', 'A1#1#1', 'A1#2#1', 'A1#3#1', 'A1#4#1']);
  second.outbox.start();
  await second.timers.run();
  assert.equal(sent.length, 5);
});

test('archivo ilegible: arranca vacío sin lanzar', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, outboxFileName('Erick')), '{no json');
  const { outbox } = makeOutbox(dir, async () => ({ status: 200 }));
  assert.equal(outbox.pendingCount(), 0);
  assert.equal(outbox.enqueue(item(0)), true);
});

test('fallo de disco al encolar no lanza', () => {
  const dir = path.join(tmpDir(), 'no-existe', 'sub');
  const { outbox } = makeOutbox(dir, async () => ({ status: 200 }));
  assert.doesNotThrow(() => outbox.enqueue(item(0)));
});

test('journal: source_key opcional se guarda y sobrevive la reanudación', () => {
  const dir = tmpDir();
  const contacts = parseAssignmentCsv(CSV);
  createJournal({ dir, agentId: 'erick', campaign: 'prueba', csvText: CSV, rows: contacts.map((c) => ({ index: c.__rowIndex, phone: c.phone })), sourceKey: 'agents/prueba/erick-contacts-1.csv' });
  const r = loadJournal({ dir, agentId: 'erick', campaign: 'prueba' });
  assert.equal(r.status, 'ok');
  assert.equal(r.journal.source_key, 'agents/prueba/erick-contacts-1.csv');
});
