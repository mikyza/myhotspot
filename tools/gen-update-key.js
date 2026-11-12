'use strict';
// Makes the key pair that protects software updates. Run ONCE, on your own computer (not the server).
//   node tools/gen-update-key.js
// It writes:
//   update-private.pem   KEEP THIS SECRET and back it up. Whoever has it can push software to every ISP.
//                        Never put it on the server, in the zip, or in a chat.
//   update-key.pub       the public half. Put this file in the Linux package folder next to config.json
//                        (install.sh copies it). The app only installs updates signed by the matching private key.
const crypto = require('crypto'), fs = require('fs');
if (fs.existsSync('update-private.pem')) { console.error('update-private.pem already exists here. Not overwriting it.'); process.exit(1); }
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync('update-private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
fs.writeFileSync('update-key.pub', raw.toString('base64') + '\n');
console.log('Created update-private.pem (secret) and update-key.pub (public).');
console.log('Public key:', raw.toString('base64'));
