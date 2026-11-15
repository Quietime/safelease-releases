// Browser harness for the Android assets. Serves files through the same allowlist as MainActivity
// and answers the Native bridge with node:sqlite, as the project's earlier QA harness did.
// Not covered: Activity recreation, the real camera, file save dialogs and the installer.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash, pbkdf2Sync } from 'node:crypto';
export function startHarness(root, fixtureJpeg, version) {
  const allowed = new Set(JSON.parse(readFileSync(join(root, 'allowlist.json'), 'utf8')));
  const stores = {}, prefs = new Map(); let workspace = 'personal';
  const db = () => { if (!stores[workspace]) { const v = new DatabaseSync(':memory:'); for (const n of readdirSync(join(root, 'migrations')).sort()) v.exec(readFileSync(join(root, 'migrations', n), 'utf8')); stores[workspace] = v; } return stores[workspace]; };
  const bindings = raw => JSON.parse(raw || '[]').map(v => v?.__blob ? Buffer.from(v.__blob, 'base64') : v);
  const pack = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? Number(x) : x instanceof Uint8Array ? { __blob: Buffer.from(x).toString('base64') } : x);
  const scope = k => ['demo-seed', 'session', 'remember-session'].includes(k) ? workspace + ':' + k : k;
  const exports = [];
  function invoke(name, args) {
    try {
      switch (name) {
        case 'isDemoWorkspace': return workspace === 'demo';
        case 'isTesting': return true;
        case 'chooseWorkspace': workspace = args[0]; return null;
        case 'setting': { const k = scope(args[0]); if (args[1] !== null) prefs.set(k, args[1]); return prefs.get(k) || ''; }
        case 'asset': return readFileSync(join(root, args[0]), 'utf8');
        case 'now': return Date.now();
        case 'uuid': return randomUUID();
        case 'random': return randomBytes(args[0]).toString('base64');
        case 'hash': return createHash('sha256').update(args[1] ? Buffer.from(args[0], 'base64') : args[0]).digest('hex');
        case 'encodePassword': { const salt = randomBytes(16).toString('base64'); return salt + ':' + pbkdf2Sync(args[0], Buffer.from(salt, 'base64'), 1000, 32, 'sha256').toString('base64'); }
        case 'checkPassword': { const [salt, hash] = String(args[1]).split(':'); return !!salt && !!hash && pbkdf2Sync(args[0], Buffer.from(salt, 'base64'), 1000, 32, 'sha256').toString('base64') === hash; }
        case 'query': return pack(db().prepare(args[0]).all(...bindings(args[1])));
        case 'run': { const r = db().prepare(args[0]).run(...bindings(args[1])); return pack({ changes: r.changes, lastInsertRowid: r.lastInsertRowid }); }
        case 'exec': db().exec(args[0]); return '{}';
        case 'fixture': return readFileSync(fixtureJpeg).toString('base64');
        case 'updatePreferences': return '{"autoCheck":true,"autoDownload":true,"autoInstall":true}';
        case 'updateStatus': return JSON.stringify({ currentVersion: version, state: 'current' });
        case 'updatePreference': case 'updateAction': return null;
        case 'reference': return '[]';
        case 'validatePhoto': return '{}';
        case 'chooseListingScreenshot': return null;
        case 'makeExport': exports.push(args[1]); return JSON.stringify({ name: 'export.' + args[1], base64: '', digest: '' });
        case 'saveExport': return true;
        default: throw Error('Unexpected bridge method ' + name);
      }
    } catch (e) { return JSON.stringify({ __error: String(e) }); }
  }
  const server = http.createServer(async (req, res) => {
    if (req.url === '/bridge') { let raw = ''; for await (const c of req) raw += c; const { name, args } = JSON.parse(raw); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(invoke(name, args))); return; }
    const pm = req.url.match(/^\/api\/photos\/([0-9a-f-]+)/);
    if (pm) { const row = db().prepare('SELECT bytes,mime FROM photos WHERE id=? AND purged IS NULL').get(pm[1]); if (!row?.bytes) { res.statusCode = 404; res.end(); return; } res.setHeader('Content-Type', row.mime); res.end(Buffer.from(row.bytes)); return; }
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
    if (name.includes('..') || !allowed.has(name) || !existsSync(join(root, name))) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : name.endsWith('.woff2') ? 'font/woff2' : 'text/html');
    res.end(readFileSync(join(root, name)));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: 'http://127.0.0.1:' + server.address().port, server, stores, exports, workspace: () => workspace })));
}
export const bridgeInit = () => { window.Native = new Proxy({}, { get: (_, name) => (...args) => { const x = new XMLHttpRequest(); x.open('POST', '/bridge', false); x.send(JSON.stringify({ name, args })); const result = JSON.parse(x.responseText); if (name === 'chooseWorkspace') setTimeout(() => location.reload(), 0); return result; } }); };
