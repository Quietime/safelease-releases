// End-to-end walk through the web app with a fake camera.
// Usage: serve the repository root (python3 -m http.server 8765), then
//   node tests/e2e.cjs http://localhost:8765/web/ [screenshotDir]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = process.argv[2] || 'http://localhost:8765/web/';
const shots = process.argv[3];
const errors = [];
let step = 0;
const log = msg => console.log(`ok ${++step} - ${msg}`);

async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  assert.ok(sw <= iw, `${label}: page is ${sw}px wide in a ${iw}px viewport`);
}
async function shot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
}
async function hash(page, h) {
  await page.evaluate(x => { location.hash = x; }, h);
  await page.waitForTimeout(120);
}
async function capture(page, note) {
  await page.locator('#shutter:not([disabled])').waitFor();
  await page.click('#shutter');
  await page.locator('#photo-form textarea').fill(note);
  await page.click('#photo-form button[type=submit]');
  await page.locator('#dialog').waitFor({ state: 'hidden' });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, permissions: ['camera', 'clipboard-read', 'clipboard-write'], acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });

  // First visit shows the introduction without navigation.
  await page.goto(base);
  await page.locator('.onboard').waitFor();
  assert.equal(await page.locator('.rail').count(), 0);
  await shot(page, 'm-onboarding');
  await page.click('[data-action="onboard:1"]');
  await page.click('[data-action="onboard:2"]');
  assert.equal(await page.locator('[data-action="onboard-done:own"]').count(), 1);
  await page.click('[data-action="onboard-done:sample"]');
  await page.locator('.hero-next').waitFor();
  assert.match(await page.textContent('.hero-next'), /Prepare for a smooth handover/);
  assert.match(await page.textContent('.stages li.current'), /Live/);
  await noOverflow(page, 'home');
  await shot(page, 'm-home');
  log('first visit introduction, then sample home with derived next step');

  // Reload keeps the user out of the introduction.
  await page.reload();
  await page.locator('.hero-next').waitFor();
  log('returning visit opens home');

  // Deposit tracker renders the renewal warning inside its own box.
  await hash(page, 'lease');
  await page.locator('.steps-card').waitFor();
  await noOverflow(page, 'lease');
  assert.equal(await page.locator('.warning .btn').count(), 1);
  assert.equal(await page.locator('.warning .toggle').count(), 0, 'reminder toggle must not sit inside the renewal warning');
  assert.match(await page.textContent('.step-btn:first-of-type'), /Ready to start/);
  await shot(page, 'm-lease');
  log('deposit tracker layout and derived steps');

  // Record: lower the counts so the full flow can be walked.
  await hash(page, 'record');
  await page.locator('.roomtab.active').waitFor();
  assert.match(await page.textContent('.roomtab.active'), /Bedroom/);
  await page.click('[data-action="modal:room-counts"]');
  for (let i = 0; i < 4; i++) await page.fill(`#counts-form input[name="${i}"]`, '1');
  await page.click('#counts-form button[type=submit]');
  await page.click('.roompanel [data-action="camera:in"]');
  await capture(page, 'Mattress stain near the foot, about 5 cm');
  assert.match(await page.textContent('.roomtab.active'), /1\/1/);
  assert.equal(await page.locator('.roompanel [data-action="room:1"]').count(), 1, 'next room button appears');
  await shot(page, 'm-record-progress');
  await page.click('.roompanel [data-action="room:1"]');
  assert.match(await page.textContent('.roomtab.active'), /Bathroom/);
  await page.click('.roompanel [data-action="camera:in"]');
  await capture(page, '');
  assert.match(await page.textContent('.todo-list'), /Condition lines/);
  assert.ok(await page.locator('[data-action="confirm-record"]').isDisabled());
  for (const r of [2, 3]) {
    await page.click(`.roomtab[data-action="room:${r}"]`);
    await page.click('.roompanel [data-action="camera:in"]');
    await capture(page, 'Clean, no marks');
  }
  await page.click('.todo[data-action^="photo:"]');
  await page.locator('#photo-form textarea').fill('Tiles intact, grout clean');
  await page.click('#photo-form button[type=submit]');
  await page.locator('#dialog').waitFor({ state: 'hidden' });
  assert.ok(await page.locator('[data-action="confirm-record"]').isEnabled());
  await noOverflow(page, 'record');
  await shot(page, 'm-record-ready');
  await page.click('[data-action="confirm-record"]');
  await page.waitForFunction(() => location.hash === '#invite');
  log('move-in record capture, next-room flow, to-do list and confirmation');

  // Back goes to the previous screen, not a fixed one.
  await page.click('.back');
  await page.waitForFunction(() => location.hash === '#record');
  log('back button follows history');

  // Deduction check guardrails and letter.
  await hash(page, 'deduction-check');
  assert.ok(await page.locator('[data-action="ded-letter"]').isDisabled());
  await page.click('[data-action="ded-sample"]');
  assert.match(await page.textContent('[data-action="ded-letter"]'), /open points/);
  assert.ok((await page.locator('select[data-ded="1:inventory"]').inputValue()).length > 0, 'mattress linked to inventory');
  await shot(page, 'm-deduction-check');
  await page.click('[data-action="ded-letter"]');
  await page.waitForFunction(() => location.hash === '#evidence');
  assert.match(await page.textContent('#letter'), /Mattress stain/);
  log('deduction check feeds the letter');

  // Manual edits survive data changes until reset.
  await page.click('#letter');
  await page.keyboard.press('End');
  await page.keyboard.type(' Thanks again.');
  await page.locator('#letter-tools [data-action="letter-reset"]').waitFor();
  await page.click('[data-action="template:1"]');
  await page.fill('#deduction', 'Stove cleaning');
  assert.match(await page.textContent('#letter'), /Stove cleaning/, 'unedited letter follows the fields');
  await page.click('[data-action="template:0"]');
  assert.match(await page.textContent('#letter'), /Thanks again/);
  await hash(page, 'deduction-check');
  await page.fill('input[data-ded="0:clause"]', '4.2');
  await hash(page, 'evidence');
  await page.locator('.small-warning').waitFor();
  await shot(page, 'm-evidence');
  await page.click('[data-action="letter-reset"]');
  assert.doesNotMatch(await page.textContent('#letter'), /Thanks again/);
  await noOverflow(page, 'evidence');
  log('edited letters are kept, flagged when stale, and can be reset');

  // Backup, delete, restore.
  await hash(page, 'profile');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="download-data"]')]);
  const backupPath = await dl.path();
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.equal(backup.photos.length, 4);
  await page.click('[data-action="modal:delete"]');
  await page.fill('#delete-form input', 'DELETE');
  await page.click('#delete-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#home');
  assert.match(await page.textContent('.hero-next'), /Check the listing/);
  await hash(page, 'profile');
  await page.setInputFiles('#restore-file', backupPath);
  await page.click('[data-action="restore-confirm"]');
  await page.waitForFunction(() => location.hash === '#home');
  await hash(page, 'record');
  assert.equal(await page.locator('.roompanel .photo').count(), 1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('safelease-v1')).record.confirmed !== null), true);
  log('backup download, delete and restore round trip');

  // Chinese screens and narrow widths.
  await page.click('[data-action="language"]');
  for (const r of ['home', 'lease', 'record', 'evidence', 'deduction-check', 'check', 'payee', 'profile']) {
    await hash(page, r);
    await noOverflow(page, 'zh ' + r);
    if (['home', 'record', 'evidence'].includes(r)) await shot(page, 'm-zh-' + r);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  for (const r of ['home', 'lease', 'record', 'evidence', 'deduction-check', 'check', 'results', 'payee', 'profile', 'notifications']) {
    await hash(page, r);
    await noOverflow(page, '320 ' + r);
  }
  log('Chinese copy and 320px layouts have no horizontal overflow');

  // Start with my own lease from a fresh browser.
  const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('pageerror ' + e.message));
  await p2.goto(base);
  await p2.click('[data-action="onboard:2"]');
  await p2.click('[data-action="onboard-done:own"]');
  await p2.waitForFunction(() => location.hash === '#add-lease');
  await p2.locator('input[name="yourName"]').waitFor();
  await p2.fill('input[name="yourName"]', 'Alex Chen');
  await p2.fill('input[name="address"]', '12 Kent Ridge Rd #03-04');
  await p2.fill('input[name="owner"]', 'Lim Wei Ming');
  const start = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), end = new Date(Date.now() + 375 * 864e5).toISOString().slice(0, 10);
  await p2.fill('input[name="start"]', start);
  await p2.fill('input[name="end"]', end);
  await shot(p2, 'm-add-lease');
  await p2.click('#lease-form button[type=submit]');
  await p2.waitForFunction(() => location.hash === '#record');
  await hash(p2, 'home');
  assert.match(await p2.textContent('.greeting h1'), /Alex Chen/);
  assert.match(await p2.textContent('.hero-next'), /Build your move-in record/);
  log('own lease routes to the move-in record and greets by name');

  // Desktop layouts.
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => errors.push('pageerror ' + e.message));
  await p3.goto(base + '#home');
  await p3.locator('.hero').waitFor();
  for (const r of ['home', 'record', 'results', 'lease', 'evidence']) {
    await hash(p3, r);
    await noOverflow(p3, 'desktop ' + r);
    await shot(p3, 'd-' + r);
  }
  log('desktop layouts');

  await browser.close();
  assert.deepEqual(errors, [], 'no console or page errors');
  log('no console or page errors');
})().catch(e => { console.error('FAIL', e.message); console.error(errors.join('\n')); process.exit(1); });
