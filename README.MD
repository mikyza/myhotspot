# Hotspot Cloud

**A cloud dashboard and subscription platform for WiFi hotspot operators.**
Hotspot software at each ISP syncs sales, connect codes and customers to this website. ISPs watch their business from any phone, and you (the operator) manage every ISP and collect software subscriptions by M-Pesa.

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![MongoDB](https://img.shields.io/badge/database-MongoDB%20Atlas-47A248) ![Dependencies](https://img.shields.io/badge/dependencies-1-blue) ![Status](https://img.shields.io/badge/status-production-success)

---

## Features

**For ISPs (your customers)**
- Live overview: sales today, 7 days, 30 days, all time, best-selling packages, hotspot online status
- Connect codes, payments, monthly accounts, packages and SMS delivery log, with search, filters and CSV export
- Pay the software subscription with M-Pesa (STK push) and see payment history
- One-screen "Connect hotspot" page with server address, ISP id and API key
- Light, dark and auto themes; works well on phones

**For the operator (you)**
- Overview of income, online ISPs, trials, expired and suspended accounts
- Open any ISP: view their data, add or remove days, suspend or reactivate, set a custom price, send SMS, reset password, rotate API key, delete
- Add an ISP manually and see every subscription payment
- Protected operator account that cannot be suspended, deleted or impersonated

**Platform**
- Signed sync endpoint (HMAC-SHA256 with replay protection)
- M-Pesa payments through PayHero and SMS through Ping Africa
- Automatic cleanup: ended connect codes are removed 72 hours after they end
- Renewal reminders by SMS before a subscription ends
- Works without a database for testing (falls back to a local JSON file)

---

## How it works

```
 ISP hotspot software  ──(signed sync)──►  Hotspot Cloud  ◄──  ISP opens dashboard
                                              │   ▲
                                 MongoDB Atlas│   │ PayHero callback
                                              ▼   │
                                      Operator console   (M-Pesa subscription payments)
```

Each ISP's customers pay the ISP through the ISP's own PayHero account. ISPs pay **you** a subscription through your PayHero account.

---

## Project structure

```
.
├── server.js              HTTP server, API routes, scheduled jobs
├── lib/
│   ├── auth.js            Password hashing, signed cookies, HMAC helpers
│   ├── services.js        PayHero (M-Pesa) and Ping Africa (SMS) clients
│   └── store.js           MongoDB storage with a JSON-file fallback
├── public/
│   ├── index.html         App shell
│   ├── app.js             Single-page dashboard (ISP + operator)
│   └── app.css            Styles
├── deploy/
│   └── install-server.sh  Installs as a systemd service on Ubuntu/Debian
├── test.js                Sync endpoint self-check
├── .env.example           Configuration template
└── package.json
```

Only one dependency: `mongodb`.

---

## Quick start (local)

Requirements: Node.js 18 or newer.

```bash
git clone https://github.com/mikyza/hotspot-cloud.git
cd hotspot-cloud
npm install
cp .env.example .env      # Windows: copy .env.example .env
# edit .env (see Configuration)
npm start
```

Open <http://localhost:3000>.

To try it **without MongoDB**, delete or leave empty the `MONGODB_URI` line. Data is then kept in `data/store.json`.

---

## Configuration

All settings are environment variables. Locally they are read from `.env`; on a host such as Render, set them in the dashboard. **Never commit `.env`.**

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | Port to listen on (default `3000`; hosts usually set it) |
| `PUBLIC_URL` | yes | Public address of the site, no trailing slash. Used in links and the PayHero callback |
| `SESSION_SECRET` | yes | Long random string that signs login cookies |
| `ADMIN_EMAIL` | yes | Operator login email |
| `ADMIN_PASSWORD` | yes | Operator password (use a strong one) |
| `ADMIN_PHONE` | no | Protected operator phone, also works as a login name. Default `0746323229` |
| `MONGODB_URI` | production | MongoDB Atlas connection string |
| `MONGODB_DB` | no | Database name (default `hotspot_cloud`) |
| `PLAN_PRICE_KES` | no | Subscription price (default `1500`) |
| `PLAN_DAYS` | no | Days per subscription payment (default `30`) |
| `TRIAL_DAYS` | no | Free trial length (default `14`) |
| `PAYHERO_BASE_URL` | no | PayHero API base URL |
| `PAYHERO_BASIC_AUTH` | for payments | PayHero basic auth header value |
| `PAYHERO_CHANNEL_ID` | for payments | PayHero channel id |
| `PAYHERO_CALLBACK_SECRET` | for payments | Secret added to the callback URL to verify PayHero |
| `PING_AFRICA_API_URL` | no | SMS API URL |
| `PING_AFRICA_API_TOKEN` | for SMS | SMS API token |
| `PING_AFRICA_SENDER_ID` | no | SMS sender name |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### MongoDB Atlas checklist
1. Create a database user with a simple password (letters and numbers avoid encoding problems).
2. Network Access: allow your host's IP, or `0.0.0.0/0` for Render.
3. Use the connection string as `MONGODB_URI`. URL-encode special characters in the password (`!` becomes `%21`, `@` becomes `%40`).

---

## Deploy

### Render (easiest)
1. Push this repo to GitHub (private).
2. Render → **New** → **Web Service** → pick the repo.
3. Settings:
   - Root Directory: *(leave empty)*
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add every variable from the table above under **Environment**.
5. Set `PUBLIC_URL` to your Render address, for example `https://your-app.onrender.com`.
6. Deploy. Free services sleep when idle, so use a paid plan for real customers (payment callbacks need the site awake).

### Ubuntu / Debian server
```bash
sudo bash deploy/install-server.sh
```
This installs the app as a `systemd` service. Edit `/opt/hotspot-cloud/.env`, then `systemctl restart hotspot-cloud`. Logs: `journalctl -u hotspot-cloud -f`.

---

## Using it

### Operator
Open `/#/admin` and sign in with `ADMIN_EMAIL` **or** the protected phone number, plus `ADMIN_PASSWORD`.

### ISP
ISPs click **Create account** (a free trial starts), or you add them from **Add an ISP**.

### Connect a hotspot
In the ISP dashboard open **Connect hotspot** and copy the three values (server address, ISP id, API key) into the hotspot software under **Cloud & license**, then press **Save & sync now**. The dashboard shows **Hotspot online** within seconds.

---

## Subscriptions and licensing

- New accounts get a free trial.
- When a subscription ends and the sales lock is on, the hotspot **pauses new sales**. Customers already online keep working.
- ISPs pay through **Subscription → Pay with M-Pesa**. Confirmation comes by PayHero callback, with polling as a backup, and the ISP gets an SMS receipt.
- You can set a custom price per ISP, add or remove days, or switch the sales lock off for any ISP.

---

## Sync API

`POST /api/v1/sync` is called by the hotspot software.

| Header | Value |
|---|---|
| `X-ISP-Id` | The ISP id |
| `X-Timestamp` | Unix time in seconds (old timestamps are rejected) |
| `X-Signature` | `HMAC-SHA256(api_key, timestamp + "." + body)` as hex |

Body:

```json
{ "isp_id": "isp-abc123", "batch": 1, "ops": [
  { "op": "upsert", "c": "payments", "id": "P1", "data": { "amount": 50 } },
  { "op": "delete", "c": "vouchers", "id": "V1" }
] }
```

Collections: `packages`, `vouchers`, `payments`, `accounts`, `sms`. The response includes the ISP's licence state.

---

## Data and privacy

- Synced data includes end-customer phone numbers. Mention this in your terms of service.
- SMS message text, PayHero keys and passwords are never uploaded by the hotspot software.
- Ended connect codes are deleted automatically 72 hours after they end (MongoDB TTL index plus a sweep every 10 minutes).

---

## Security

- Passwords are hashed with scrypt; sessions are signed, HttpOnly cookies.
- Login and sign-up are rate limited; state-changing requests require a custom header.
- Sync requests are HMAC-signed with replay protection.
- The operator phone number is reserved: it cannot be registered, and that account cannot be suspended or deleted from the console.
- Keep `.env` out of Git (it is listed in `.gitignore`). If a password or key is ever exposed, rotate it immediately.

---

## Testing

With a registered ISP and a running server:

```bash
BASE=http://localhost:3000 ISP_ID=isp-xxxxxx API_KEY=your-key node test.js
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `bad auth : authentication failed` | Wrong MongoDB username or password, or the `PUT_NEW_PASSWORD_HERE` placeholder is still in `MONGODB_URI` |
| Connection timeout to MongoDB | Allow the host's IP in Atlas → Network Access |
| Cannot sign in as operator | `ADMIN_EMAIL` / `ADMIN_PASSWORD` are not set on the host |
| Logins reset after every restart | `SESSION_SECRET` is not set |
| Payment never confirms | `PUBLIC_URL` is wrong or the site is asleep; check `PAYHERO_CALLBACK_SECRET` |
| Render deploy fails to find files | Root Directory must be empty if `server.js` is at the repo root |
| Browser shows old UI after an update | Hard refresh with `Ctrl+Shift+R` |

---

## Contributing

Issues and pull requests are welcome. Keep the project dependency-light and never commit secrets.

## License

All rights reserved. Contact the author for licensing.

## Author

Built by [@mikyza](https://github.com/mikyza).
