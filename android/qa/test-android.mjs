// Acceptance walk for Android 1.7.0 assets in Chromium.
//   python3 android/build_apk.py extract dist/android-assets
//   node android/qa/test-android.mjs dist/android-assets [screenshotDir]
// Needs Node 22.5+ (node:sqlite) and Playwright with Chromium.
import { startHarness, bridgeInit } from './harness.mjs';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const root = resolve(process.argv[2] || 'dist/android-assets'), shots = process.argv[3];
// Same text contrast audit as the project's v1.4 brand checks (WCAG AA 4.5:1).
const contrastAudit=`(()=>{const rgb=s=>{const m=s.match(/^rgba?\\(([^)]+)\\)/);return m?m[1].split(',').map(Number):null};const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};const failures=[],skipped=[];let count=0;const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walk.nextNode()){const e=n.parentElement;if(!n.textContent.trim()||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden')continue;const style=getComputedStyle(e),fg=rgb(style.color);let parent=e,bg=null,gradient=false;while(parent){const s=getComputedStyle(parent);if(s.backgroundImage!=='none'){gradient=true;break;}const col=rgb(s.backgroundColor);if(col&&(col.length===3||col[3]===1)){bg=col;break}parent=parent.parentElement}if(gradient){const ratios=['rgb(212,20,58)','rgb(176,12,39)'].map(s=>ratio(fg,rgb(s)));count++;if(Math.min(...ratios)<4.5)failures.push({text:n.textContent.slice(0,80),ratios});continue}if(!fg||!bg){skipped.push(n.textContent.slice(0,40));continue}count++;const r=ratio(fg,bg);if(r<4.5)failures.push({text:n.textContent.slice(0,80),ratio:r,color:style.color,bg});}return {count,failures,skipped}})()`;
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const browser = await chromium.launch();
const fixturePage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await fixturePage.setContent('<body style="margin:0;background:linear-gradient(135deg,#d9cbb5,#8a7a66)"><div style="position:absolute;left:300px;top:300px;width:500px;height:260px;background:#f4efe6;border-radius:12px"></div></body>');
const fixture = join(root, 'qa-fixture.jpg');
await fixturePage.screenshot({ path: fixture, type: 'jpeg', quality: 80 });
await fixturePage.close();
const h = await startHarness(root, fixture, '1.7.0');
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
await ctx.addInitScript(bridgeInit);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('response', r => { if (r.status() === 404) errors.push('404 ' + r.url()); });
const shot = async name => { if (!shots) return; mkdirSync(shots, { recursive: true }); await p.waitForTimeout(300); await p.screenshot({ path: join(shots, name + '.png'), fullPage: true }); };
const fits = async label => { for (const w of [360, 393, 768]) { await p.setViewportSize({ width: w, height: 852 }); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} overflows at ${w}px`); } await p.setViewportSize({ width: 393, height: 852 }); };
const contrast = async label => { const r = await p.evaluate(contrastAudit); assert.deepEqual(r.failures, [], `${label} contrast failures`); return r.count; };
const progress = () => p.evaluate(() => { const s = document.querySelector('.lease-progress'); return s && { count: s.querySelector('.lp-count').textContent, title: s.querySelector('h2').textContent, target: s.querySelector('[data-step-target]')?.dataset.stepTarget || null }; });
const language = async target => { if (await p.locator('html').getAttribute('lang') !== target) { await p.locator('#language').click(); await p.waitForFunction(() => !document.querySelector('#language').disabled); } };
const home = async () => { await p.locator('#app [data-act="home"]').first().click(); await p.waitForTimeout(400); };
try {
  await p.goto(h.url);
  await p.locator('#guest-login').click();
  await p.locator('#create-lease').waitFor();
  assert.equal(await p.locator('#nav-toggle').isVisible(), false, 'menu toggle hidden on phones');
  const nav = await p.locator('#primary-navigation').boundingBox();
  assert.ok(nav && nav.y + nav.height >= 852 - 1, 'navigation sits at the bottom of the screen');
  assert.equal(await p.locator('#primary-navigation button').count(), 5);
  assert.ok(await p.evaluate(() => { const g = document.querySelector('#guide-intro'), f = document.querySelector('#create-lease'); return g && f && (g.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'guide comes before the create form for a new user');
  await fits('empty home'); await contrast('empty home'); await shot('home-new');
  ok('new user sees bottom navigation and the guide before Create a lease');

  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const f = p.locator('#create-lease');
  await f.locator('[name=address]').fill('Blk 12 Kent Ridge Rd #03-04');
  await f.locator('[name=start_date]').fill(day(5));
  await f.locator('[name=end_date]').fill(day(370));
  await f.locator('[name=deposit]').fill('1800');
  await f.locator('[name=refund_date]').fill(day(384));
  await f.locator('[name=room_names]').fill('Bedroom, Bathroom, Kitchen');
  await f.locator('button.primary').click();
  await p.locator('.lease-progress').waitFor();
  assert.deepEqual(await progress(), { count: '0/5', title: 'Record the move-in condition', target: 'edit-movein' });
  assert.ok(await p.evaluate(() => { const [a, b] = document.querySelectorAll('.record-panel'), m = document.querySelector('#lease-members'); return (a.compareDocumentPosition(m) & 4) && (m.compareDocumentPosition(b) & 4); }), 'members between move-in and move-out');
  assert.equal(await p.locator('button:disabled', { hasText: 'Gallery' }).count(), 0);
  assert.equal(await p.locator('.cl-camera-note').count(), 1);
  await fits('new lease'); await contrast('new lease'); await shot('lease-new');
  await p.locator('[data-step-target]').click();
  await p.waitForFunction(() => document.querySelector('#edit-movein').open);
  ok('a new lease shows 0/5 and Go opens Start recording');

  await home();
  assert.equal(await p.locator('details.create-wrap').count(), 1);
  assert.equal(await p.locator('details.create-wrap').evaluate(d => d.open), false);
  assert.equal(await p.locator('.lease-row').count(), 1);
  ok('returning user sees Create a lease folded away');

  // Release build: no demo mode anywhere, no practice data in the personal workspace.
  assert.equal(await p.locator('#showcase-entry').count(), 0, 'no Demo mode button in the header');
  assert.doesNotMatch(await p.locator('body').innerText(), /demo mode|展示模式|practice space|练习空间/i);
  assert.equal(h.stores.personal.prepare("SELECT count(*) n FROM accounts WHERE email LIKE '%@demo.invalid'").get().n, 0, 'a new install writes no demo accounts');
  await p.locator('#app [data-act="open-lease"]').first().click();
  await p.locator('.lease-progress').waitFor();
  ok('a new install has no demo mode and no demo accounts');

  // A phone that still holds demo accounts from 1.6.2 cannot sign in with them.
  await p.evaluate(() => { const s = window.AndroidDemoStore; s.provision({ email: 'tenant@demo.invalid', name: 'old', role: 'tenant', isTest: true }); });
  await p.reload(); await p.waitForTimeout(600);
  assert.equal(h.stores.personal.prepare("SELECT count(*) n FROM accounts WHERE email LIKE '%@demo.invalid' AND disabled=0").get().n, 0, 'old demo accounts are disabled');
  ok('old demo accounts are locked in the personal workspace');

  // A phone left in the 1.6.2 practice workspace comes back to the personal one on start.
  await p.evaluate(() => Native.chooseWorkspace('demo'));
  await p.waitForTimeout(2500);
  assert.equal(h.workspace(), 'personal', 'the app leaves the practice workspace');
  await p.locator('#app [data-act="open-lease"]').first().click();
  await p.locator('.lease-progress').waitFor();
  ok('a phone left in the practice workspace returns to its own records');

  await language('zh-CN');
  await p.locator('.lease-progress').waitFor();
  assert.match(await p.locator('.lease-progress').innerText(), /下一步/);
  assert.doesNotMatch(await p.locator('.lease-progress').innerText(), /[A-Za-z]{4,}/);
  await fits('zh lease'); await contrast('zh lease'); await shot('lease-zh');
  await language('en');
  assert.doesNotMatch(await p.locator('body').innerText(), /[㐀-鿿]/u);
  ok('progress card is fully localised both ways');

  assert.deepEqual(errors, []);
  ok('no page errors or missing files');
} catch (e) {
  console.error('FAIL', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  h.server.close();
}
