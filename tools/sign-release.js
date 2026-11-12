'use strict';
// Signs a new Linux build and puts it where the website serves it from.
//   node tools/sign-release.js --bin ./hotspot-billing --version 2.1.0 [--arch linux-amd64] [--notes "What changed"] [--key update-private.pem]
// Then copy the website's data/releases/ folder to the server. ISPs see "Update available" in their admin
// page within a few minutes and install it with one click. The server never holds the private key.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const bin = arg('bin'), version = arg('version'), arch = arg('arch') || 'linux-amd64', notes = arg('notes') || '', keyFile = arg('key') || 'update-private.pem';
if (!bin || !version) { console.error('Usage: node tools/sign-release.js --bin ./hotspot-billing --version 2.1.0 [--arch linux-amd64] [--notes "..."] [--key update-private.pem]'); process.exit(1); }
if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error('Version must look like 2.1.0'); process.exit(1); }
if (!/^[a-z0-9]+-[a-z0-9]+$/.test(arch)) { console.error('--arch must look like linux-amd64 or linux-arm64'); process.exit(1); }
const data = fs.readFileSync(bin), sha = crypto.createHash('sha256').update(data).digest('hex'), size = data.length;
const sig = crypto.sign(null, Buffer.from(`hotspot-update|${version}|${arch}|${sha}|${size}`), crypto.createPrivateKey(fs.readFileSync(keyFile))).toString('base64');
const dir = path.join(__dirname, '..', 'data', 'releases'); fs.mkdirSync(dir, { recursive: true });
const file = `hotspot-billing-${version}-${arch}`; fs.writeFileSync(path.join(dir, file), data, { mode: 0o755 });
const mf = path.join(dir, 'manifest.json'); let m = { version, notes, files: {} };
try { const old = JSON.parse(fs.readFileSync(mf, 'utf8')); if (old.version === version) m = old; } catch { /* first release */ }
m.version = version; if (notes) m.notes = notes;
// Staged rollout: --pilot isp-abc,isp-def  --percent 25  --not-before 2026-11-20   (leave all three out = everyone)
const pilot = arg('pilot'), percent = arg('percent'), notBefore = arg('not-before');
if (pilot || percent || notBefore) m.rollout = { pilot: pilot ? pilot.split(',').map(x => x.trim()).filter(Boolean) : [], percent: Math.max(0, Math.min(100, Number(percent) || 0)), not_before: notBefore || null };
else if (process.argv.includes('--everyone')) delete m.rollout; m.files = m.files || {}; m.files[arch] = { file, sha256: sha, size, sig };
fs.writeFileSync(mf, JSON.stringify(m, null, 2));
console.log(`Signed ${file}\n  sha256 ${sha}\n  size   ${size}\nNow copy data/releases/ to your server.`);
