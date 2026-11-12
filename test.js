'use strict';
// Quick self-check against a running server:  BASE=http://localhost:3000 ISP_ID=... API_KEY=... node test.js
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:3000', ID = process.env.ISP_ID, KEY = process.env.API_KEY;
const sync = async (ops, key = KEY, ts = Math.floor(Date.now() / 1000)) => {
  const body = JSON.stringify({ isp_id: ID, batch: 1, ops }), sig = crypto.createHmac('sha256', key).update(ts + '.' + body).digest('hex');
  const r = await fetch(BASE + '/api/v1/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ISP-Id': ID, 'X-Timestamp': String(ts), 'X-Signature': sig }, body });
  return { status: r.status, json: await r.json() };
};
let bad = 0; const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) bad++; };
(async () => {
  const soon = new Date(Date.now() + 3600e3).toISOString(), past = new Date(Date.now() - 3600e3).toISOString();
  check('rejects wrong key', (await sync([], 'wrong')).status === 401);
  check('rejects old timestamp', (await sync([], KEY, 1000)).status === 401);
  const r = await sync([{ op: 'upsert', c: 'vouchers', id: 'T-LIVE', data: { code: 'T-LIVE', status: 'expired', delete_at: soon } }, { op: 'upsert', c: 'vouchers', id: 'T-OLD', data: { code: 'T-OLD', status: 'expired', delete_at: past } }, { op: 'upsert', c: 'bogus', id: 'x', data: {} }]);
  check('accepts signed sync', r.status === 200 && r.json.ok);
  check('only the 2 valid ops applied (expired one skipped counts as 1)', r.json.applied === 1);
  check('returns licence', r.json.license && r.json.license.active === true);
  const r2 = await sync([{ op: 'upsert', c: 'vouchers', id: 'T-LIVE', data: { code: 'T-LIVE', status: 'expired', delete_at: soon } }]);
  check('upsert is idempotent', r2.json.applied === 1);
  const r3 = await sync([{ op: 'delete', c: 'vouchers', id: 'T-LIVE' }]);
  check('delete op works', r3.json.applied === 1);
  process.exit(bad ? 1 : 0);
})();
