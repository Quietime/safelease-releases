// Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, journey, leaseSteps, roomProgress, parseBackup, compareNames, deductionSummary, WEB_VERSION } from '../web/core.js';

const photo = (room, note = 'ok', moveout = false) => ({ id: Math.random().toString(36).slice(2), room, note, moveout });
const fullRecord = s => s.rooms.flatMap((r, i) => Array.from({ length: r.required }, () => photo(i)));

test('web version is semver', () => assert.match(WEB_VERSION, /^\d+\.\d+\.\d+$/));

test('no lease walks check, payee, add-lease', () => {
  const s = defaultState(); s.lease = null;
  assert.deepEqual([journey(s, [], '2027-01-01').stage, journey(s, [], '2027-01-01').next], [0, 'check']);
  s.checks.push({ id: 'a' });
  assert.equal(journey(s, [], '2027-01-01').next, 'payee');
  s.masked = 'TaX MeX LiXX'; s.payeeOwner = 'Tan Mei Ling';
  assert.equal(compareNames(s.masked, s.payeeOwner), 'match');
  assert.equal(journey(s, [], '2027-01-01').next, 'add-lease');
});

test('new lease before start asks for the move-in record', () => {
  const s = defaultState(); s.demo = false;
  const j = journey(s, [], '2027-07-20');
  assert.equal(j.stage, 2); assert.equal(j.next, 'record-start');
  assert.equal(journey(s, [photo(0)], '2027-08-03').next, 'record-finish');
});

test('sample lease mid-tenancy prepares the handover', () => {
  const s = defaultState();
  const j = journey(s, [], '2028-12-15');
  assert.equal(j.stage, 3); assert.equal(j.next, 'deposit'); assert.equal(j.toEnd, 47);
  assert.ok(j.progress > 75 && j.progress < 100);
});

test('last 30 days and after handover', () => {
  const s = defaultState();
  assert.equal(journey(s, [], '2029-01-10').next, 'moveout');
  assert.equal(journey(s, [photo(0, '', true)], '2029-01-10').next, 'letter');
  assert.equal(journey(s, [], '2029-02-05').next, 'letter');
  s.deductions = [{ item: 'Cleaning', amount: 120 }];
  assert.equal(journey(s, [], '2029-02-05').next, 'deductions');
  s.refundReceived = true;
  assert.equal(journey(s, [], '2029-02-05').next, 'done');
});

test('room progress finds the first incomplete room', () => {
  const s = defaultState();
  const ps = [...Array.from({ length: 6 }, () => photo(0)), photo(1, '')];
  const rp = roomProgress(s.rooms, ps);
  assert.equal(rp.firstIncomplete, 1); assert.equal(rp.taken, 7); assert.equal(rp.required, 23);
  assert.equal(rp.rooms[1].missing, 1); assert.equal(rp.complete, false);
  assert.equal(roomProgress(s.rooms, fullRecord(s)).complete, true);
});

test('lease steps follow the records', () => {
  const s = defaultState();
  let st = leaseSteps(s, []);
  assert.deepEqual(st.map(x => x.done), [false, false, false, false]); assert.equal(st[0].current, true);
  s.record.confirmed = '2027-08-02T00:00:00Z';
  const ps = [photo(0), photo(2), photo(0, '', true)];
  st = leaseSteps(s, ps);
  assert.equal(st[0].done, true); assert.equal(st[1].done, false); assert.equal(st[1].current, true);
  st = leaseSteps(s, [...ps, photo(2, '', true)]);
  assert.equal(st[1].done, true); assert.equal(st[2].current, true);
});

test('backup parser accepts exports and rejects other files', () => {
  const s = defaultState();
  const ok = { version: 1, state: s, photos: [{ id: 'p1', room: 0, originalBase64: 'data:image/jpeg;base64,AAAA' }] };
  assert.equal(parseBackup(JSON.stringify(ok)).photos.length, 1);
  assert.throws(() => parseBackup('{"version":2}'));
  assert.throws(() => parseBackup({ ...ok, photos: [{ id: 'x', originalBase64: 'javascript:alert(1)' }] }));
  assert.throws(() => parseBackup('not json'));
});

test('deduction summary is unchanged', () => {
  const sum = deductionSummary([{ item: 'A', amount: 600, clause: '4' }, { item: 'B', amount: 500 }], 950);
  assert.equal(sum.kept, 1100); assert.equal(sum.open, 7); assert.equal(sum.overDeposit, true);
});
