'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let ME = null, CFG = {};
const ICON = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M17 4.5a3.5 3.5 0 010 7M21.5 20c0-2.6-1.6-4.6-4-5.5"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>', cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  box: '<path d="M3.5 8L12 3.5 20.5 8v8L12 20.5 3.5 16zM3.5 8L12 12.5 20.5 8M12 12.5v8"/>', msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>', plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>', grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
};
const ico = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

// ---------- helpers ----------
async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dash' }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && ME) { ME = null; location.hash = '#/login'; }
  if (!r.ok && !j.error) j.error = 'Request failed (' + r.status + ')';
  j.ok = r.ok && j.ok !== false; return j;
}
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2800); };
const money = (n, cur = 'KES') => cur + ' ' + Math.round(Number(n) || 0).toLocaleString('en-KE');
const D = v => { const d = new Date(v); return isNaN(d) ? null : d; };
const date = v => { const d = D(v); return d ? d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '–'; };
const stamp = v => { const d = D(v); return d ? d.toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–'; };
const ago = v => { const d = D(v); if (!d) return 'never'; const s = (Date.now() - d) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago'; };
const left = v => { const d = D(v); if (!d) return ''; const days = Math.ceil((d - Date.now()) / 864e5); return days < 0 ? 'ended ' + Math.abs(days) + ' d ago' : days === 0 ? 'ends today' : days + ' d left'; };
const stateChip = s => ({ active: '<span class="chip ok"><i class="dot"></i>Active</span>', trial: '<span class="chip info"><i class="dot"></i>Trial</span>', expired: '<span class="chip bad"><i class="dot"></i>Expired</span>', suspended: '<span class="chip bad"><i class="dot"></i>Suspended</span>' }[s] || '');
const statusChip = s => { s = String(s || ''); const l = s.toLowerCase(); const c = ['paid', 'success', 'active', 'used', 'sent', 'delivered', 'online'].includes(l) ? 'ok' : ['pending', 'unused', 'queued', 'new'].includes(l) ? 'warn' : ['failed', 'expired', 'disabled', 'cancelled', 'error'].includes(l) ? 'bad' : ''; return s ? `<span class="chip ${c}">${esc(s)}</span>` : '–'; };
function bars(series, cur) {
  const W = 620, H = 170, pad = 22, max = Math.max(1, ...series.map(s => s.amount)), bw = (W - 10) / series.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales per day, last ${series.length} days" preserveAspectRatio="none">` + series.map((s, i) => {
    const h = Math.max(3, (H - pad - 8) * s.amount / max), x = 5 + i * bw, last = i === series.length - 1;
    return `<g><rect class="bar${last ? ' now' : ''}" x="${x + 4}" y="${H - pad - h}" width="${bw - 8}" height="${h}" rx="5"><title>${esc(s.day)}: ${money(s.amount, cur)}${s.count !== undefined ? ' (' + s.count + ' sales)' : ''}</title></rect>${i % 2 === (series.length - 1) % 2 ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(s.day.slice(8))}</text>` : ''}</g>`;
  }).join('') + '</svg>';
}
function modal(title, bodyHtml, okText, onOk) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${bodyHtml}<div id="mErr"></div><div class="actions"><button class="btn sec" id="mNo">Cancel</button><button class="btn" id="mOk">${esc(okText)}</button></div></div>`;
  document.body.appendChild(bg); const close = () => bg.remove();
  $('#mNo', bg).onclick = close; bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  bg.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('#mOk', bg).onclick = async () => { const b = $('#mOk', bg); b.disabled = true; const r = await onOk(bg); b.disabled = false; if (r === true) close(); else if (r) $('#mErr', bg).innerHTML = `<div class="err">${esc(r)}</div>`; };
  const f = $('input,select', bg); if (f) f.focus();
}
const copy = async t => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Select the text and copy it'); } };

// ---------- auth screens ----------
function authView(mode) {
  const reg = mode === 'register';
  app.innerHTML = `<div class="auth"><section class="auth-side"><div class="brand"><span class="logo"><i></i><i></i><i></i></span>Hotspot Cloud</div>
    <div><div class="bars" aria-hidden="true"><i style="height:30%"></i><i style="height:52%"></i><i style="height:44%"></i><i style="height:78%"></i><i style="height:100%"></i></div>
    <h1>Every sale on your WiFi, in one place.</h1><p>See payments, connect codes and customers from any phone, the moment they happen.</p></div>
    <div class="auth-points"><div>Sales and customers sync from your hotspot automatically</div><div>Ended connect codes are removed after 72 hours</div><div>Pay your subscription with M-Pesa</div></div></section>
    <section class="auth-main"><div class="auth-box"><h2>${reg ? 'Start your free trial' : 'Welcome back'}</h2><p class="muted">${reg ? `${CFG.trial_days || 14} days free. No card needed.` : 'Sign in to see your hotspot.'}</p>
    <div class="tabs-sw" role="tablist"><button role="tab" aria-selected="${!reg}" id="tLogin">Sign in</button><button role="tab" aria-selected="${reg}" id="tReg">Create account</button></div>
    <div id="msg"></div><div id="form">${reg ? `<label class="f"><span>Business name</span><input id="business" autocomplete="organization" placeholder="Mwangi Fast WiFi"></label>
    <label class="f"><span>Your name</span><input id="name" autocomplete="name"></label>
    <label class="f"><span>M-Pesa phone</span><input id="phone" inputmode="tel" autocomplete="tel" placeholder="0712345678"><small>Used for billing receipts and reminders.</small></label>` : ''}
    <label class="f"><span>Email</span><input id="email" type="email" autocomplete="email"></label>
    <label class="f"><span>Password</span><input id="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}">${reg ? '<small>At least 8 characters.</small>' : ''}</label>
    <button class="btn block" id="go">${reg ? 'Create account' : 'Sign in'}</button></div></div></section></div>`;
  $('#tLogin').onclick = () => { location.hash = '#/login'; }; $('#tReg').onclick = () => { location.hash = '#/register'; };
  const submit = async () => {
    const b = { email: $('#email').value, password: $('#password').value }; if (reg) Object.assign(b, { business: $('#business').value, name: $('#name').value, phone: $('#phone').value });
    const btn = $('#go'); btn.disabled = true; const r = await api(reg ? '/api/register' : '/api/login', 'POST', b); btn.disabled = false;
    if (!r.ok) { $('#msg').innerHTML = `<div class="err">${esc(r.error)}</div>`; return; }
    ME = null; await loadMe(); location.hash = ME && ME.role === 'admin' ? '#/admin' : reg ? '#/isp/connect' : '#/isp'; route();
  };
  $('#go').onclick = submit; $('#form').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

// ---------- shell ----------
function shell(kind, items, active, who, content) {
  const base = kind === 'admin' ? '#/admin' : '#/isp';
  app.innerHTML = `<div class="shell"><aside class="side"><a class="brand" href="${base}"><span class="logo"><i></i><i></i><i></i></span>Hotspot Cloud</a>
    <nav aria-label="Main">${items.map(([k, label, ic]) => `<a href="${base}${k ? '/' + k : ''}" ${k === active ? 'aria-current="page"' : ''}>${ico(ic)}${esc(label)}</a>`).join('')}</nav>
    <div class="who"><b>${esc(who)}</b><button id="out">Sign out</button></div></aside><main id="main" tabindex="-1">${content}</main></div>`;
  $('#out').onclick = async () => { await api('/api/logout', 'POST'); ME = null; location.hash = '#/login'; };
}
const ISP_NAV = [['', 'Overview', 'home'], ['customers', 'Connect codes', 'users'], ['payments', 'Payments', 'cash'], ['accounts', 'Monthly accounts', 'cal'], ['packages', 'Packages', 'box'], ['sms', 'SMS log', 'msg'], ['billing', 'Subscription', 'card'], ['connect', 'Connect hotspot', 'plug'], ['account', 'Account', 'cog']];
const ADM_NAV = [['', 'Overview', 'home'], ['isps', 'ISPs', 'users'], ['subs', 'Subscription payments', 'cash'], ['new', 'Add an ISP', 'plug']];
const loading = '<div class="empty"><span class="spin"></span></div>';

// ---------- data tables ----------
const COLDEFS = {
  vouchers: { title: 'Connect codes', note: 'Customers who bought a package. Codes are deleted 72 hours after they end.', cols: [['Code', r => `<span class="code">${esc(r.code || r.id)}</span>`], ['Package', r => esc(r.package || r.package_name || '–')], ['Phone', r => esc(r.phone || '–')], ['Status', r => statusChip(r.status)], ['Started', r => r.activated_at ? stamp(r.activated_at) : '–'], ['Ends', r => stamp(r.expires_at || r.ended_at || r.end_at)], ['Deleted on', r => r.delete_at ? date(r.delete_at) : '–']], filters: ['', 'active', 'unused', 'expired', 'disabled'] },
  payments: { title: 'Payments', note: 'M-Pesa payments from your customers.', cols: [['Time', r => stamp(r.created_at)], ['Phone', r => esc(r.phone || '–')], ['Package', r => esc(r.package || '–')], ['Amount', r => `<b>${money(r.amount)}</b>`], ['Receipt', r => r.receipt ? `<span class="code">${esc(r.receipt)}</span>` : '–'], ['Status', r => statusChip(r.status)], ['Type', r => esc(r.kind || '–')], ['SMS', r => esc(r.sms_status || '–')]], filters: ['', 'paid', 'pending', 'failed'] },
  accounts: { title: 'Monthly accounts', note: 'Customers on a monthly plan.', cols: [['Account', r => `<span class="code">${esc(r.id)}</span>`], ['Name', r => esc(r.name || '–')], ['Phone', r => esc(r.phone || '–')], ['Status', r => statusChip(r.status)], ['Paid until', r => date(r.paid_until || r.expires_at)], ['Plan', r => esc(r.package || r.plan || '–')]], filters: [] },
  packages: { title: 'Packages', note: 'What your customers can buy.', cols: [['Name', r => `<b>${esc(r.name)}</b>`], ['Price', r => money(r.price)], ['Duration', r => dur(r.duration_minutes)], ['Data', r => r.data_mb ? r.data_mb + ' MB' : 'Unlimited'], ['Type', r => esc(r.kind || 'Hotspot')], ['Status', r => statusChip(r.enabled === false ? 'disabled' : 'active')]], filters: [] },
  sms: { title: 'SMS log', note: 'Delivery status only. Message text is never uploaded.', cols: [['Time', r => stamp(r.time || r.created_at)], ['Phone', r => esc(r.phone || '–')], ['Status', r => statusChip(r.status)], ['Provider reply', r => esc(r.reply || '–')]], filters: [] },
};
const dur = m => { m = Number(m) || 0; return m >= 1440 && m % 1440 === 0 ? m / 1440 + (m === 1440 ? ' day' : ' days') : m >= 60 && m % 60 === 0 ? m / 60 + (m === 60 ? ' hour' : ' hours') : m + ' min'; };
async function dataTable(host, base, c) {
  const def = COLDEFS[c]; let page = 1, q = '', status = '', timer;
  host.innerHTML = `<div class="card"><div class="toolbar"><input type="search" id="q" placeholder="Search" aria-label="Search">${def.filters.length ? `<select id="st" aria-label="Status">${def.filters.map(f => `<option value="${f}">${f ? f[0].toUpperCase() + f.slice(1) : 'All statuses'}</option>`).join('')}</select>` : ''}</div><div id="tb">${loading}</div></div>`;
  const load = async () => {
    const r = await api(`${base}/${c}?page=${page}&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`);
    if (!r.ok) { $('#tb', host).innerHTML = `<div class="err">${esc(r.error)}</div>`; return; }
    if (!r.items.length) { $('#tb', host).innerHTML = `<div class="empty"><b>${q || status ? 'Nothing matches' : 'Nothing here yet'}</b>${q || status ? 'Try a different search.' : esc(def.note) + ' Once your hotspot syncs, it appears here.'}</div>`; return; }
    $('#tb', host).innerHTML = `<div class="tbl-wrap"><table><thead><tr>${def.cols.map(x => `<th>${x[0]}</th>`).join('')}</tr></thead><tbody>${r.items.map(row => `<tr>${def.cols.map(x => `<td>${x[1](row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="pager"><span>${r.total.toLocaleString()} total</span><span class="actions"><button class="btn sec sm" id="pv" ${page <= 1 ? 'disabled' : ''}>Previous</button><span style="align-self:center">Page ${r.page} of ${r.pages}</span><button class="btn sec sm" id="nx" ${page >= r.pages ? 'disabled' : ''}>Next</button></span></div>`;
    $('#pv', host).onclick = () => { page--; load(); }; $('#nx', host).onclick = () => { page++; load(); };
  };
  $('#q', host).oninput = e => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value; page = 1; load(); }, 300); };
  const st = $('#st', host); if (st) st.onchange = e => { status = e.target.value; page = 1; load(); };
  load();
}

// ---------- ISP pages ----------
function licenseBanner(l) {
  if (!l) return '';
  if (!l.active) return `<div class="banner bad"><span><b>Subscription ${l.message.includes('suspended') ? 'suspended' : 'expired'}.</b> New sales are paused on your hotspot. Existing customers stay online.</span><a class="btn sm" href="#/isp/billing">Pay now</a></div>`;
  if (D(l.valid_until) - Date.now() < 3 * 864e5) return `<div class="banner warn"><span><b>Your subscription ends ${left(l.valid_until).replace(' left', '')}.</b> Renew to keep selling.</span><a class="btn sm" href="#/isp/billing">Renew</a></div>`;
  return '';
}
function statusLine(o) {
  const seen = D(o.last_seen), live = seen && Date.now() - seen < 600000;
  return `<span class="chip ${live ? 'ok' : seen ? 'warn' : ''}"><i class="dot ${live ? 'pulse' : ''}"></i>${live ? 'Hotspot online' : seen ? 'Last seen ' + ago(o.last_seen) : 'Waiting for first sync'}</span>`;
}
async function ispOverview(main, o, isAdmin) {
  const cur = o.currency || 'KES', hb = o.heartbeat || {}, rev = o.sum;
  main.innerHTML = `${isAdmin ? '' : licenseBanner(o.license)}
  <div class="card"><div class="hero"><div><div class="muted" style="font-weight:550;margin-bottom:8px">Sales today</div><div class="big"><span class="cur">${esc(cur)}</span>${Math.round(rev.today ?? o.sum.today).toLocaleString('en-KE')}</div><div style="margin-top:12px">${statusLine(o)}</div></div><div>${bars(o.series, cur)}</div></div></div>
  <div class="grid g4" style="margin-top:16px"><div class="card stat"><div class="k">Last 7 days</div><div class="v">${money(rev.week ?? o.sum.week, cur)}</div></div><div class="card stat"><div class="k">Last 30 days</div><div class="v">${money(rev.month ?? o.sum.month, cur)}</div></div><div class="card stat"><div class="k">All time</div><div class="v">${money(rev.all ?? o.sum.all, cur)}</div><div class="s">${o.paidSales.toLocaleString()} paid sales</div></div><div class="card stat"><div class="k">Connect codes</div><div class="v">${o.counts.vouchers.toLocaleString()}</div><div class="s">${o.counts.accounts} monthly accounts</div></div></div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Best selling packages</h3>${o.byPackage.length ? `<div class="bl">${(m => o.byPackage.map(p => `<div><div class="row"><span>${esc(p.name)}</span><b>${money(p.amount, cur)}</b></div><div class="meter"><i style="width:${Math.round(p.amount / m * 100)}%"></i></div></div>`).join(''))(o.byPackage[0].amount || 1)}</div>` : '<div class="empty" style="padding:18px">Sales will rank here.</div>'}</div>
  <div class="card"><h3>Your hotspot</h3><dl class="kv"><dt>Mode</dt><dd>${esc(hb.mode ? ({ gateway: 'Linux gateway', mikrotik: 'MikroTik', none: 'Not set up' }[hb.mode] || hb.mode) : '–')}</dd><dt>Software</dt><dd>${esc(hb.version ? 'v' + hb.version + (hb.os ? ' on ' + hb.os : '') : '–')}</dd><dt>Pending payments</dt><dd>${o.counts.pending}</dd><dt>Packages</dt><dd>${o.counts.packages}</dd><dt>Subscription</dt><dd>${stateChip(o.state)} <span class="muted sm">${esc(left(o.license.valid_until))}</span></dd>${hb.demo_mode ? '<dt>Payments</dt><dd><span class="chip warn">Demo mode is on</span></dd>' : ''}</dl></div></div>`;
}
async function ispPage(page) {
  const main = $('#main');
  if (page === '') { main.insertAdjacentHTML('afterbegin', loading); const o = await api('/api/isp/overview'); if (!o.ok) return main.innerHTML = `<div class="err">${esc(o.error)}</div>`; main.innerHTML = `<div class="top"><div><h1>Overview</h1><p>${esc(ME.isp.business)}</p></div></div><div id="ov"></div>`; return ispOverview($('#ov'), o, false); }
  const map = { customers: 'vouchers', payments: 'payments', accounts: 'accounts', packages: 'packages', sms: 'sms' };
  if (map[page]) { const d = COLDEFS[map[page]]; main.innerHTML = `<div class="top"><div><h1>${d.title}</h1><p>${esc(d.note)}</p></div></div><div id="tbl"></div>`; return dataTable($('#tbl'), '/api/isp/data', map[page]); }
  if (page === 'billing') return billingPage(main);
  if (page === 'connect') return connectPage(main);
  if (page === 'account') return accountPage(main);
  main.innerHTML = '<div class="empty"><b>Page not found</b></div>';
}
async function billingPage(main) {
  main.innerHTML = `<div class="top"><div><h1>Subscription</h1><p>Your software licence for this hotspot.</p></div></div>${loading}`;
  const b = await api('/api/isp/billing'); if (!b.ok) return main.innerHTML = `<div class="err">${esc(b.error)}</div>`;
  const l = b.license, state = !l.active ? 'expired' : b.plan === 'trial' ? 'trial' : 'active';
  main.innerHTML = `<div class="top"><div><h1>Subscription</h1><p>Your software licence for this hotspot.</p></div>${stateChip(state)}</div>${licenseBanner(l)}
  <div class="grid g2"><div class="card"><h3>Pay with M-Pesa</h3><p class="muted">${money(b.price)} adds ${b.days} days${l.active ? ' to your current period' : ''}. You get an M-Pesa prompt on your phone.</p>
  <label class="f"><span>M-Pesa number</span><input id="ph" inputmode="tel" value="${esc((ME.isp.phone || '').replace(/^254/, '0'))}"></label><div id="payMsg"></div><button class="btn" id="pay">Pay ${money(b.price)}</button></div>
  <div class="card"><h3>Current period</h3><dl class="kv"><dt>Plan</dt><dd>${b.plan === 'trial' ? 'Free trial' : 'Monthly'}</dd><dt>Valid until</dt><dd>${date(b.valid_until)} <span class="muted sm">${esc(left(b.valid_until))}</span></dd><dt>Price</dt><dd>${money(b.price)} per ${b.days} days</dd></dl></div></div>
  <div class="card"><h3>Payment history</h3>${b.subs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Receipt</th><th>Status</th></tr></thead><tbody>${b.subs.map(s => `<tr><td>${stamp(s.paid_at || s.created)}</td><td>${money(s.amount)}</td><td>${s.receipt ? `<span class="code">${esc(s.receipt)}</span>` : '–'}</td><td>${statusChip(s.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:20px">No payments yet.</div>'}</div>`;
  $('#pay').onclick = async () => {
    const btn = $('#pay'); btn.disabled = true; $('#payMsg').innerHTML = '';
    const r = await api('/api/isp/pay', 'POST', { phone: $('#ph').value });
    if (!r.ok) { btn.disabled = false; $('#payMsg').innerHTML = `<div class="err">${esc(r.error)}</div>`; return; }
    $('#payMsg').innerHTML = '<div class="ok-note"><span class="spin"></span> Check your phone and enter your M-Pesa PIN…</div>';
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000)); if (!$('#payMsg')) return;
      const s = await api('/api/isp/pay/' + r.ref);
      if (s.status === 'paid') { toast('Payment received'); await loadMe(); return billingPage($('#main')); }
      if (s.status === 'failed') { btn.disabled = false; $('#payMsg').innerHTML = '<div class="err">The payment was cancelled or failed. Try again.</div>'; return; }
    }
    btn.disabled = false; $('#payMsg').innerHTML = '<div class="err">No confirmation yet. If money was taken, it will appear here shortly.</div>';
  };
}
async function connectPage(main) {
  const c = await api('/api/isp/connect'); if (!c.ok) return main.innerHTML = `<div class="err">${esc(c.error)}</div>`;
  main.innerHTML = `<div class="top"><div><h1>Connect your hotspot</h1><p>Paste these three values into the hotspot software to start syncing.</p></div></div>
  <div class="grid g2"><div class="card"><h3>Your connection details</h3>
  <label class="f"><span>Server address</span><div class="secret"><input readonly value="${esc(c.server)}" id="c1"><button class="btn sec" data-c="c1">Copy</button></div></label>
  <label class="f"><span>ISP id</span><div class="secret"><input readonly value="${esc(c.isp_id)}" id="c2"><button class="btn sec" data-c="c2">Copy</button></div></label>
  <label class="f"><span>API key</span><div class="secret"><input readonly type="password" value="${esc(c.api_key)}" id="c3"><button class="btn sec" id="rv">Show</button><button class="btn sec" data-c="c3">Copy</button></div><small>Keep this private. It signs every sync.</small></label>
  <button class="btn danger sm" id="rot">Create a new API key</button></div>
  <div class="card"><h3>On your hotspot server</h3><ol class="steps"><li>Open the hotspot admin page.</li><li>Go to <b>Cloud &amp; license</b>.</li><li>Paste the three values, tick <b>Send this hotspot's data</b>, then press <b>Save &amp; sync now</b>.</li><li>This page shows <b>Hotspot online</b> within a few seconds.</li></ol><p class="muted sm">Shared: packages, connect codes, payments, accounts and SMS delivery status. Never shared: your PayHero and SMS keys, passwords, message text.</p></div></div>`;
  main.querySelectorAll('[data-c]').forEach(b => b.onclick = () => copy($('#' + b.dataset.c).value));
  $('#rv').onclick = e => { const i = $('#c3'); i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
  $('#rot').onclick = () => modal('Create a new API key?', '<p>Your current hotspot will stop syncing until you paste the new key into it.</p>', 'Create new key', async () => { const r = await api('/api/isp/rotate-key', 'POST'); if (!r.ok) return r.error; toast('New key created'); connectPage($('#main')); return true; });
}
function accountPage(main) {
  const i = ME.isp;
  main.innerHTML = `<div class="top"><div><h1>Account</h1><p>${esc(i.email)}</p></div></div><div class="grid g2"><div class="card"><h3>Business details</h3><div id="m1"></div>
  <label class="f"><span>Business name</span><input id="bn" value="${esc(i.business)}"></label><label class="f"><span>M-Pesa phone</span><input id="bp" value="${esc((i.phone || '').replace(/^254/, '0'))}"><small>Receipts and reminders go here.</small></label><button class="btn" id="sv">Save changes</button></div>
  <div class="card"><h3>Change password</h3><div id="m2"></div><label class="f"><span>Current password</span><input id="p0" type="password" autocomplete="current-password"></label><label class="f"><span>New password</span><input id="p1" type="password" autocomplete="new-password"></label><button class="btn" id="sp">Update password</button></div></div>`;
  $('#sv').onclick = async () => { const r = await api('/api/isp/profile', 'POST', { business: $('#bn').value, phone: $('#bp').value }); $('#m1').innerHTML = r.ok ? '<div class="ok-note">Saved.</div>' : `<div class="err">${esc(r.error)}</div>`; if (r.ok) loadMe(); };
  $('#sp').onclick = async () => { const r = await api('/api/isp/password', 'POST', { current: $('#p0').value, next: $('#p1').value }); $('#m2').innerHTML = r.ok ? '<div class="ok-note">Password updated.</div>' : `<div class="err">${esc(r.error)}</div>`; if (r.ok) { $('#p0').value = $('#p1').value = ''; } };
}

// ---------- operator pages ----------
async function adminPage(parts) {
  const main = $('#main'), page = parts[0] || '';
  if (page === '') {
    main.innerHTML = loading; const o = await api('/api/admin/overview'); if (!o.ok) return main.innerHTML = `<div class="err">${esc(o.error)}</div>`;
    main.innerHTML = `<div class="top"><div><h1>Operator overview</h1><p>Storage: ${o.db === 'mongodb' ? 'MongoDB Atlas' : 'local file (set MONGODB_URI for production)'}</p></div></div>
    <div class="card"><div class="hero"><div><div class="muted" style="font-weight:550;margin-bottom:8px">Subscription income, 30 days</div><div class="big"><span class="cur">KES</span>${o.subs.last30.toLocaleString('en-KE')}</div><div class="muted sm" style="margin-top:12px">${money(o.subs.all)} all time from ${o.subs.count} payments</div></div><div>${bars(o.series, 'KES')}</div></div></div>
    <div class="grid g4" style="margin-top:16px"><div class="card stat"><div class="k">ISPs</div><div class="v">${o.isps}</div><div class="s">${o.online} online now</div></div><div class="card stat"><div class="k">Paying</div><div class="v">${o.states.active}</div><div class="s">${o.states.trial} on trial</div></div><div class="card stat"><div class="k">Expired or suspended</div><div class="v">${o.states.expired + o.states.suspended}</div></div><div class="card stat"><div class="k">ISP customer sales today</div><div class="v">${money(o.customers.today)}</div><div class="s">${money(o.customers.month)} this month</div></div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Recent subscription payments</h3>${o.recent.length ? `<div class="tbl-wrap"><table><tbody>${o.recent.map(s => `<tr><td>${esc(s.business)}</td><td>${money(s.amount)}</td><td class="muted">${stamp(s.paid_at)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:18px">No payments yet.</div>'}</div>
    <div class="card"><h3>Renewals due in 5 days</h3>${o.dueSoon.length ? `<div class="tbl-wrap"><table><tbody>${o.dueSoon.map(s => `<tr class="link" data-id="${esc(s.id)}"><td>${esc(s.business)}</td><td class="muted">${esc(left(s.valid_until))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:18px">Nobody is due.</div>'}</div></div>`;
    main.querySelectorAll('tr.link').forEach(tr => tr.onclick = () => { location.hash = '#/admin/isp/' + tr.dataset.id; });
  } else if (page === 'isps') {
    main.innerHTML = `<div class="top"><div><h1>ISPs</h1><p>Everyone using your software.</p></div><a class="btn" href="#/admin/new">Add an ISP</a></div><div class="card"><div class="toolbar"><input id="q" type="search" placeholder="Search name, email or id" aria-label="Search"></div><div id="tb">${loading}</div></div>`;
    const load = async () => {
      const r = await api('/api/admin/isps?q=' + encodeURIComponent($('#q').value)); if (!r.ok) return $('#tb').innerHTML = `<div class="err">${esc(r.error)}</div>`;
      if (!r.items.length) return $('#tb').innerHTML = '<div class="empty"><b>No ISPs yet</b>People who sign up at your website appear here.</div>';
      $('#tb').innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Business</th><th>Status</th><th>Valid until</th><th>Hotspot</th><th>Sales today</th><th>All-time sales</th></tr></thead><tbody>${r.items.map(i => `<tr class="link" data-id="${esc(i.id)}"><td><b>${esc(i.business)}</b><div class="muted sm">${esc(i.email)} · ${esc(i.id)}</div></td><td>${stateChip(i.state)}</td><td>${date(i.valid_until)}<div class="muted sm">${esc(left(i.valid_until))}</div></td><td>${i.online ? '<span class="chip ok"><i class="dot pulse"></i>Online</span>' : `<span class="muted">${esc(ago(i.last_seen))}</span>`}</td><td>${i.revenue ? money(i.revenue.today) : '–'}</td><td>${i.revenue ? money(i.revenue.all) : '–'}</td></tr>`).join('')}</tbody></table></div>`;
      $('#tb').querySelectorAll('tr.link').forEach(tr => tr.onclick = () => { location.hash = '#/admin/isp/' + tr.dataset.id; });
    };
    let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); }; load();
  } else if (page === 'subs') {
    main.innerHTML = `<div class="top"><div><h1>Subscription payments</h1><p>Money ISPs paid you for the software.</p></div></div><div class="card" id="tb">${loading}</div>`;
    const r = await api('/api/admin/subs'); $('#tb').innerHTML = r.items && r.items.length ? `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>ISP</th><th>Phone</th><th>Amount</th><th>Receipt</th><th>Status</th></tr></thead><tbody>${r.items.map(s => `<tr><td>${stamp(s.paid_at || s.created)}</td><td>${esc(s.business)}</td><td>${esc(s.phone)}</td><td>${money(s.amount)}</td><td>${s.receipt ? `<span class="code">${esc(s.receipt)}</span>` : '–'}</td><td>${statusChip(s.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>No payments yet</b></div>';
  } else if (page === 'new') {
    main.innerHTML = `<div class="top"><div><h1>Add an ISP</h1><p>Create an account for a customer who bought the software from you.</p></div></div><div class="card" style="max-width:520px"><div id="m"></div>
    <label class="f"><span>Business name</span><input id="b"></label><label class="f"><span>Contact name</span><input id="n"></label><label class="f"><span>Email</span><input id="e" type="email"></label><label class="f"><span>Phone</span><input id="p" placeholder="0712345678"></label><label class="f"><span>Temporary password</span><input id="w" type="text"></label><label class="f"><span>Trial days</span><input id="d" type="number" value="${CFG.trial_days || 14}"></label><button class="btn" id="go">Create ISP</button></div>`;
    $('#go').onclick = async () => { const r = await api('/api/admin/isps', 'POST', { business: $('#b').value, name: $('#n').value, email: $('#e').value, phone: $('#p').value, password: $('#w').value, days: $('#d').value }); if (!r.ok) return $('#m').innerHTML = `<div class="err">${esc(r.error)}</div>`; toast('ISP created'); location.hash = '#/admin/isp/' + r.id; };
  } else if (page === 'isp') await adminIsp(main, parts[1], parts[2] || 'overview');
  else main.innerHTML = '<div class="empty"><b>Page not found</b></div>';
}
async function adminIsp(main, id, tab) {
  main.innerHTML = loading; const r = await api('/api/admin/isps/' + encodeURIComponent(id)); if (!r.ok) return main.innerHTML = `<div class="err">${esc(r.error)}</div>`;
  const i = r.isp, TABS = [['overview', 'Overview'], ['vouchers', 'Connect codes'], ['payments', 'Payments'], ['accounts', 'Accounts'], ['packages', 'Packages'], ['sms', 'SMS'], ['billing', 'Billing & controls']];
  main.innerHTML = `<div class="top"><div><a class="muted sm" href="#/admin/isps">All ISPs</a><h1>${esc(i.business)}</h1><p>${esc(i.email)} · ${esc(i.phone)} · <span class="code">${esc(i.id)}</span></p></div><div>${stateChip(r.state)} ${statusLine(i)}</div></div>
  <div class="subtabs" role="tablist">${TABS.map(([k, l]) => `<a href="#/admin/isp/${esc(id)}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</div><div id="tabBody"></div>`;
  const body = $('#tabBody');
  if (tab === 'overview') return ispOverview(body, r.overview, true);
  if (COLDEFS[tab]) { body.innerHTML = '<div id="tbl"></div>'; return dataTable($('#tbl'), `/api/admin/isps/${encodeURIComponent(id)}/data`, tab); }
  const act = async (a, extra = {}) => { const x = await api(`/api/admin/isps/${encodeURIComponent(id)}/action`, 'POST', { action: a, ...extra }); if (!x.ok) return x.error; toast(x.message || 'Done'); if (a === 'delete') location.hash = '#/admin/isps'; else adminIsp($('#main'), id, 'billing'); return true; };
  body.innerHTML = `<div class="grid g2"><div class="card"><h3>Licence</h3><dl class="kv"><dt>Plan</dt><dd>${esc(i.plan)}</dd><dt>Valid until</dt><dd>${date(i.valid_until)} <span class="muted sm">${esc(left(i.valid_until))}</span></dd><dt>Price</dt><dd>${money(i.price || CFG.price)} ${i.price ? '(custom)' : ''}</dd><dt>Sales lock</dt><dd>${i.enforce === false ? 'Off: never paused' : 'On: sales pause when unpaid'}</dd><dt>Software</dt><dd>${esc(i.version || '–')}</dd><dt>Joined</dt><dd>${date(i.created)}</dd></dl>
  <div class="actions" style="margin-top:16px"><button class="btn sec sm" data-a="ext">Add days</button>${i.status === 'suspended' ? '<button class="btn sm" data-a="act">Reactivate</button>' : '<button class="btn danger sm" data-a="sus">Suspend</button>'}<button class="btn sec sm" data-a="enf">${i.enforce === false ? 'Turn sales lock on' : 'Turn sales lock off'}</button><button class="btn sec sm" data-a="price">Set price</button></div></div>
  <div class="card"><h3>Account controls</h3><div class="actions"><button class="btn sec sm" data-a="sms">Send SMS</button><button class="btn sec sm" data-a="pw">Reset password</button><button class="btn sec sm" data-a="key">Rotate API key</button><button class="btn danger sm" data-a="del">Delete ISP and data</button></div></div></div>
  <div class="card"><h3>Subscription payments</h3>${r.subs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Receipt</th><th>Status</th></tr></thead><tbody>${r.subs.map(s => `<tr><td>${stamp(s.paid_at || s.created)}</td><td>${money(s.amount)}</td><td>${s.receipt ? `<span class="code">${esc(s.receipt)}</span>` : '–'}</td><td>${statusChip(s.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:18px">No payments yet.</div>'}</div>`;
  const H = {
    ext: () => modal('Add days', '<label class="f"><span>Days (use a negative number to remove)</span><input id="v" type="number" value="30"></label>', 'Apply', () => act('extend', { days: $('#v').value })),
    sus: () => modal('Suspend this ISP?', '<p>Their hotspot stops selling on its next sync. Existing customers stay online.</p>', 'Suspend', () => act('suspend')),
    act: () => act('activate'), enf: () => act('enforce', { value: i.enforce === false }),
    price: () => modal('Set price', `<label class="f"><span>KES per ${CFG.days || 30} days (empty for default)</span><input id="v" type="number" value="${esc(i.price || '')}"></label>`, 'Save', () => act('price', { value: $('#v').value })),
    sms: () => modal('Send SMS', '<label class="f"><span>Message</span><input id="v" maxlength="300"></label>', 'Send', () => act('sms', { value: $('#v').value })),
    pw: () => modal('Reset password', '<label class="f"><span>New password</span><input id="v" type="text"></label>', 'Reset', () => act('password', { value: $('#v').value })),
    key: () => modal('Rotate API key?', '<p>Their hotspot stops syncing until the new key is pasted into it.</p>', 'Rotate', () => act('rotate-key')),
    del: () => modal('Delete this ISP?', `<p>This removes ${esc(i.business)} and every synced record. It cannot be undone.</p>`, 'Delete everything', () => act('delete')),
  };
  body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => H[b.dataset.a]());
}

// ---------- router ----------
async function loadMe() { const r = await api('/api/me'); ME = r.ok && r.role ? r : null; }
async function route() {
  const h = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!ME) await loadMe();
  const root = h[0] || '';
  if (!ME) { if (!CFG.price) api('/api/config').then(c => { CFG = c; }); return authView(root === 'register' ? 'register' : 'login'); }
  if (root === 'login' || root === 'register' || root === '') { location.hash = ME.role === 'admin' ? '#/admin' : '#/isp'; return; }
  if (ME.role === 'admin') {
    if (root !== 'admin') { location.hash = '#/admin'; return; }
    const parts = h.slice(1), key = parts[0] === 'isp' ? 'isps' : (parts[0] || ''); shell('admin', ADM_NAV, key, 'Operator', ''); return adminPage(parts);
  }
  if (root !== 'isp') { location.hash = '#/isp'; return; }
  const page = h[1] || ''; shell('isp', ISP_NAV, page, ME.isp.business, ''); return ispPage(page);
}
addEventListener('hashchange', route);
api('/api/config').then(c => { CFG = c; route(); });
