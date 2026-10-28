'use strict';
const crypto = require('crypto');
const hashPw = (pw) => { const salt = crypto.randomBytes(16); return 's1$' + salt.toString('hex') + '$' + crypto.scryptSync(pw, salt, 32).toString('hex'); };
const checkPw = (pw, stored) => {
  try { const [v, salt, h] = String(stored).split('$'); if (v !== 's1') return false;
    const a = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32), b = Buffer.from(h, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch { return false; }
};
const b64 = b => Buffer.from(b).toString('base64url');
const sign = (secret, payload, ttlSec) => { const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })); return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url'); };
const verify = (secret, tok) => {
  if (!tok || !tok.includes('.')) return null; const [body, mac] = tok.split('.');
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() / 1000 ? p : null; } catch { return null; }
};
const cookies = h => Object.fromEntries(String(h || '').split(/;\s*/).filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; }));
const rand = n => crypto.randomBytes(n).toString('hex');
const hmacHex = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
module.exports = { hashPw, checkPw, sign, verify, cookies, rand, hmacHex, safeEq };
