import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAssignmentCsv } from '../assignment-csv.js';
import {
  createJournal,
  loadJournal,
  markInFlight,
  markDone,
  markForReview,
  pendingRows,
  inFlightRows,
  reviewRows,
  removeJournal,
  listOtherJournals,
  journalFileName,
  computeAssignmentId,
  sha256,
} from '../assignment-journal.js';

const CSV = [
  'contact_phone,contact_name,message,id_credito',
  '5500000001,Ana,"Hola {{name}}",C1',
  '5500000002,"Pérez, Juan",Hola,C2',
  '5500000003,Luis,Hola,C3',
].join('\n');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ana-journal-'));
const rowsFrom = (contacts) => contacts.map((c) => ({ index: c.__rowIndex, phone: c.phone }));

const setup = (agentId = 'Erick', campaign = 'Prueba Uno') => {
  const dir = tmpDir();
  const contacts = parseAssignmentCsv(CSV);
  const journal = createJournal({
    dir,
    agentId,
    campaign,
    csvText: CSV,
    rows: rowsFrom(contacts),
    now: new Date('2026-10-26T15:30:12.345Z'),
  });
  return { dir, contacts, journal };
};

test('el parser expone índice y fila original no enumerables', () => {
  const contacts = parseAssignmentCsv(CSV);
  assert.deepEqual(contacts.map((c) => c.__rowIndex), [0, 1, 2]);
  assert.deepEqual(contacts[1].__raw, {
    contact_phone: '5500000002',
    contact_name: 'Pérez, Juan',
    message: 'Hola',
    id_credito: 'C2',
  });
  assert.equal(Object.keys(contacts[0]).includes('__raw'), false);
  assert.equal(JSON.stringify(contacts[0]).includes('__rowIndex'), false);
  assert.deepEqual({ ...contacts[0] }.__raw, undefined);
});

test('creación: todo pending, nombre saneado y assignment_id', () => {
  const { dir, journal } = setup();
  assert.equal(journalFileName('Erick', 'Prueba Uno'), 'assignment-journal-erick-prueba_uno.json');
  assert.ok(fs.existsSync(path.join(dir, 'assignment-journal-erick-prueba_uno.json')));
  assert.equal(fs.existsSync(path.join(dir, 'assignment-journal-erick-prueba_uno.json.tmp')), false);
  assert.deepEqual(journal.rows.map((r) => r.state), ['pending', 'pending', 'pending']);
  assert.equal(journal.assignment_id, `20261026T1530-${sha256(CSV).slice(0, 8)}`);
  assert.equal(journal.received_at, '2026-10-26T15:30:12.345Z');
  assert.equal(JSON.parse(fs.readFileSync(journal.filePath, 'utf8')).filePath, undefined);
});

test('assignment_id estable para el mismo CSV e instante', () => {
  const a = computeAssignmentId('2026-10-26T15:30:59.000Z', sha256(CSV));
  const b = computeAssignmentId('2026-10-26T15:30:00.000Z', sha256(CSV));
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(a, computeAssignmentId('2026-10-26T15:30:00.000Z', sha256(CSV + 'x')));
});

test('transiciones pending → in_flight → done e in_flight → por_revisar, persistidas', () => {
  const { dir, journal } = setup();
  markInFlight(journal, 0);
  markDone(journal, 0);
  markInFlight(journal, 1);

  const loaded = loadJournal({ dir, agentId: 'erick', campaign: ' PRUEBA uno ' });
  assert.equal(loaded.status, 'ok');
  assert.deepEqual(loaded.journal.rows.map((r) => r.state), ['done', 'in_flight', 'pending']);
  assert.deepEqual(inFlightRows(loaded.journal).map((r) => r.index), [1]);
  assert.equal(loaded.contacts.length, 3);
  assert.equal(loaded.contacts[0].message, 'Hola Ana');

  markForReview(loaded.journal, 1);
  const again = loadJournal({ dir, agentId: 'erick', campaign: 'prueba uno' });
  assert.deepEqual(pendingRows(again.journal).map((r) => r.index), [2]);
  assert.deepEqual(reviewRows(again.journal).map((r) => r.index), [1]);
});

test('pendingRows en orden', () => {
  const { journal } = setup();
  markInFlight(journal, 1);
  markDone(journal, 1);
  assert.deepEqual(pendingRows(journal).map((r) => r.index), [0, 2]);
});

test('sin journal ⇒ none; .tmp huérfano ignorado', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'assignment-journal-erick-prueba.json.tmp'), '{"basura":');
  assert.deepEqual(loadJournal({ dir, agentId: 'erick', campaign: 'prueba' }), { status: 'none' });

  const { dir: dir2, journal } = setup('erick', 'prueba');
  fs.writeFileSync(`${journal.filePath}.tmp`, '{"a medias');
  assert.equal(loadJournal({ dir: dir2, agentId: 'erick', campaign: 'prueba' }).status, 'ok');
});

const expectInvalid = (dir, mutate) => {
  const file = path.join(dir, 'assignment-journal-erick-prueba.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const original = mutate(data) ?? data;
  fs.writeFileSync(file, typeof original === 'string' ? original : JSON.stringify(original));
  const res = loadJournal({ dir, agentId: 'erick', campaign: 'prueba', now: new Date('2026-10-27T00:00:00Z') });
  assert.equal(res.status, 'invalid');
  assert.equal(res.contacts, undefined);
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.existsSync(res.invalidPath));
  assert.match(path.basename(res.invalidPath), /^assignment-journal-erick-prueba\.invalid-.*\.json$/);
  return res;
};

test('journal ilegible o inconsistente ⇒ renombrado a *.invalid-*.json sin filas', () => {
  expectInvalid(setup('erick', 'prueba').dir, () => '{no es json');
  expectInvalid(setup('erick', 'prueba').dir, (d) => { d.csv_sha256 = 'x'; });
  expectInvalid(setup('erick', 'prueba').dir, (d) => { d.rows.pop(); });
  expectInvalid(setup('erick', 'prueba').dir, (d) => { d.rows[1].phone = '5599999999'; });
  expectInvalid(setup('erick', 'prueba').dir, (d) => { d.rows[0].state = 'raro'; });
  expectInvalid(setup('erick', 'prueba').dir, (d) => {
    d.csv = d.csv.replace('5500000003', '5500000004');
    d.csv_sha256 = sha256(d.csv);
  });
});

test('eliminación al terminar', () => {
  const { dir, journal } = setup('erick', 'prueba');
  removeJournal(journal);
  assert.equal(fs.existsSync(journal.filePath), false);
  assert.deepEqual(loadJournal({ dir, agentId: 'erick', campaign: 'prueba' }), { status: 'none' });
  removeJournal(journal); // idempotente
});

test('listOtherJournals ignora el propio y los inválidos', () => {
  const { dir } = setup('erick', 'prueba');
  createJournal({ dir, agentId: 'erick', campaign: 'otra', csvText: CSV, rows: [] });
  fs.writeFileSync(path.join(dir, 'assignment-journal-ana-prueba.invalid-x.json'), '{}');
  assert.deepEqual(listOtherJournals(dir, 'erick', 'prueba'), ['assignment-journal-erick-otra.json']);
});
