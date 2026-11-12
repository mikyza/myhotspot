# Hotspot Cloud: website for selling and monitoring your hotspot software

One Node.js app (no framework, one dependency: `mongodb`) that gives you:

- **ISP dashboard** for every customer: sales today and 30 days, payments, connect codes, monthly accounts, packages, SMS delivery log, subscription and billing, connection details.
- **Operator console** for you: all ISPs, who is online, who is due, suspend/extend/price/SMS/reset, subscription income.
- **Sync receiver** at `POST /api/v1/sync` that the Linux hotspot app already talks to (HMAC-signed, replay-protected).
- **Subscription billing**: ISPs pay *you* by M-Pesa (your PayHero account); confirmation by PayHero callback and by polling; SMS receipts and renewal reminders through Ping Africa.
- **72-hour cleanup**: ended connect codes carry `delete_at`; MongoDB removes them with a TTL index, and the server sweeps every 10 minutes as a backup.

## Run it
1. `cp .env.example .env` and fill in every value (see comments). **Rotate your MongoDB password first** and use the new one.
2. `npm install && npm start` (tests without MongoDB: leave `MONGODB_URI` empty and it keeps a local JSON file).
3. Tunnel: `ngrok config add-authtoken <token>` then `ngrok http --url=linwood-feudalistic-lorenzo.ngrok-free.dev 3000`.
   Or install everything as services: `sudo bash deploy/install-server.sh`.
4. Open the ngrok address. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` for the operator console. ISPs use **Create account**.
5. In MongoDB Atlas allow your server's IP under Network Access.

## How an ISP connects
Dashboard > **Connect hotspot** shows the server address, ISP id and API key. They paste them into the hotspot app under **Cloud & license**.

## Selling it
- Each ISP enters **their own** PayHero and Ping Africa keys in their hotspot app, so their customers pay *them*. Do not ship your keys (the sellable package in this delivery has them blanked).
- You get paid through **subscriptions** (`PLAN_PRICE_KES` per `PLAN_DAYS`, per-ISP custom price available). Unpaid and enforced: the hotspot pauses *new* sales; existing customers keep working.
- A per-sale commission is not possible with this design, because customer payments go to the ISP's own PayHero. Use subscriptions, or tell me if you want a split-payment design.

## Notes
- `npm test` needs `ISP_ID` and `API_KEY` of a registered ISP and a running server: `BASE=http://localhost:3000 ISP_ID=... API_KEY=... node test.js`.
- Free ngrok shows a one-time warning page to browsers and has limits. For real customers use a paid ngrok plan or a VPS with a domain (change `PUBLIC_URL`).
- Synced data includes end-customer phone numbers. Mention that in your terms.

## Version 2.1 (what changed)
Replace `server.js` and `public/app.js`, add the `tools/` folder, then restart. Add `GRACE_DAYS` and `SITE_PRICE_KES` to your `.env` (see `.env.example`).
- **One licence, one machine.** The first machine to sync is bound. Others are refused until the ISP presses "Move to another machine" (once per 7 days) or you press "Release machine" on the ISP page. Operator ISP page also has "Set extra sites" (price = base + sites x `SITE_PRICE_KES`).
- **Grace period.** After a subscription ends the ISP keeps working `GRACE_DAYS` days (state "Grace period"), then locks. SMS reminders: 3 days and 1 day before, on the day it ends, daily in grace, and when it locks.
- **Signed updates.** On YOUR computer (never the server): `node tools/gen-update-key.js` once; put `update-key.pub` in the Linux package folder before you zip it. For each new version: `node tools/sign-release.js --bin ./hotspot-billing --version 2.2.0 --notes "What changed"`, then copy `data/releases/` to the server. ISPs see "Update available" within minutes. Back up `update-private.pem` somewhere safe and offline: whoever has it can push software to every ISP, and if you lose it you cannot ship updates to copies already installed.
- Test: `node test-v2.js` (starts its own copy of the server on port 3111 with a temporary data folder; it needs `data/releases/` to hold one signed release, so run `sign-release.js` first).


## Staged updates (do this every release)
1. Build the new Linux binary, then sign it on your laptop to ONE test ISP first:
   `node tools/sign-release.js --bin ./hotspot-billing --version 2.3.0 --notes "..." --pilot isp-abc123`
2. Copy `data/releases/` to the server. Only `isp-abc123` is offered the update. Watch it for a day.
3. Then widen it: re-run the same command with `--percent 25 --not-before 2026-11-20`, later `--everyone`.
   (A new version signed without any of these flags goes to everyone, so always start with --pilot.)

## Backups and support info
ISP backups arrive encrypted at `data/backups/<isp id>/` (newest 7 kept). You cannot read them (they use the ISP's
key); they exist so an ISP can restore after losing its machine. Back up the `data/` folder of this website too.
Support reports an ISP sends are shown in the ISP's page: Account controls > Support info.
