export const WEB_VERSION = '1.3.0';
export const normalize = s => s.trim().toUpperCase().replace(/\s+/g, ' ');
export function compareNames(masked, owner) {
  const a = normalize(masked), b = normalize(owner), words = a.split(' '), target = b.split(' ');
  if (!a || !b) return 'empty';
  if (/\b(PTE|LTD|LLP|SERVICES)\b/.test(a + ' ' + b)) return 'manual';
  if (!/^[A-Z X]+$/.test(a) || !/^[A-Z ]+$/.test(b)) return 'manual';
  if (a.replace(/[X ]/g, '').length < 3) return 'few';
  if (words.length !== target.length) return 'mismatch';
  const match = words.every((word, i) => {
    const tail = word.endsWith('XX'); const prefix = tail ? word.slice(0, -2) : word;
    const rx = '^' + prefix.replace(/X/g, '[A-Z]') + (tail ? '[A-Z]{1,3}' : '') + '$';
    return new RegExp(rx).test(target[i]);
  });
  return match ? 'match' : 'mismatch';
}
export function daysBetween(a, b) { return Math.ceil((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
export function addDays(date, days) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(days)); return d.toISOString().slice(0, 10); }
export function leaseMonths(start, end) { const s = new Date(start + 'T00:00:00Z'), e = new Date(addDays(end, 1) + 'T00:00:00Z'); let m = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth(); if (e.getUTCDate() > s.getUTCDate()) m++; return Math.max(0, m); }
export function validLink(v) { try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; } }
export function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export const defaultState = () => ({ lang: 'en', demo: true, onboarded: false, name: 'Lin Yue', email: 'lin.yue@example.com', school: 'Orchard Institute', lease: { address: 'Blk 456 Clementi Ave 3 #08-12', owner: 'Tan Mei Ling', start: '2027-08-01', end: '2029-01-31', deposit: 950, rent: 950, refundDays: 14, clause: '4.2' }, rooms: [{ name: 'Bedroom', zh: '卧室', required: 6 }, { name: 'Bathroom', zh: '浴室', required: 5 }, { name: 'Kitchen', zh: '厨房', required: 5 }, { name: 'Living room', zh: '客厅', required: 7 }], record: { status: 'draft', started: null, confirmed: null }, checks: [], reminders: true, notificationsRead: false, renewal: 12, refundReceived: false, template: 0, letters: {}, letterStale: {}, letterPrepared: null, reviewDrafts: [], deductions: [] });
let db;
export async function database() { if (db) return db; db = await new Promise((resolve, reject) => { const req = indexedDB.open('safelease-photos', 1); req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); return db; }
export async function photoStore(action, value) { const d = await database(); return new Promise((resolve, reject) => { const tx = d.transaction('photos', action === 'getAll' ? 'readonly' : 'readwrite'), s = tx.objectStore('photos'); const req = action === 'getAll' ? s.getAll() : action === 'clear' ? s.clear() : s.put(value); tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); }); }
export const DEDUCTION_QUESTIONS = ['clause', 'required', 'breach', 'loss'];
export function inventoryStatus(photos) { const items = photos.filter(p => !p.moveout), missing = items.filter(p => !String(p.note || '').trim()).length; return { total: items.length, missing, ready: items.length > 0 && missing === 0 }; }
export function deductionGaps(d) { return DEDUCTION_QUESTIONS.filter(q => !String(d?.[q] ?? '').trim()); }
export function deductionSummary(list, deposit = 0) { const items = (list || []).map(d => ({ ...d, amount: Math.max(0, Number(d.amount) || 0), missing: deductionGaps(d) })), kept = items.reduce((n, d) => n + d.amount, 0); return { items, kept: Math.round(kept * 100) / 100, open: items.reduce((n, d) => n + d.missing.length, 0), recorded: items.filter(d => d.inventory).length, overDeposit: deposit > 0 && kept > deposit }; }
export function sampleDeductions(photos = [], zh = false) { const m = (photos || []).find(p => !p.moveout && /mattress|床垫/i.test(p.note || '')); return [{ item: zh ? '清洁' : 'Cleaning', amount: 120, loss: zh ? '收据 S$120' : 'Receipt S$120' }, { item: zh ? '床垫污渍' : 'Mattress stain', amount: 70, inventory: m ? m.id : '' }]; }

/* Room-by-room photo progress for the move-in record. */
export function roomProgress(rooms, photos) {
  const items = (photos || []).filter(p => !p.moveout);
  const list = (rooms || []).map((r, i) => { const n = items.filter(p => p.room === i).length; return { n, required: r.required, done: n >= r.required, missing: items.filter(p => p.room === i && !String(p.note || '').trim()).length }; });
  const taken = list.reduce((s, r) => s + Math.min(r.n, r.required), 0), required = list.reduce((s, r) => s + r.required, 0);
  const firstIncomplete = list.findIndex(r => !r.done);
  return { rooms: list, taken, required, complete: list.length > 0 && firstIncomplete < 0, firstIncomplete };
}

export const recordClosed = s => ['locked', 'one_sided'].includes(s.record?.status);
export const recordDone = s => !!s.record?.confirmed || recordClosed(s);

/* Where the student is in the lease, and the single most useful next step.
   Stages: 0 check, 1 pay, 2 move in, 3 live, 4 move out. */
export function journey(s, photos, today) {
  const l = s.lease;
  if (!l) {
    const checked = (s.checks || []).length > 0, paid = compareNames(s.masked || '', s.payeeOwner || '') === 'match';
    return { stage: checked ? 1 : 0, progress: checked ? (paid ? 45 : 30) : 6, next: !checked ? 'check' : !paid ? 'payee' : 'add-lease' };
  }
  const toEnd = daysBetween(today, l.end), sinceStart = daysBetween(l.start, today), length = Math.max(1, daysBetween(l.start, l.end));
  const done = recordDone(s), out = (photos || []).filter(p => p.moveout).length, taken = (photos || []).some(p => !p.moveout);
  let stage, frac = 0;
  if (toEnd <= 30) { stage = 4; }
  else if (sinceStart < 0 || (sinceStart <= 30 && !done)) { stage = 2; frac = sinceStart < 0 ? 0 : Math.min(0.9, sinceStart / 30); }
  else { stage = 3; frac = Math.min(0.95, Math.max(0, sinceStart / Math.max(1, length - 30))); }
  let next;
  if (s.refundReceived) next = 'done';
  else if (toEnd < 0) next = (s.deductions || []).length ? 'deductions' : 'letter';
  else if (toEnd <= 30) next = out ? 'letter' : 'moveout';
  else if (sinceStart <= 30 && !done) next = taken ? 'record-finish' : 'record-start';
  else next = 'deposit';
  return { stage, progress: Math.round(Math.min(100, stage * 25 + frac * 25)), next, toEnd, sinceStart };
}

/* Status of each step on the deposit timeline, derived from the records themselves. */
export function leaseSteps(s, photos) {
  const ins = (photos || []).filter(p => !p.moveout), outs = (photos || []).filter(p => p.moveout);
  const roomsIn = [...new Set(ins.map(p => p.room))];
  const steps = [
    { key: 'record', done: recordDone(s) },
    { key: 'moveout', done: outs.length > 0 && roomsIn.every(r => outs.some(p => p.room === r)) },
    { key: 'letter', done: !!s.letterPrepared },
    { key: 'refund', done: !!s.refundReceived },
  ];
  const current = steps.findIndex(x => !x.done);
  return steps.map((x, i) => ({ ...x, current: i === current }));
}

/* Validates a SafeLease_Backup.json produced by "Download all my data". */
export function parseBackup(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.version !== 1 || typeof data.state !== 'object' || !Array.isArray(data.photos)) throw new Error('format');
  const st = data.state;
  if (!Array.isArray(st.rooms) || typeof st.record !== 'object') throw new Error('format');
  for (const p of data.photos) {
    if (!p || typeof p.id !== 'string' || typeof p.originalBase64 !== 'string' || !p.originalBase64.startsWith('data:image/')) throw new Error('photo');
  }
  return { state: st, photos: data.photos };
}
