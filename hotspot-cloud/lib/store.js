'use strict';
// Storage layer: MongoDB Atlas when MONGODB_URI is set, otherwise a JSON file (for local testing).
const fs = require('fs'), path = require('path');
const DATE_FIELDS = new Set(['delete_at', 'synced_at', 'valid_until', 'paid_at', 'created', 'last_seen', 'reminded_at']);
const T = v => (v instanceof Date ? v.getTime() : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : v);

function matchOne(v, c) {
  if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) {
    for (const [k, x] of Object.entries(c)) {
      const a = T(v), b = T(x);
      if (k === '$gte' && !(a >= b)) return false;
      if (k === '$gt' && !(a > b)) return false;
      if (k === '$lte' && !(a <= b)) return false;
      if (k === '$lt' && !(a < b)) return false;
      if (k === '$ne' && a === b) return false;
      if (k === '$in' && !x.includes(v)) return false;
      if (k === '$regex' && !new RegExp(x, 'i').test(String(v ?? ''))) return false;
    }
    return true;
  }
  return T(v) === T(c);
}
function match(doc, f) {
  for (const [k, c] of Object.entries(f || {})) {
    if (k === '$or') { if (!c.some(g => match(doc, g))) return false; continue; }
    if (!matchOne(doc[k], c)) return false;
  }
  return true;
}

class MemoryStore {
  constructor(file) { this.file = file; this.cols = {}; this.timer = null; this.kind = 'file'; }
  async init() {
    if (this.file && fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [c, docs] of Object.entries(raw)) {
          this.cols[c] = new Map(docs.map(d => { for (const f of DATE_FIELDS) if (typeof d[f] === 'string') d[f] = new Date(d[f]); return [d._id, d]; }));
        }
      } catch (e) { console.error('store: could not read', this.file, e.message); }
    }
  }
  col(c) { return this.cols[c] || (this.cols[c] = new Map()); }
  save() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const out = {}; for (const [c, m] of Object.entries(this.cols)) out[c] = [...m.values()];
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(out)); fs.renameSync(this.file + '.tmp', this.file);
    }, 300);
  }
  async find(c, f = {}, o = {}) {
    let r = [...this.col(c).values()].filter(d => match(d, f));
    if (o.sort) { const [[k, dir]] = Object.entries(o.sort); r.sort((a, b) => { const x = T(a[k]), y = T(b[k]); return (x > y ? 1 : x < y ? -1 : 0) * dir; }); }
    if (o.skip) r = r.slice(o.skip);
    if (o.limit) r = r.slice(0, o.limit);
    return r.map(d => ({ ...d }));
  }
  async findOne(c, f) { return (await this.find(c, f, { limit: 1 }))[0] || null; }
  async count(c, f = {}) { return [...this.col(c).values()].filter(d => match(d, f)).length; }
  async upsert(c, _id, doc) { this.col(c).set(_id, { ...doc, _id }); this.save(); }
  async set(c, _id, fields) { const d = this.col(c).get(_id); if (d) { Object.assign(d, fields); this.save(); } return !!d; }
  async deleteOne(c, _id) { this.col(c).delete(_id); this.save(); }
  async deleteMany(c, f) { let n = 0; for (const [k, d] of this.col(c)) if (match(d, f)) { this.col(c).delete(k); n++; } if (n) this.save(); return n; }
}

class MongoStore {
  constructor(uri, dbName) { this.uri = uri; this.dbName = dbName; this.kind = 'mongodb'; }
  async init() {
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 15000 });
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    // Connect codes are deleted by MongoDB itself once delete_at (ended + 72h) has passed.
    await this.db.collection('vouchers').createIndex({ delete_at: 1 }, { expireAfterSeconds: 0 });
    for (const c of ['vouchers', 'payments', 'accounts', 'sms', 'packages']) await this.db.collection(c).createIndex({ isp_id: 1 });
    await this.db.collection('payments').createIndex({ isp_id: 1, created_at: -1 });
    await this.db.collection('isps').createIndex({ email: 1 }, { unique: true });
    await this.db.collection('subs').createIndex({ isp_id: 1, created: -1 });
  }
  async find(c, f = {}, o = {}) {
    f = revive(f);
    let q = this.db.collection(c).find(f); if (o.sort) q = q.sort(o.sort); if (o.skip) q = q.skip(o.skip); if (o.limit) q = q.limit(o.limit);
    return q.toArray();
  }
  async findOne(c, f) { return this.db.collection(c).findOne(revive(f)); }
  async count(c, f = {}) { return this.db.collection(c).countDocuments(revive(f)); }
  async upsert(c, _id, doc) { const { _id: _x, ...rest } = doc; await this.db.collection(c).replaceOne({ _id }, rest, { upsert: true }); }
  async set(c, _id, fields) { const r = await this.db.collection(c).updateOne({ _id }, { $set: fields }); return r.matchedCount > 0; }
  async deleteOne(c, _id) { await this.db.collection(c).deleteOne({ _id }); }
  async deleteMany(c, f) { return (await this.db.collection(c).deleteMany(revive(f))).deletedCount; }
}
// Filters we build in code already use Date objects; this passes them through untouched.
function revive(f) { return f; }

module.exports = async function open(env) {
  const s = env.MONGODB_URI ? new MongoStore(env.MONGODB_URI, env.MONGODB_DB || 'hotspot_cloud') : new MemoryStore(path.join(__dirname, '..', 'data', 'store.json'));
  await s.init();
  return s;
};
