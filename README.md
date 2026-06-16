# autaddcal

Sync your [Fast Retailing WPS](https://wps.fastretailing.com/login) work schedule to Google Calendar.

## How it works

1. **WPS** — Authenticates via Fast Retailing's ADFS SSO (same flow as the WPS web app), then fetches your schedule from `POST /api/Calendar`.
2. **Google Calendar** — Uses OAuth to create/update events on your primary calendar.
3. **Sync** — Runs on demand or on a cron schedule (default: every 6 hours).

Work shifts (with start/end times), days off, holidays, and leave types are mapped to calendar events.

## Prerequisites

- Node.js 20+
- A Google Cloud project with the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) enabled
- OAuth 2.0 credentials (Web application) with redirect URI: `http://localhost:3000/auth/google/callback`
- Playwright Chromium: `npx playwright install chromium`

## Setup

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to .env:
ENCRYPTION_KEY=<64-char-hex>
GOOGLE_CLIENT_ID=<from-google-cloud-console>
GOOGLE_CLIENT_SECRET=<from-google-cloud-console>
```

Install and run:

```bash
npm install
npx playwright install chromium
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. Click **Create profile**
2. **Connect WPS** — Enter your employee ID and password
3. **Connect Google Calendar** — Complete the OAuth flow
4. Click **Sync now** (or wait for the scheduled sync)

WPS login uses Fast Retailing's ADFS SSO. After entering your employee ID, the service selects **Password** (not certificate) and signs in. Your password is used only during login and is not stored.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users` | POST | Create a user profile |
| `/api/users/:id` | GET | Get connection status |
| `/auth/wps/login/:userId` | POST | Sign in with employee ID + password |
| `/auth/google/connect/:userId` | GET | Start Google OAuth |
| `/api/sync/:userId` | POST | Sync one user |
| `/api/sync` | POST | Sync all connected users |

## Important notes

### WPS authentication

WPS uses corporate ADFS SSO. Some accounts require MFA or certificate login — automated login may not work for all users. If login fails, your store may use authentication methods this tool cannot automate.

WPS sessions expire. Reconnect WPS if sync reports an expired session.

### Security

- WPS session cookies and Google tokens are stored encrypted (AES-256-GCM) in a local SQLite database.
- WPS passwords are **not** stored — they are only used during the login handshake.
- Run this on a machine you control. Do not expose it publicly without proper hardening.

### Google Calendar

Events are written to your **primary** calendar with a private `autaddcal-wps` source tag. Existing synced events are updated; removed shifts are deleted from Google Calendar.

## Development

```bash
npm run build   # compile TypeScript
npm start       # run compiled server
```

Manual sync for all users:

```bash
curl -X POST http://localhost:3000/api/sync
```

## Architecture

```
Browser UI  →  Express API  →  WPS Client (Playwright + REST)
                            →  Google Calendar API
                            →  SQLite (users, synced events)
```

WPS calendar codes (from the WPS app):

| Code | Meaning |
|------|---------|
| D01 | Work shift |
| D02 | Day off |
| D03 | Public holiday |
| D04–D16 | Various leave types |

## License

MIT
# autoaddcal
