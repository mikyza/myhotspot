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
