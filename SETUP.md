# Production setup — Ubuntu 22.04 VPS

End-to-end provisioning for a single-tenant SalesAutomation deploy on a fresh
Ubuntu 22.04 box. Target: 4 GB RAM, 2 vCPU, 40 GB disk. Frontend deployed
separately on Cloudflare Pages.

## 0. Inventory before you start

- A fresh Ubuntu 22.04 server with sudo access.
- A DNS A record pointing `api.your-domain.com` to the server's IP.
- An OpenAI API key (or Gemini key — set after first boot via Settings).
- A WhatsApp business phone you can keep online for the QR scan and beyond.
  This phone must NOT be running WhatsApp Business or have an active linked-device
  conflict on the same number elsewhere.
- (Optional) Microsoft Graph credentials for **agent-initiated demo booking** —
  `tenant_id`, `client_id`, `client_secret`, plus a user GUID who owns Teams
  meetings (`organizer_user_id`). Skip if you don't need demo booking yet — the
  integration auto-stubs and Book demo will record bookings with placeholder
  links. Full Azure AD walkthrough in [§15 below](#15-demo-booking-microsoft-teams--optional).

## 1. System packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
  build-essential \
  curl git \
  postgresql-client-16 \
  redis-tools \
  nginx \
  certbot python3-certbot-nginx \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64
```

The last line is the Chromium runtime that whatsapp-web.js's bundled Puppeteer
needs. (We install it via `apt` so the bundled binary works headlessly under PM2.)

## 2. Install Node.js 20 via nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm alias default 20
node --version   # → v20.x
```

## 3. Install PM2 + log rotation

```bash
npm install -g pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

## 4. Install Docker (for Postgres + Redis containers)

```bash
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# log out + log back in for the group change to take effect, OR:
newgrp docker
```

You can skip Docker and run Postgres + Redis natively if you prefer; just
ensure pgvector is installed in the Postgres instance.

## 5. Clone + configure

```bash
sudo mkdir -p /opt/sa && sudo chown $USER:$USER /opt/sa
cd /opt/sa
git clone <your-fork-or-repo-url> .

cp .env.example .env
nano .env
```

In `.env`, set at minimum:
- `JWT_SECRET` — `openssl rand -hex 64`
- `ENCRYPTION_KEY` — `openssl rand -hex 32`  (must be exactly 32 bytes / 64 hex chars)
- One AI provider key (either is fine):
  - `OPENAI_API_KEY` — get from <https://platform.openai.com/api-keys>
  - `GEMINI_API_KEY` — get from <https://aistudio.google.com/app/apikey>
- `FRONTEND_URL` — `https://app.your-domain.com` (your Cloudflare Pages URL)
- `NODE_ENV=production`
- `PORT=4000` (default)

For a detailed walkthrough of each provider — getting the key, choosing models,
costs, and the runtime switch — see [AI_PROVIDERS.md](AI_PROVIDERS.md).

Microsoft Graph credentials and per-provider model selection can stay env
defaults and be overridden later via the Settings UI (encrypted at rest).

## 6. Bring up infra

```bash
docker compose up -d
docker compose ps   # verify postgres + redis are "healthy"
```

The Postgres image is `pgvector/pgvector:pg16` — pgvector is preinstalled.
First boot may take ~30 seconds.

## 7. Backend bootstrap

```bash
cd /opt/sa/backend
npm install --omit=dev
npx prisma migrate deploy   # applies all migrations cleanly in production
npm run seed                # creates default tenant + super_admin (NOTE the password!)
mkdir -p logs uploads backups
```

**Save the seeded admin password from the seed output — it is shown once.** Lose
it and you'll need to manually update `users.password_hash` to a fresh bcrypt
hash before you can log in.

## 8. Start with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd       # follow the printed command to enable on boot
```

Verify all three processes are online:

```bash
pm2 status
# ┌───┬──────────────┬─────────┬─────────┬─────────┬──────────┐
# │ 0 │ sa-api       │ online  │ 0       │ 60s     │ ...      │
# │ 1 │ sa-wa-worker │ online  │ 0       │ 60s     │ ...      │
# │ 2 │ sa-worker    │ online  │ 0       │ 60s     │ ...      │
```

Tail logs:

```bash
pm2 logs               # all
pm2 logs sa-wa-worker  # just one
```

## 9. Nginx reverse proxy + SSL

Create `/etc/nginx/sites-available/sa-api`:

```nginx
upstream sa_api {
    server 127.0.0.1:4000;
    keepalive 32;
}

server {
    listen 80;
    server_name api.your-domain.com;

    # Cloudflare real IP — adjust if your CDN differs.
    real_ip_header CF-Connecting-IP;
    set_real_ip_from 0.0.0.0/0;

    client_max_body_size 30M;   # PDF uploads up to 25M + headroom

    location / {
        proxy_pass http://sa_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Socket.io WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 75s;
    }
}
```

Enable and provision certificates:

```bash
sudo ln -s /etc/nginx/sites-available/sa-api /etc/nginx/sites-enabled/sa-api
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.your-domain.com
# Certbot rewrites the server block to listen on 443 + adds the redirect.
```

## 10. Frontend on Cloudflare Pages

1. Create a Pages project, point it at the same Git repo, set:
   - Build command: `cd frontend && npm install && npm run build`
   - Build output directory: `frontend/dist`
   - Root directory: `/`
2. Environment variables (Production):
   - `VITE_API_BASE_URL=https://api.your-domain.com/api`
   - `VITE_SOCKET_URL=https://api.your-domain.com`
3. Add a custom domain `app.your-domain.com` and set up the CNAME.
4. The repo already includes `frontend/public/_redirects` (SPA fallback) and
   `frontend/public/_headers` (caching + security headers).

## 11. WhatsApp number QR setup

1. Open `https://app.your-domain.com` and log in with the seeded super admin.
2. Click the **WhatsApp** tile → status shows `AWAITING_QR`.
3. On your business phone: WhatsApp → Settings → Linked Devices → Link a Device.
4. Scan the QR. Status flips through `AUTHENTICATING` → `READY`.
5. The session is persisted in `backend/.wwebjs_auth/` — restarts re-use it
   without a new scan.

## 12. First-pass configuration via Settings UI

Open the **Settings** tile and walk through each panel:

- **AI** — confirm the active provider, set the OpenAI/Gemini API key (encrypted
  at rest if you'd rather not keep it in `.env`), tune `ai.confidence_threshold`
  (start at **0.3–0.5** for a fresh KB; tighten to **0.7+** once you've seen
  what real customer questions score). **Behavioural note:** below-threshold
  retrieval no longer auto-escalates to MANUAL — the customer gets the FALLBACK
  template (which counts toward the 10-reply cap) and the session stays in AI
  mode. Only the 10-cap and explicit admin "Take over" flip a session to MANUAL.
- **Session** — keep defaults (7-day reset, 24-hour resume) unless you have a reason.
- **WhatsApp** — start with `wa.warmup_mode=true` for a fresh number; flip off
  after 2-3 days of normal traffic to lift the rate cap.
- **Manual Queue** — SLA in minutes (default 10).
- **Microsoft Teams** — set if doing demo bookings; leave blank for stub mode.
  See [§15](#15-demo-booking-microsoft-teams--optional) for the full Azure AD setup.
- **Templates** — at minimum review `ONBOARDING_DEFAULT`, `FALLBACK`,
  `MANUAL_HANDOFF`, `SESSION_RESUME`, and `DEMO_CONFIRMATION` (the last one is
  what gets sent to the customer when an agent books a demo — variables:
  `{{joinUrl}}`, `{{scheduledAt}}`, `{{durationMinutes}}`, `{{subject}}`).

Then create your first **Campaign** and upload your first **KB** PDF.

## 13. Verify

```bash
curl https://api.your-domain.com/health
# → 200 { status: "ok", api: "ok", db: "ok", redis: "ok", vector: "ok" }
```

In the dashboard:
- WhatsApp tile shows READY.
- Health page shows all green.
- Send a campaign-tag message from a test phone → onboarding arrives → ask a
  KB-grounded question → AI replies.

## 14. Backups

The worker process runs `pg_dump`, `redis BGSAVE`, and tars `.wwebjs_auth/`
to `backend/backups/` daily at 03:00 server time, with 7-day retention.

Off-box backup: rsync the directory to a separate host or S3-compatible
storage. Add to root cron:

```cron
30 3 * * * rsync -az /opt/sa/backend/backups/ user@backup-host:/backups/sa/
```

## Troubleshooting

- **wa-worker keeps restarting** — check `pm2 logs sa-wa-worker`. If you see
  Chromium "shared library" errors, you're missing the `apt` runtime libs from
  step 1.
- **`prisma migrate deploy` fails on "extension vector does not exist"** — your
  Postgres image isn't `pgvector/pgvector`. Fix: `docker compose down && docker
  volume rm sa_pg_data && docker compose up -d` (DESTROYS DATA), then re-run
  step 7.
- **Customer always gets the FALLBACK template, never a real KB answer** —
  retrieval is scoring under the threshold. Open the dashboard AI Coverage banner;
  if it's there, click "Re-embed all" (the active AI provider was probably
  switched after PDFs were uploaded). If the banner isn't showing, lower
  `ai.confidence_threshold` to 0.3 in Settings → AI, and ask the same question
  again — the worker log shows the actual confidence score so you can pick a
  realistic threshold.
- **AI escalates to MANUAL after the 10th reply** — that's correct: the cap is
  the only auto-MANUAL trigger by design. Agent claims the chat in the Manual
  Queue, replies, and clicks "Hand back to AI" when done.
- **Book demo button is greyed out / "Microsoft Teams not configured" warning** —
  fill the four `microsoft.*` settings in Settings → Microsoft Teams (full
  Azure AD setup in [§15](#15-demo-booking-microsoft-teams--optional)). Until
  you do, bookings still record but the customer gets a placeholder link.
- **Bull-Board (`/admin/queues`) shows "missing bearer token"** — make sure
  you're navigating from the **Queues** tile in the sidebar, not pasting the URL
  directly. The sidebar appends `?token=…` which the middleware swaps into a
  short-lived cookie scoped to `/admin/queues`. Pasting the bare URL bypasses
  this handoff.
- **`pm2 startup` doesn't survive reboot** — `pm2 save` after `pm2 startup`,
  and verify `systemctl status pm2-$USER` is enabled.

## 15. Demo booking (Microsoft Teams) — optional

**How it works in one paragraph.** Demo booking is **agent-initiated, not
AI-initiated**. The strict KB-only system prompt prevents the AI from
proactively suggesting calls, asking for availability, or offering meeting
links — even if a customer asks. When an agent is reading a chat and decides a
demo is the right move, they click **Book demo** in the chat toolbar, fill in
the time/duration/subject, submit. The backend hits Microsoft Graph
(client-credentials flow) to create a real Teams `onlineMeeting`, writes a
`demo_bookings` row, and sends the customer the `DEMO_CONFIRMATION` template
(`source=SYSTEM` so it does **not** count against the 10-AI-reply cap). If
Teams creds are missing the booking still records, but the customer receives a
placeholder URL — the Book demo modal warns the agent up-front when this is
the case.

### 15.1 Register an Azure AD app (one time, ~5 min)

1. <https://entra.microsoft.com/> → **App registrations** → **New registration**
   → name it `SalesAutomation Demos` → leave redirect URI blank → **Register**.
2. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** → enable **`OnlineMeetings.ReadWrite.All`** →
   **Add permissions**.
3. Click **Grant admin consent for <tenant>** (you need to be a tenant admin or
   have one click this for you).
4. **Certificates & secrets** → **Client secrets** → **New client secret** →
   description `sa-prod` → expiry 24 months → **Add**. **Copy the `Value`
   immediately** — it disappears after this page reload.
5. **Overview** tab → copy:
   - **Application (client) ID** → `microsoft.client_id`
   - **Directory (tenant) ID** → `microsoft.tenant_id`
6. The secret you copied in step 4 → `microsoft.client_secret`.

### 15.2 Pick a meeting organizer

Microsoft Graph requires a real user account to *own* the meeting; the
application registers it on that user's behalf. Pick the user whose name should
appear as the meeting host (e.g. a generic `demos@your-domain.com` mailbox or
a sales lead).

1. <https://entra.microsoft.com/> → **Users** → click the user.
2. Copy the **Object ID** (a GUID) → `microsoft.organizer_user_id`.

### 15.3 Grant the app rights to create meetings on the organizer's behalf

This is the step most setups miss. Even with `OnlineMeetings.ReadWrite.All`
granted, Microsoft Graph requires an **application access policy** scoped to
the specific organizer. Run this from any machine with the Microsoft Teams
PowerShell module (`Install-Module MicrosoftTeams` if you don't have it),
signed in as a Teams admin:

```powershell
Connect-MicrosoftTeams

# Create the policy and attach our Azure AD app to it
New-CsApplicationAccessPolicy `
  -Identity SalesAutoDemoPolicy `
  -AppIds "<microsoft.client_id GUID>" `
  -Description "SalesAutomation demo booking"

# Grant the policy to the organizer user
Grant-CsApplicationAccessPolicy `
  -PolicyName SalesAutoDemoPolicy `
  -Identity "<microsoft.organizer_user_id GUID>"
```

Policy propagation takes a few minutes. If you skip this step, the Graph call
fails with `Forbidden` even though the API permission is granted.

### 15.4 Save the four settings

Settings → **Microsoft Teams** section → fill all four:

| Setting | Source |
|---|---|
| `microsoft.tenant_id` | Azure AD app Overview → Directory (tenant) ID |
| `microsoft.client_id` | Azure AD app Overview → Application (client) ID |
| `microsoft.client_secret` | Azure AD app → Certificates & secrets → secret Value (encrypted at rest) |
| `microsoft.organizer_user_id` | Entra Users → organizer's Object ID |

The API auto-reads this within ~30 seconds (settings cache). Open any chat →
**Book demo** — the modal should no longer show the "not configured" warning.

### 15.5 Customise the customer-facing template

Templates → **DEMO_CONFIRMATION** → edit. Available variables:

| Variable | Example |
|---|---|
| `{{joinUrl}}` | `https://teams.microsoft.com/l/meetup-join/…` |
| `{{scheduledAt}}` | ISO timestamp of the demo |
| `{{durationMinutes}}` | `30` |
| `{{subject}}` | `Product demo` |

Default content uses all four. Keep it short — WhatsApp truncates long messages
and the join URL must stay clickable.

### 15.6 Verify end-to-end

1. Open any active chat as super admin or admin.
2. Click **Book demo** → pick a time 15 min in the future → submit.
3. Worker logs: `q:outgoing dispatched` for the DEMO_CONFIRMATION message.
4. Customer's WhatsApp shows the message with a real `teams.microsoft.com/…`
   link.
5. Click the link from a browser → joins the Teams meeting lobby.
6. DB: `demo_bookings` row exists; `chat_sessions.ai_reply_count` is **not**
   bumped (correct — system messages don't count).

If the call to Graph 401s/403s, re-check §15.3 (most common cause is the
policy hasn't propagated yet, or it was granted to the wrong user GUID).

---

## Upgrades

```bash
cd /opt/sa
git pull
cd backend
npm install --omit=dev
npx prisma migrate deploy
pm2 reload ecosystem.config.js --env production   # zero-downtime restart
```

For frontend, push to your Git branch — Cloudflare Pages rebuilds automatically.
