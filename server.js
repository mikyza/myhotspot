'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const A = require('./lib/auth'), S = require('./lib/services');

// ---------- config ----------
(function loadEnv() {
  const f = path.join(__dirname, '.env'); if (!fs.existsSync(f)) return;
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();
const env = process.env;
const PORT = Number(env.PORT || 3000);
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SECRET = env.SESSION_SECRET && env.SESSION_SECRET !== 'change-me' ? env.SESSION_SECRET : (console.warn('WARNING: set SESSION_SECRET in .env (logins reset on every restart without it)'), A.rand(32));
const PLAN_PRICE = Number(env.PLAN_PRICE_KES || 1500), PLAN_DAYS = Number(env.PLAN_DAYS || 30), TRIAL_DAYS = Number(env.TRIAL_DAYS || 14);
const GRACE_DAYS = Number(env.GRACE_DAYS ?? 2), SITE_PRICE = Number(env.SITE_PRICE_KES || 500); // grace after expiry; price per extra gateway site
const DL_DIR = path.join(__dirname, 'data', 'downloads');
const DOWNLOADS = [
  { key: 'linux', file: 'hotspot-billing-linux.zip', title: 'Linux billing system and router', note: 'Ubuntu or Debian. The machine becomes the router: sign-in gate, auto-connect, usage, speed limits, free TikTok. Best speed.' },
  { key: 'windows', file: 'hotspot-billing-windows.zip', title: 'Windows hotspot server', note: 'Runs in the background on a Windows PC. Good for trying it out and for the sign-in and payment screens.' },
  { key: 'mikrotik', file: 'hotspot-billing-mikrotik.zip', title: 'MikroTik billing system', note: 'For ISPs that already own a MikroTik router. Includes Windows and Linux versions and the router script steps.' },
  { key: 'manual', file: 'MANUAL.txt', title: 'User manual', note: 'Install, activate, MikroTik setup, settings and problems. Also inside every download.' }
];
const dlHash = {};
function dlInfo(d) {
  const f = path.join(DL_DIR, d.file); let st; try { st = fs.statSync(f); } catch { return null; }
  const k = d.file + st.mtimeMs; if (!dlHash[k]) dlHash[k] = require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  return { key: d.key, title: d.title, note: d.note, file: d.file, size: st.size, sha256: dlHash[k], updated: st.mtime };
}
const RELEASE_DIR = path.join(__dirname, 'data', 'releases'), BACKUP_DIR = path.join(__dirname, 'data', 'backups'), BACKUP_KEEP = 7, BACKUP_MAX = 25e6;
const ADMIN_PHONE = S.phone254(env.ADMIN_PHONE || '0746323229'); // protected operator number
const DAY = 86400000, TZ_MS = 3 * 3600000; // Kenya is UTC+3, no daylight saving
const COLS = ['packages', 'vouchers', 'payments', 'accounts', 'sms'];
const SEARCH = { vouchers: ['code', 'id', 'phone', 'package', 'mac'], payments: ['id', 'phone', 'receipt', 'package', 'code'], accounts: ['id', 'name', 'phone', 'account_id'], sms: ['phone', 'status', 'reply'], packages: ['name', 'id'] };
let db;

// ---------- helpers ----------
const send = (res, code, obj, headers = {}) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(b); };
const fail = (res, code, msg) => send(res, code, { ok: false, error: msg });
const readBody = (req, max = 6e6) => new Promise((ok, no) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { no(new Error('too large')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
const hits = new Map();
const limited = (key, max, windowMs) => { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < windowMs); a.push(now); hits.set(key, a); return a.length > max; };
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some(t => now - t < 3600000)) hits.delete(k); }, 600000).unref();
const ip = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const esc = s => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const emailOk = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
const session = req => { const p = A.verify(SECRET, A.cookies(req.headers.cookie).sid); return p && (p.role === 'admin' || p.role === 'isp') ? p : null; };
const setSession = (req, res, payload, ttl = 7 * 86400) => {
  const secure = (req.headers['x-forwarded-proto'] === 'https' || PUBLIC_URL.startsWith('https')) ? '; Secure' : '';
  return `sid=${A.sign(SECRET, payload, ttl)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl}${secure}`;
};
const pub = d => { if (!d) return d; const { pass, api_key, machine_id, refused_machine, diagnostics, ...r } = d; return { ...r, machine_bound: !!machine_id, machine_short: machine_id ? machine_id.slice(0, 10) : '' }; };

// ---------- license ----------
const priceOf = isp => Number(isp.price || PLAN_PRICE) + Math.max(0, Number(isp.sites) || 0) * SITE_PRICE;
function license(isp) {
  const until = isp.valid_until ? new Date(isp.valid_until) : null, now = Date.now();
  const live = until && until.getTime() > now;
  const graceUntil = until ? new Date(until.getTime() + GRACE_DAYS * DAY) : null;
  const inGrace = !live && !!graceUntil && graceUntil.getTime() > now && isp.status === 'active';
  const active = isp.status === 'active' && (!!live || inGrace);
  let message = '', code = '';
  if (isp.status === 'suspended') { message = 'This hotspot was suspended. Contact the software provider.'; code = 'suspended'; }
  else if (inGrace) message = 'Your subscription ended. It locks on ' + graceUntil.toISOString().slice(0, 10) + ' unless you pay.';
  else if (!live) { message = 'Subscription expired. Pay to resume sales.'; code = 'expired'; }
  else if (until.getTime() - now < 3 * DAY) message = 'Subscription ends soon. Please renew.';
  return { active, enforce: isp.enforce !== false, plan: isp.plan || 'trial', valid_until: until ? until.toISOString() : null,
    grace: inGrace, grace_until: graceUntil ? graceUntil.toISOString() : null, max_sites: Math.max(0, Number(isp.sites) || 0),
    code, pay_url: PUBLIC_URL + '/#/isp/billing', message };
}
const ispState = isp => { const l = license(isp); return isp.status === 'suspended' ? 'suspended' : l.grace ? 'grace' : l.active ? (isp.plan === 'trial' ? 'trial' : 'active') : 'expired'; };

// ---------- ISP data ----------
const isPaid = p => ['paid', 'success', 'completed', 'complete'].includes(String(p.status || '').toLowerCase());
const dayKey = ms => new Date(ms + TZ_MS).toISOString().slice(0, 10);
async function overview(isp) {
  const pays = await db.find('payments', { isp_id: isp._id }, { sort: { created_at: -1 }, limit: 20000 });
  const paid = pays.filter(isPaid), now = Date.now(), today = dayKey(now);
  const series = []; for (let i = 13; i >= 0; i--) series.push({ day: dayKey(now - i * DAY), amount: 0, count: 0 });
  const idx = Object.fromEntries(series.map((s, i) => [s.day, i]));
  const sum = { today: 0, week: 0, month: 0, all: 0 };
  for (const p of paid) {
    const t = Date.parse(p.created_at || p.updated_at); if (!t) continue; const a = Number(p.amount) || 0, age = now - t;
    sum.all += a; if (dayKey(t) === today) sum.today += a; if (age < 7 * DAY) sum.week += a; if (age < 30 * DAY) sum.month += a;
    const k = idx[dayKey(t)]; if (k !== undefined) { series[k].amount += a; series[k].count++; }
  }
  const byPkg = {}; for (const p of paid) { const n = p.package || p.package_name || 'Other'; byPkg[n] = (byPkg[n] || 0) + (Number(p.amount) || 0); }
  const counts = {}; for (const c of COLS) counts[c] = await db.count(c, { isp_id: isp._id });
  counts.pending = pays.filter(p => String(p.status).toLowerCase() === 'pending').length;
  const hb = isp.heartbeat || {};
  return { sum, series, byPackage: Object.entries(byPkg).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, amount]) => ({ name, amount })), counts, paidSales: paid.length, heartbeat: { revenue: hb.revenue, mode: hb.mode, os: hb.os, version: hb.version, uptime_sec: hb.uptime_sec, demo_mode: hb.demo_mode, support: hb.support, accounts: hb.accounts, vouchers: hb.vouchers }, last_seen: isp.last_seen, license: license(isp), state: ispState(isp), currency: hb.currency || 'KES' };
}
async function listData(ispId, c, q) {
  if (!COLS.includes(c)) return null;
  const page = Math.max(1, parseInt(q.get('page')) || 1), size = 25, f = { isp_id: ispId };
  const text = (q.get('q') || '').trim().slice(0, 60); if (text) f.$or = SEARCH[c].map(k => ({ [k]: { $regex: esc(text), $options: 'i' } }));
  const status = q.get('status'); if (status) f.status = status;
  const sort = c === 'packages' ? { price: 1 } : c === 'sms' ? { time: -1 } : { created_at: -1 };
  const total = await db.count(c, f), items = await db.find(c, f, { sort, skip: (page - 1) * size, limit: size });
  return { items: items.map(({ _id, isp_id, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / size)) };
}

// ---------- subscription payments ----------
async function creditSub(sub, receipt) {
  const fresh = await db.findOne('subs', { _id: sub._id }); if (!fresh || fresh.status === 'paid') return false;
  const isp = await db.findOne('isps', { _id: fresh.isp_id }); if (!isp) return false;
  const base = Math.max(Date.now(), isp.valid_until ? new Date(isp.valid_until).getTime() : 0), until = new Date(base + (fresh.days || PLAN_DAYS) * DAY);
  await db.set('subs', fresh._id, { status: 'paid', receipt: receipt || fresh.receipt || '', paid_at: new Date() });
  await db.set('isps', isp._id, { valid_until: until, plan: 'monthly', status: isp.status === 'suspended' ? 'suspended' : 'active', reminded_for: null, reminder_stage: null });
  S.sendSms(env, isp.phone, `Hotspot Cloud: payment of KES ${fresh.amount} received${receipt ? ' (' + receipt + ')' : ''}. Your software is active until ${until.toISOString().slice(0, 10)}.`);
  return true;
}
async function refreshSub(sub) {
  if (sub.status !== 'pending') return sub;
  if (Date.now() - new Date(sub.created).getTime() > 3 * 3600000) { await db.set('subs', sub._id, { status: 'failed', note: 'timed out' }); return { ...sub, status: 'failed' }; }
  try { const r = await S.payheroStatus(env, sub._id); if (r.state === 'paid') { await creditSub(sub, r.receipt); } else if (r.state === 'failed') await db.set('subs', sub._id, { status: 'failed' }); } catch { /* try again next poll */ }
  return db.findOne('subs', { _id: sub._id });
}

// ---------- signed releases (made on your own computer with tools/sign-release.js) ----------
// Staged rollout: manifest.rollout = { pilot: ["isp-abc"], percent: 0-100, not_before: "ISO date" }.
// No rollout block = everyone. Otherwise the pilot ISPs get the update first; the rest only after
// not_before, and only the share of ISPs picked by percent (a stable hash of the ISP id).
function rolloutAllows(rollout, ispId, now = Date.now()) {
  if (!rollout || typeof rollout !== 'object') return true;
  if (Array.isArray(rollout.pilot) && rollout.pilot.includes(ispId)) return true;
  const nb = rollout.not_before ? Date.parse(rollout.not_before) : 0;
  if (nb && now < nb) return false;
  const pct = Math.max(0, Math.min(100, Number(rollout.percent) || 0));
  if (pct <= 0) return false;
  return parseInt(A.hmacHex('rollout', String(ispId)).slice(0, 8), 16) % 100 < pct;
}
function latestRelease(arch, ispId) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(RELEASE_DIR, 'manifest.json'), 'utf8')), f = m.files && m.files[arch];
    if (!f || !m.version) return null;
    if (!rolloutAllows(m.rollout, ispId)) return null;
    return { version: m.version, notes: String(m.notes || '').slice(0, 400), arch, sha256: f.sha256, size: f.size, sig: f.sig, url: PUBLIC_URL + '/releases/' + encodeURIComponent(f.file) };
  } catch { return null; }
}


// ---------- remote control: commands queued here, run by the ISP's billing system ----------
const REMOTE_OWNER = ['business_name','currency','tagline','support_phone','support_whatsapp','support_email','support_hours','admin_phone','code_length','demo_mode','router_ip','sms.enabled','sms.message_template','alerts.off','alerts.no_daily','alerts.summary_hour','free.enabled','free.minutes','free.cooldown_hours','free.domains','free.os_checks','gateway.no_fastpath','gateway.no_ttl_guard','mikrotik.enabled','mikrotik.host','mikrotik.port','mikrotik.username','mikrotik.profile','mikrotik.server'];
const REMOTE_SECRET = ['sms.api_key','payhero.api_username','payhero.api_password','payhero.auth_token','mikrotik.password','admin_password'];
const REMOTE_OPERATOR = ['gateway.enabled','gateway.lan','gateway.wan','gateway.tls_port','sms.url','sms.method','sms.content_type','sms.headers','sms.body','sms.sender_id','sms.success_contains','payhero.base_url','payhero.provider','payhero.channel_id', ...REMOTE_SECRET];
const REMOTE_TYPES = { settings: 1, package_save: 1, package_delete: 1, gateway_apply: 1, router_test: 1, backup_now: 1, diagnostics_send: 1, sync_now: 1, restart: 1 };
const PKG_FIELDS = ['id', 'name', 'price', 'duration_minutes', 'data_mb', 'router_profile', 'kind', 'enabled', 'allow_sharing', 'speed_down_kbps', 'speed_up_kbps'];
function maskParams(c) {
  if (c.type !== 'settings' || !c.params || !c.params.set) return c.params;
  const set = { ...c.params.set }; for (const k of REMOTE_SECRET) if (k in set) set[k] = '••••••'; return { set };
}
async function queueCommand(isp, by, actor, type, params) {
  if (!REMOTE_TYPES[type]) return 'Unknown command.';
  params = params && typeof params === 'object' ? params : {};
  if (type === 'settings') {
    const set = params.set; if (!set || typeof set !== 'object' || !Object.keys(set).length || Object.keys(set).length > 60) return 'Choose at least one setting to change.';
    const ok = by === 'operator' ? [...REMOTE_OWNER, ...REMOTE_OPERATOR] : REMOTE_OWNER;
    for (const k of Object.keys(set)) { if (!ok.includes(k)) return REMOTE_OPERATOR.includes(k) ? `"${k}" can only be changed by the software provider.` : `"${k}" cannot be changed from the website.`; const v = set[k]; if (!['string', 'number', 'boolean'].includes(typeof v) || String(v).length > 4000) return `"${k}" has a value that is not allowed.`; }
    params = { set };
  } else if (type === 'package_save') {
    const p = {}; for (const k of PKG_FIELDS) if (params[k] !== undefined) p[k] = params[k];
    if (!String(p.name || '').trim() || !(Number(p.price) >= 1) || !(Number(p.duration_minutes) >= 1)) return 'A package needs a name, a price of 1 or more and a duration in minutes.';
    for (const k of ['price', 'duration_minutes', 'data_mb', 'speed_down_kbps', 'speed_up_kbps']) if (p[k] !== undefined) p[k] = Math.max(0, Math.round(Number(p[k]) || 0));
    for (const k of ['enabled', 'allow_sharing']) if (p[k] !== undefined) p[k] = !!p[k];
    for (const k of ['id', 'name', 'router_profile', 'kind']) if (p[k] !== undefined) p[k] = String(p[k]).slice(0, 60);
    params = p;
  } else if (type === 'package_delete') {
    if (!/^[\w-]{1,40}$/.test(String(params.id || ''))) return 'Pick a package.'; params = { id: String(params.id) };
  } else params = {};
  const open = (await db.find('commands', { isp_id: isp._id }, { limit: 500 })).filter(c => c.status === 'pending' || c.status === 'sent');
  if (open.length >= 30) return 'Too many commands are waiting. The hotspot may be offline; wait for it to catch up.';
  const c = { _id: 'cmd-' + A.rand(6), isp_id: isp._id, type, params, by, actor: String(actor || '').slice(0, 80), status: 'pending', created: new Date() };
  await db.upsert('commands', c._id, c);
  const all = await db.find('commands', { isp_id: isp._id }, { sort: { created: -1 }, limit: 400 });
  for (const old of all.slice(100)) await db.deleteOne('commands', old._id);
  return c;
}
const cmdView = c => ({ id: c._id, type: c.type, params: maskParams(c), by: c.by, actor: c.actor, status: c.status, result: c.result || '', created: c.created, done_at: c.done_at || null });

// ---------- routes ----------
async function api(req, res, u) {
  const m = req.method, p = u.pathname, q = u.searchParams;
  const isWrite = m !== 'GET' && m !== 'HEAD';

  // ---- hotspot sync (HMAC signed, no cookie) ----
  if (p === '/api/v1/sync' && m === 'POST') {
    if (limited('sync:' + ip(req), 600, 60000)) return fail(res, 429, 'slow down');
    const raw = await readBody(req), id = String(req.headers['x-isp-id'] || ''), ts = String(req.headers['x-timestamp'] || ''), sig = String(req.headers['x-signature'] || '');
    const isp = id ? await db.findOne('isps', { _id: id }) : null;
    if (!isp || Math.abs(Date.now() / 1000 - Number(ts)) > 300 || !A.safeEq(A.hmacHex(isp.api_key, ts + '.' + raw.toString('utf8')), sig)) return fail(res, 401, 'bad signature');
    let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, 'bad json'); }
    const now = new Date(); let n = 0;
    const reply = obj => { const out = JSON.stringify(obj); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Reply-Signature': A.hmacHex(isp.api_key, 'reply.' + ts + '.' + out) }); return res.end(out); };
    // One licence = one machine. The first machine to sync is bound; any other one is refused until released.
    const mid = String(req.headers['x-machine-id'] || '').slice(0, 80), hostName = String((body.heartbeat || {}).host || '').slice(0, 60);
    if (!/^m-[0-9a-f]{32}$/.test(mid)) return reply({ ok: true, applied: 0, license: { ...license(isp), active: false, code: 'update', message: 'This version of the software is too old for the licence system. Install the latest update.' } });
    if (isp.machine_id && isp.machine_id !== mid) {
      await db.set('isps', isp._id, { last_refused: now, refused_machine: mid });
      return reply({ ok: true, applied: 0, license: { ...license(isp), active: false, code: 'machine', message: 'This licence is already used on another machine (' + (isp.machine_name || 'unnamed') + '). Open your website dashboard, Connect hotspot, and press "Move to another machine" first.' } });
    }
    if (!isp.machine_id) { isp.machine_id = mid; await db.set('isps', isp._id, { machine_id: mid, machine_name: hostName, machine_bound_at: now }); }
    for (const op of (Array.isArray(body.ops) ? body.ops : []).slice(0, 3000)) {
      if (!op || !COLS.includes(op.c) || typeof op.id !== 'string' || !op.id || op.id.length > 200) continue;
      const _id = `${isp._id}:${op.c}:${op.id}`;
      if (op.op === 'delete') { await db.deleteOne(op.c, _id); n++; continue; }
      if (op.op !== 'upsert' || typeof op.data !== 'object' || !op.data) continue;
      const data = {}; for (const [k, v] of Object.entries(op.data)) if (!k.startsWith('$') && !k.includes('.')) data[k] = v;
      if (data.delete_at) { const d = new Date(data.delete_at); if (isNaN(d)) delete data.delete_at; else { data.delete_at = d; if (d <= now) { await db.deleteOne(op.c, _id); continue; } } }
      await db.upsert(op.c, _id, { ...data, id: op.id, isp_id: isp._id, synced_at: now }); n++;
    }
    const upd = { last_seen: now }; if (body.heartbeat && typeof body.heartbeat === 'object') { upd.heartbeat = body.heartbeat; upd.version = String(body.heartbeat.version || ''); upd.business_synced = String(body.heartbeat.business || ''); }
    await db.set('isps', isp._id, upd);
    // The reply is signed with the ISP's api_key (bound to this request's timestamp) so the Linux app
    // can tell it really came from this server. Without it a fake server could unlock the app.
    const arch = String(req.headers['x-app-arch'] || '').replace(/[^a-z0-9-]/g, '').slice(0, 20);
    for (const r of (Array.isArray(body.cmd_results) ? body.cmd_results : []).slice(0, 50)) {
      if (!r || typeof r.id !== 'string') continue;
      const c = await db.findOne('commands', { _id: r.id, isp_id: isp._id });
      if (c && c.status !== 'ok' && c.status !== 'failed') await db.set('commands', c._id, { status: r.ok ? 'ok' : 'failed', result: String(r.msg || '').slice(0, 300), done_at: now, params: maskParams(c) });
    }
    const waiting = (await db.find('commands', { isp_id: isp._id }, { sort: { created: 1 }, limit: 200 })).filter(c => c.status === 'pending' || c.status === 'sent');
    const due = [];
    for (const c of waiting) {
      if (now - new Date(c.created) > 7 * DAY) { await db.set('commands', c._id, { status: 'failed', result: 'Expired: the hotspot did not pick it up within 7 days.', done_at: now, params: maskParams(c) }); continue; }
      if (c.status === 'sent' && now - new Date(c.sent_at) < 90000) continue;
      if (due.length < 10) { due.push(c); await db.set('commands', c._id, { status: 'sent', sent_at: now }); }
    }
    return reply({ ok: true, applied: n, license: license({ ...isp, ...upd }), update: latestRelease(arch, isp._id), commands: due.map(c => ({ id: c._id, type: c.type, params: c.params, by: c.by })) });
  }

  // ---- signed requests that are not the main sync (backups, diagnostics) ----
  const signedIsp = async (raw) => {
    const id = String(req.headers['x-isp-id'] || ''), ts = String(req.headers['x-timestamp'] || ''), sig = String(req.headers['x-signature'] || '');
    const isp = id && /^[\w-]{3,64}$/.test(id) ? await db.findOne('isps', { _id: id }) : null;
    if (!isp || Math.abs(Date.now() / 1000 - Number(ts)) > 300 || !A.safeEq(A.hmacBuf(isp.api_key, ts + '.', raw), sig)) return null;
    return isp;
  };
  if (p === '/api/v1/backup' && (m === 'POST' || m === 'GET')) {
    if (limited('bk:' + ip(req), 60, 60000)) return fail(res, 429, 'slow down');
    const raw = m === 'POST' ? await readBody(req, BACKUP_MAX + 1024).catch(() => null) : Buffer.alloc(0);
    if (!raw) return fail(res, 413, 'too large');
    const isp = await signedIsp(raw); if (!isp) return fail(res, 401, 'bad signature');
    const dir = path.join(BACKUP_DIR, isp._id.replace(/[^\w-]/g, '_'));
    const files = () => { try { return fs.readdirSync(dir).filter(f => /^\d{13}\.bin$/.test(f)).sort().reverse(); } catch { return []; } };
    if (m === 'POST') {
      if (raw.length < 40 || raw.length > BACKUP_MAX || raw.slice(0, 3).toString() !== 'HB1') return fail(res, 400, 'not a backup');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const name = Date.now() + '.bin'; fs.writeFileSync(path.join(dir, name + '.tmp'), raw, { mode: 0o600 }); fs.renameSync(path.join(dir, name + '.tmp'), path.join(dir, name));
      for (const f of files().slice(BACKUP_KEEP)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
      await db.set('isps', isp._id, { backup_at: new Date(), backup_size: raw.length });
      return send(res, 200, { ok: true, kept: Math.min(BACKUP_KEEP, files().length) });
    }
    if (q.get('list')) return send(res, 200, { ok: true, items: files().map(f => ({ name: f, time: new Date(parseInt(f)).toISOString(), size: fs.statSync(path.join(dir, f)).size })) });
    const latest = files()[0]; if (!latest) return fail(res, 404, 'no backup yet');
    const b = fs.readFileSync(path.join(dir, latest));
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.length, 'Cache-Control': 'no-store' }); return res.end(b);
  }
  if (p === '/api/v1/diagnostics' && m === 'POST') {
    if (limited('dg:' + ip(req), 20, 600000)) return fail(res, 429, 'slow down');
    const raw = await readBody(req, 300000).catch(() => null); if (!raw) return fail(res, 413, 'too large');
    const isp = await signedIsp(raw); if (!isp) return fail(res, 401, 'bad signature');
    let d; try { d = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, 'bad json'); }
    if (!d || typeof d !== 'object') return fail(res, 400, 'bad json');
    const entry = { time: new Date().toISOString(), note: String(d.note || '').slice(0, 500), report: String(d.report || '').slice(0, 200000) };
    const list = [entry, ...(Array.isArray(isp.diagnostics) ? isp.diagnostics : [])].slice(0, 5);
    await db.set('isps', isp._id, { diagnostics: list, diag_at: new Date() });
    return send(res, 200, { ok: true });
  }

  // ---- PayHero callback (secret in URL) ----
  if (p === '/api/payhero/callback' && m === 'POST') {
    if (!env.PAYHERO_CALLBACK_SECRET || !A.safeEq(q.get('s') || '', env.PAYHERO_CALLBACK_SECRET)) return fail(res, 401, 'no');
    let b = {}; try { b = JSON.parse((await readBody(req, 1e5)).toString('utf8')); } catch { /* ignore */ }
    const r = b.response || b, ref = r.ExternalReference || r.external_reference || '';
    const sub = ref ? await db.findOne('subs', { _id: ref }) : null;
    if (sub) {
      const ok = Number(r.ResultCode) === 0 || String(r.Status || r.status).toLowerCase() === 'success';
      if (ok && (r.Amount === undefined || Number(r.Amount) >= sub.amount)) await creditSub(sub, r.MpesaReceiptNumber || r.receipt || '');
      else if (!ok && sub.status === 'pending') await db.set('subs', sub._id, { status: 'failed', note: String(r.ResultDesc || '').slice(0, 120) });
    }
    return send(res, 200, { ok: true });
  }

  // ---- public auth ----
  if (p === '/api/register' && m === 'POST') {
    if (limited('reg:' + ip(req), 5, 3600000)) return fail(res, 429, 'Too many sign-ups from this address. Try again later.');
    const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
    const business = String(b.business || '').trim().slice(0, 80), name = String(b.name || '').trim().slice(0, 80), email = String(b.email || '').trim().toLowerCase(), phone = S.phone254(b.phone), pw = String(b.password || '');
    if (!business || !name) return fail(res, 400, 'Enter your business and your name.');
    if (!emailOk(email)) return fail(res, 400, 'Enter a valid email address.');
    if (!phone) return fail(res, 400, 'Enter a Kenyan mobile number such as 0712345678.');
    if (phone === ADMIN_PHONE) return fail(res, 403, 'That number is reserved.');
    if (pw.length < 8) return fail(res, 400, 'Use a password of at least 8 characters.');
    if (await db.findOne('isps', { email })) return fail(res, 409, 'That email already has an account. Sign in instead.');
    const isp = { _id: 'isp-' + A.rand(3), business, name, email, phone, pass: A.hashPw(pw), api_key: A.rand(24), status: 'active', enforce: true, plan: 'trial', valid_until: new Date(Date.now() + TRIAL_DAYS * DAY), created: new Date(), last_seen: null };
    try { await db.upsert('isps', isp._id, isp); } catch (e) { return fail(res, 409, 'That email already has an account.'); }
    S.sendSms(env, phone, `Welcome to Hotspot Cloud, ${name}. Your ISP id is ${isp._id}. Your ${TRIAL_DAYS}-day trial has started.`);
    return send(res, 200, { ok: true }, { 'Set-Cookie': setSession(req, res, { role: 'isp', id: isp._id }) });
  }
  if (p === '/api/login' && m === 'POST') {
    if (limited('login:' + ip(req), 10, 600000)) return fail(res, 429, 'Too many attempts. Wait ten minutes.');
    const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'), email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    const idPhone = S.phone254(email), isAdminId = (env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase()) || (ADMIN_PHONE && idPhone === ADMIN_PHONE);
    if (isAdminId && env.ADMIN_PASSWORD && A.safeEq(pw, env.ADMIN_PASSWORD)) return send(res, 200, { ok: true, role: 'admin' }, { 'Set-Cookie': setSession(req, res, { role: 'admin', id: 'admin' }, 12 * 3600) });
    const isp = await db.findOne('isps', { email });
    if (isAdminId || !isp || !A.checkPw(pw, isp.pass)) return fail(res, 401, 'Email, phone or password is wrong.');
    return send(res, 200, { ok: true, role: 'isp' }, { 'Set-Cookie': setSession(req, res, { role: 'isp', id: isp._id }) });
  }
  if (p === '/api/logout' && m === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  if (p === '/api/health') return send(res, 200, { ok: true, db: db.kind });
  if (p === '/api/config') return send(res, 200, { ok: true, price: PLAN_PRICE, days: PLAN_DAYS, trial_days: TRIAL_DAYS, server: PUBLIC_URL, site_price: SITE_PRICE, grace_days: GRACE_DAYS });

  // ---- everything below needs a session ----
  const ses = session(req);
  if (p === '/api/me') {
    if (!ses) return send(res, 200, { ok: true, role: null });
    if (ses.role === 'admin') return send(res, 200, { ok: true, role: 'admin' });
    const isp = await db.findOne('isps', { _id: ses.id }); return isp ? send(res, 200, { ok: true, role: 'isp', isp: pub(isp), state: ispState(isp), license: license(isp) }) : send(res, 200, { ok: true, role: null });
  }
  if (!ses) return fail(res, 401, 'Please sign in.');
  if (isWrite && req.headers['x-requested-with'] !== 'dash') return fail(res, 403, 'Blocked.');

  // ---- ISP dashboard ----
  if (p.startsWith('/api/isp/')) {
    if (ses.role !== 'isp') return fail(res, 403, 'ISP accounts only.');
    const isp = await db.findOne('isps', { _id: ses.id }); if (!isp) return fail(res, 401, 'Account not found.');
    let dm;
    if ((dm = p.match(/^\/api\/isp\/download\/(\w+)$/))) {
      const d = DOWNLOADS.find(x => x.key === dm[1]), info = d && dlInfo(d); if (!info) return fail(res, 404, 'Not found.');
      res.writeHead(200, { 'Content-Type': d.file.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/zip', 'Content-Length': info.size, 'Content-Disposition': `attachment; filename="${d.file}"`, 'Cache-Control': 'private, no-store' });
      return fs.createReadStream(path.join(DL_DIR, d.file)).pipe(res);
    }
    if (p === '/api/isp/commands' && m === 'GET') return send(res, 200, { ok: true, items: (await db.find('commands', { isp_id: isp._id }, { sort: { created: -1 }, limit: 25 })).map(cmdView), online: !!(isp.last_seen && Date.now() - new Date(isp.last_seen) < 120000), settings: (isp.heartbeat || {}).settings || null });
    if (p === '/api/isp/commands' && m === 'POST') {
      const b = JSON.parse((await readBody(req, 2e4)).toString() || '{}'); const c = await queueCommand(isp, 'owner', isp.email, String(b.type || ''), b.params);
      return typeof c === 'string' ? fail(res, 400, c) : send(res, 200, { ok: true, id: c._id });
    }
    if (p === '/api/isp/downloads') return send(res, 200, { ok: true, items: DOWNLOADS.map(dlInfo).filter(Boolean) });
    if (p === '/api/isp/overview') return send(res, 200, { ok: true, ...(await overview(isp)) });
    let mm;
    if ((mm = p.match(/^\/api\/isp\/data\/(\w+)$/))) { const r = await listData(isp._id, mm[1], q); return r ? send(res, 200, { ok: true, ...r }) : fail(res, 404, 'Unknown list.'); }
    if (p === '/api/isp/connect') return send(res, 200, { ok: true, isp_id: isp._id, api_key: isp.api_key, server: PUBLIC_URL, machine: isp.machine_id ? { name: isp.machine_name || '', id_short: isp.machine_id.slice(0, 10), bound_at: isp.machine_bound_at, can_release: !isp.machine_released_at || Date.now() - new Date(isp.machine_released_at) > 7 * DAY } : null, sites: Math.max(0, Number(isp.sites) || 0) });
    if (p === '/api/isp/release-machine' && m === 'POST') {
      if (!isp.machine_id) return fail(res, 400, 'No machine is bound yet.');
      if (isp.machine_released_at && Date.now() - new Date(isp.machine_released_at) < 7 * DAY) return fail(res, 429, 'A licence can be moved once every 7 days. Contact the software provider if you must move it sooner.');
      await db.set('isps', isp._id, { machine_id: null, machine_name: '', machine_bound_at: null, machine_released_at: new Date() });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/isp/billing') {
      const subs = await db.find('subs', { isp_id: isp._id }, { sort: { created: -1 }, limit: 50 });
      return send(res, 200, { ok: true, price: priceOf(isp), base_price: Number(isp.price || PLAN_PRICE), sites: Math.max(0, Number(isp.sites) || 0), site_price: SITE_PRICE, grace_days: GRACE_DAYS, days: PLAN_DAYS, license: license(isp), plan: isp.plan, valid_until: isp.valid_until, subs: subs.map(s => ({ ref: s._id, amount: s.amount, status: s.status, receipt: s.receipt, created: s.created, paid_at: s.paid_at, phone: s.phone })) });
    }
    if (p === '/api/isp/pay' && m === 'POST') {
      if (limited('pay:' + isp._id, 6, 3600000)) return fail(res, 429, 'Too many payment requests. Try again in an hour.');
      const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'), phone = S.phone254(b.phone || isp.phone);
      if (!phone) return fail(res, 400, 'Enter a valid M-Pesa number.');
      const amount = priceOf(isp), ref = `SUB${Date.now().toString(36)}${A.rand(3)}`.toUpperCase();
      await db.upsert('subs', ref, { isp_id: isp._id, business: isp.business, amount, phone, days: PLAN_DAYS, status: 'pending', created: new Date() });
      try { await S.payheroPush(env, { amount, phone, ref, name: isp.business, callbackUrl: `${PUBLIC_URL}/api/payhero/callback?s=${encodeURIComponent(env.PAYHERO_CALLBACK_SECRET || '')}` }); }
      catch (e) { await db.set('subs', ref, { status: 'failed', note: e.message.slice(0, 160) }); return fail(res, 502, 'Could not start the M-Pesa prompt: ' + e.message); }
      return send(res, 200, { ok: true, ref });
    }
    if ((mm = p.match(/^\/api\/isp\/pay\/(\w+)$/))) {
      const sub = await db.findOne('subs', { _id: mm[1], isp_id: isp._id }); if (!sub) return fail(res, 404, 'Not found.');
      const s = await refreshSub(sub); return send(res, 200, { ok: true, status: s.status, receipt: s.receipt });
    }
    if (p === '/api/isp/password' && m === 'POST') {
      const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      if (!A.checkPw(String(b.current || ''), isp.pass)) return fail(res, 400, 'Current password is wrong.');
      if (String(b.next || '').length < 8) return fail(res, 400, 'Use at least 8 characters.');
      await db.set('isps', isp._id, { pass: A.hashPw(b.next) }); return send(res, 200, { ok: true });
    }
    if (p === '/api/isp/profile' && m === 'POST') {
      const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'), phone = S.phone254(b.phone), business = String(b.business || '').trim().slice(0, 80);
      if (!phone || !business) return fail(res, 400, 'Enter a business name and a valid phone number.');
      if (phone === ADMIN_PHONE && isp.phone !== ADMIN_PHONE) return fail(res, 403, 'That number is reserved.');
      await db.set('isps', isp._id, { phone, business }); return send(res, 200, { ok: true });
    }
    if (p === '/api/isp/rotate-key' && m === 'POST') { const k = A.rand(24); await db.set('isps', isp._id, { api_key: k }); return send(res, 200, { ok: true, api_key: k }); }
    return fail(res, 404, 'Not found.');
  }

  // ---- operator console ----
  if (p.startsWith('/api/admin/')) {
    if (ses.role !== 'admin') return fail(res, 403, 'Operator only.');
    if (p === '/api/admin/overview') {
      const isps = await db.find('isps', {}, { limit: 5000 }), subs = await db.find('subs', { status: 'paid' }, { sort: { paid_at: -1 }, limit: 5000 }), now = Date.now();
      const states = { active: 0, trial: 0, grace: 0, expired: 0, suspended: 0 }; let online = 0, cust = { today: 0, month: 0, all: 0 };
      for (const i of isps) { states[ispState(i)]++; if (i.last_seen && now - new Date(i.last_seen) < 600000) online++; const r = (i.heartbeat || {}).revenue || {}; cust.today += r.today || 0; cust.month += r.month || 0; cust.all += r.all || 0; }
      const mrr = subs.filter(s => now - new Date(s.paid_at) < 30 * DAY).reduce((a, s) => a + s.amount, 0), total = subs.reduce((a, s) => a + s.amount, 0);
      const series = []; for (let i = 13; i >= 0; i--) series.push({ day: dayKey(now - i * DAY), amount: 0 });
      for (const s of subs) { const k = series.find(x => x.day === dayKey(new Date(s.paid_at).getTime())); if (k) k.amount += s.amount; }
      const dueSoon = isps.filter(i => (ispState(i) === 'active' || ispState(i) === 'grace') && i.valid_until && new Date(i.valid_until) - now < 5 * DAY).map(i => ({ id: i._id, business: i.business, valid_until: i.valid_until }));
      return send(res, 200, { ok: true, isps: isps.length, states, online, subs: { last30: mrr, all: total, count: subs.length }, customers: cust, series, dueSoon, recent: subs.slice(0, 8).map(s => ({ business: s.business, amount: s.amount, paid_at: s.paid_at, receipt: s.receipt })), db: db.kind });
    }
    if (p === '/api/admin/isps' && m === 'GET') {
      const t = (q.get('q') || '').toLowerCase(), now = Date.now();
      const rows = (await db.find('isps', {}, { sort: { created: -1 }, limit: 5000 })).filter(i => !t || [i.business, i.email, i._id, i.phone].join(' ').toLowerCase().includes(t));
      return send(res, 200, { ok: true, items: rows.map(i => ({ ...pub(i), id: i._id, state: ispState(i), online: !!(i.last_seen && now - new Date(i.last_seen) < 600000), revenue: (i.heartbeat || {}).revenue || null })) });
    }
    if (p === '/api/admin/isps' && m === 'POST') {
      const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'), email = String(b.email || '').trim().toLowerCase(), phone = S.phone254(b.phone), pw = String(b.password || '');
      if (phone === ADMIN_PHONE) return fail(res, 403, 'That number is reserved for the operator.');
      if (!String(b.business || '').trim() || !emailOk(email) || !phone || pw.length < 8) return fail(res, 400, 'Business, valid email, Kenyan phone and a password of 8+ characters are required.');
      if (await db.findOne('isps', { email })) return fail(res, 409, 'That email already exists.');
      const isp = { _id: 'isp-' + A.rand(3), business: String(b.business).trim().slice(0, 80), name: String(b.name || b.business).slice(0, 80), email, phone, pass: A.hashPw(pw), api_key: A.rand(24), status: 'active', enforce: true, plan: 'trial', valid_until: new Date(Date.now() + (Number(b.days) || TRIAL_DAYS) * DAY), created: new Date(), last_seen: null };
      await db.upsert('isps', isp._id, isp); return send(res, 200, { ok: true, id: isp._id, api_key: isp.api_key });
    }
    if (p === '/api/admin/subs') { const subs = await db.find('subs', {}, { sort: { created: -1 }, limit: 200 }); return send(res, 200, { ok: true, items: subs.map(s => ({ ref: s._id, ...s, _id: undefined })) }); }
    let mm;
    if ((mm = p.match(/^\/api\/admin\/isps\/([\w-]+)$/)) && m === 'GET') {
      const isp = await db.findOne('isps', { _id: mm[1] }); if (!isp) return fail(res, 404, 'Not found.');
      const subs = await db.find('subs', { isp_id: isp._id }, { sort: { created: -1 }, limit: 30 });
      return send(res, 200, { ok: true, isp: { ...pub(isp), id: isp._id }, state: ispState(isp), license: license(isp), overview: await overview(isp), subs: subs.map(s => ({ ref: s._id, amount: s.amount, status: s.status, receipt: s.receipt, created: s.created, paid_at: s.paid_at })) });
    }
    if ((mm = p.match(/^\/api\/admin\/isps\/([\w-]+)\/commands$/))) {
      const isp = await db.findOne('isps', { _id: mm[1] }); if (!isp) return fail(res, 404, 'Not found.');
      if (m === 'GET') return send(res, 200, { ok: true, items: (await db.find('commands', { isp_id: isp._id }, { sort: { created: -1 }, limit: 25 })).map(cmdView), online: !!(isp.last_seen && Date.now() - new Date(isp.last_seen) < 120000), settings: (isp.heartbeat || {}).settings || null });
      const b = JSON.parse((await readBody(req, 2e4)).toString() || '{}'); const c = await queueCommand(isp, 'operator', 'operator', String(b.type || ''), b.params);
      return typeof c === 'string' ? fail(res, 400, c) : send(res, 200, { ok: true, id: c._id });
    }
    if ((mm = p.match(/^\/api\/admin\/isps\/([\w-]+)\/diagnostics$/)) && m === 'GET') { const isp = await db.findOne('isps', { _id: mm[1] }); return isp ? send(res, 200, { ok: true, items: isp.diagnostics || [] }) : fail(res, 404, 'Not found.'); }
    if ((mm = p.match(/^\/api\/admin\/isps\/([\w-]+)\/data\/(\w+)$/))) { const r = await listData(mm[1], mm[2], q); return r ? send(res, 200, { ok: true, ...r }) : fail(res, 404, 'Unknown list.'); }
    if ((mm = p.match(/^\/api\/admin\/isps\/([\w-]+)\/action$/)) && m === 'POST') {
      const isp = await db.findOne('isps', { _id: mm[1] }); if (!isp) return fail(res, 404, 'Not found.');
      const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'); let msg = 'Done.';
      if (isp.phone === ADMIN_PHONE && ['suspend', 'delete', 'password', 'enforce', 'rotate-key'].includes(b.action)) return fail(res, 403, 'This is the protected operator account and cannot be changed this way.');
      if (b.action === 'suspend') await db.set('isps', isp._id, { status: 'suspended' });
      else if (b.action === 'activate') await db.set('isps', isp._id, { status: 'active' });
      else if (b.action === 'extend') { const d = Math.max(-365, Math.min(366, parseInt(b.days) || 0)); const base = Math.max(Date.now(), isp.valid_until ? new Date(isp.valid_until).getTime() : 0); await db.set('isps', isp._id, { valid_until: new Date(d >= 0 ? base + d * DAY : new Date(isp.valid_until).getTime() + d * DAY), plan: isp.plan === 'trial' && d > 0 ? 'monthly' : isp.plan }); }
      else if (b.action === 'profile') {
        const f = {}, email = String(b.email || '').trim().toLowerCase(), phone = S.phone254(b.phone);
        if (b.business !== undefined) { if (!String(b.business).trim()) return fail(res, 400, 'Business name is required.'); f.business = String(b.business).trim().slice(0, 80); }
        if (b.name !== undefined) f.name = String(b.name).trim().slice(0, 80);
        if (b.email !== undefined) { if (!emailOk(email)) return fail(res, 400, 'That email is not valid.'); const o = await db.findOne('isps', { email }); if (o && o._id !== isp._id) return fail(res, 409, 'That email is used by another account.'); f.email = email; }
        if (b.phone !== undefined) { if (!phone) return fail(res, 400, 'That phone number is not valid.'); if (phone === ADMIN_PHONE && isp.phone !== ADMIN_PHONE) return fail(res, 403, 'That number is reserved.'); f.phone = phone; }
        if (b.plan !== undefined) { if (!['trial', 'monthly'].includes(b.plan)) return fail(res, 400, 'Plan is trial or monthly.'); f.plan = b.plan; }
        if (b.valid_until !== undefined) { const d = new Date(b.valid_until); if (isNaN(d)) return fail(res, 400, 'That date is not valid.'); f.valid_until = d; }
        await db.set('isps', isp._id, f); msg = 'Profile saved.';
      }
      else if (b.action === 'enforce') await db.set('isps', isp._id, { enforce: !!b.value });
      else if (b.action === 'price') { const v = Number(b.value); await db.set('isps', isp._id, { price: v > 0 ? v : null }); }
      else if (b.action === 'password') { if (String(b.value || '').length < 8) return fail(res, 400, 'Use at least 8 characters.'); await db.set('isps', isp._id, { pass: A.hashPw(b.value) }); }
      else if (b.action === 'release-machine') { await db.set('isps', isp._id, { machine_id: null, machine_name: '', machine_bound_at: null }); msg = 'Machine released. The next machine that syncs will be bound.'; }
      else if (b.action === 'sites') { const v = Math.max(0, Math.min(500, parseInt(b.value) || 0)); await db.set('isps', isp._id, { sites: v }); msg = v + ' extra site(s) allowed. Price is now KES ' + priceOf({ ...isp, sites: v }) + '.'; }
      else if (b.action === 'rotate-key') { const k = A.rand(24); await db.set('isps', isp._id, { api_key: k }); msg = 'New API key: ' + k; }
      else if (b.action === 'sms') { const r = await S.sendSms(env, isp.phone, String(b.value || '').slice(0, 300)); if (!r.ok) return fail(res, 502, 'SMS failed: ' + (r.error || r.status)); }
      else if (b.action === 'delete') { await db.deleteMany('commands', { isp_id: isp._id }); for (const c of COLS) await db.deleteMany(c, { isp_id: isp._id }); await db.deleteOne('isps', isp._id); }
      else return fail(res, 400, 'Unknown action.');
      return send(res, 200, { ok: true, message: msg });
    }
    return fail(res, 404, 'Not found.');
  }
  return fail(res, 404, 'Not found.');
}

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUBDIR = path.join(__dirname, 'public');
function serveStatic(req, res, u) {
  let rel = decodeURIComponent(u.pathname); if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBDIR, rel));
  if (!file.startsWith(PUBDIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

function serveRelease(req, res, u) {
  const name = decodeURIComponent(u.pathname.slice('/releases/'.length));
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || name === 'manifest.json') { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(RELEASE_DIR, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/releases/')) return serveRelease(req, res, u);
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    return serveStatic(req, res, u);
  } catch (e) { console.error('request error:', e.message); if (!res.headersSent) fail(res, e instanceof SyntaxError ? 400 : 500, e instanceof SyntaxError ? 'Bad request.' : 'Something went wrong on the server.'); }
});

// ---------- background jobs ----------
// Which reminder is due: 3 days and 1 day before, on the day it ends, once a day during the grace period, and when it locks.
function reminderStage(left) {
  if (left > 3 * DAY) return '';
  if (left > DAY) return 'd3';
  if (left > 0) return 'd1';
  const over = -left;
  if (over < GRACE_DAYS * DAY) return over < DAY ? 'g0' : 'g' + Math.floor(over / DAY);
  return 'lock';
}
async function sweep() {
  try {
    const n = await db.deleteMany('vouchers', { delete_at: { $lte: new Date() } }); if (n) console.log(`cleanup: removed ${n} expired connect codes (72h passed)`);
    const now = Date.now(), isps = await db.find('isps', {}, { limit: 5000 });
    for (const i of isps) {
      if (!i.valid_until || i.status !== 'active') continue;
      const until = new Date(i.valid_until).getTime(), left = until - now, st = reminderStage(left), key = new Date(i.valid_until).toISOString() + '|' + st;
      if (!st || i.reminder_stage === key) continue;
      await db.set('isps', i._id, { reminder_stage: key });
      const price = priceOf(i), link = `${PUBLIC_URL}/#/isp/billing`, what = i.plan === 'trial' ? 'free trial' : 'subscription';
      const until10 = new Date(until).toISOString().slice(0, 10), lock10 = new Date(until + GRACE_DAYS * DAY).toISOString().slice(0, 10);
      const text = st === 'd3' ? `Hotspot Cloud: your ${what} ends on ${until10}. Renew (KES ${price}): ${link}`
        : st === 'd1' ? `Hotspot Cloud: your ${what} ends tomorrow. Renew now (KES ${price}) so customers are not cut off: ${link}`
        : st === 'g0' ? `Hotspot Cloud: your ${what} has ended. Your hotspot still works until ${lock10}, then it locks. Pay KES ${price}: ${link}`
        : st === 'lock' ? `Hotspot Cloud: your hotspot is now LOCKED because the ${what} was not renewed. Pay KES ${price} and it unlocks within minutes: ${link}`
        : `Hotspot Cloud: ${st.slice(1) === '1' ? 'last day' : 'grace period running'} before your hotspot locks on ${lock10}. Pay KES ${price}: ${link}`;
      S.sendSms(env, i.phone, text);
    }
  } catch (e) { console.error('sweep:', e.message); }
}

(async () => {
  db = await require('./lib/store')(env);
  server.listen(PORT, () => {
    console.log(`Hotspot Cloud on :${PORT}  public ${PUBLIC_URL}  storage: ${db.kind}`);
    if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) console.warn('WARNING: ADMIN_EMAIL / ADMIN_PASSWORD not set, operator login is disabled');
  });
  sweep(); setInterval(sweep, 10 * 60000).unref();
})().catch(e => { console.error('startup failed:', e.message); process.exit(1); });
