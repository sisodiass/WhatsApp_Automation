# Operations runbook

Quick reference for common production scenarios. Assumes the deploy from
[SETUP.md](SETUP.md). All paths relative to `/opt/sa/backend` unless noted.

## Process management

```bash
pm2 status                    # who's up
pm2 logs                      # tail everything
pm2 logs sa-wa-worker         # tail one
pm2 reload ecosystem.config.cjs --env production  # zero-downtime restart
pm2 restart sa-wa-worker      # hard restart one process
pm2 monit                     # interactive top
```

## Common scenarios

### WhatsApp got logged out / linked-device limit

1. Open the WhatsApp page in admin → click **Logout number**.
2. Status flips to `DISCONNECTED`.
3. The next QR appears within 10s. Re-scan from the phone.

If that doesn't work: `rm -rf /opt/sa/backend/.wwebjs_auth/* && pm2 restart sa-wa-worker`,
then re-scan.

### KB stops returning answers (customer keeps getting the FALLBACK template)

> **Behavioural reminder.** Low-confidence retrieval no longer auto-flips a
> session to MANUAL. The customer gets the FALLBACK template and the session
> stays in AI mode (the fallback is counted toward the 10-reply cap, so a
> chat can't loop on fallbacks forever — once the cap is hit, the cap-handler
> is the one and only auto-MANUAL trigger).

So "everything is fallback" usually means one of:

1. **Embeddings out of sync.** Open the dashboard. If the **AI coverage banner**
   is showing, click **Re-embed all**. Most common cause: someone switched
   `ai.provider` and the existing embeddings were made by the previous provider.
2. **Confidence threshold too tight for the KB content.** Worker log
   (`pm2 logs sa-worker`) shows `q:kb-search retrieved { confidence: 0.x }`
   for every inbound. If real questions consistently score 0.4–0.6 but the
   threshold is 0.7, you'll fallback on everything that isn't a near-verbatim
   match. Lower `ai.confidence_threshold` in Settings → AI to ~0.4 and re-test.
3. **pgvector not loaded.** Check `Health` → `pgvector` row. If red, the
   `vector` extension isn't loaded — see SETUP.md troubleshooting.
4. **Provider auth broken.** `/api/ai/health` returns 503 → re-enter the API
   key in Settings → AI. Until then the kb-search worker catches the error
   and routes through the fallback path (no BullMQ retry storm).

### Worker queue backed up

1. Open `/admin/queues` from the **Queues** sidebar tile (don't paste the URL
   directly — the sidebar tile appends a `?token=…` query that the middleware
   converts into a short-lived cookie; bare URLs return "missing bearer token").
2. Find the queue with high "failed" count.
3. Click into a failed job → see the error message.
4. Common causes:
   - `kb-search` failing → OpenAI/Gemini API key invalid (check Settings → AI → Set new key).
     Note: a kb-search failure no longer leaves the customer hanging — the
     entire pipeline is wrapped in try/catch and routes through the FALLBACK
     path on any error. So "queue failed" + "customer got nothing" is not the
     same incident anymore. If failed count climbs but customers report
     fallbacks, the pipeline is recovering correctly; just fix the upstream
     cause.
   - `outgoing-messages` failing → wa-worker down (check Health → wa-worker row).
   - `pdf-processing` failing → bad PDF or OOM. Check the document's `errorMessage`
     field via Prisma Studio.

### Customer's session is stuck

1. Find the chat in **Inbox** (search by phone).
2. Open the chat. Check the right panel session list.
3. If a session is stuck in MANUAL with no agent claim → click **Hand back to AI**.
4. If a session needs to be killed without ending the customer's whole experience →
   click **Close session**. Their next campaign-tag message starts a fresh one.

> **Reminder of the auto-MANUAL contract.** The only thing that auto-flips
> a session to MANUAL is the 10-AI-reply cap. Low confidence, no KB groups
> on the campaign, global AI off, generation timeout, and provider auth
> errors all route through the FALLBACK template (counted toward the cap),
> never auto-MANUAL. Admin "Take over" / "Hand back to AI" remain the manual
> override.

### Need to disable AI globally for an hour

Click the green **AI ON** pill in the dashboard header → flips to red. All
new inbound messages get the FALLBACK template instead of AI replies, and
sessions **stay in AI mode** (so when you re-enable, normal AI behaviour
resumes without you having to manually flip every session back). The 10-cap
still applies: a chat that exhausts its 10 fallbacks while AI is off will
escalate to MANUAL like normal.

### Book a demo for a customer

(Full Teams credential setup is in SETUP.md §15.)

1. Open the chat in **Inbox**.
2. In the chat toolbar, click **Book demo** (calendar icon, between the
   pause/active controls and Close).
3. Pick when (default 1 hour out, rounded to next 15 min), duration (default
   30), and subject (default "Product demo").
4. Submit. The backend creates the Teams meeting via Microsoft Graph and
   sends the customer the `DEMO_CONFIRMATION` template (variables `{{joinUrl}}`,
   `{{scheduledAt}}`, `{{durationMinutes}}`, `{{subject}}`).
5. The booking is recorded in `demo_bookings` and shown in the Customer
   Panel's history. **It does not bump `ai_reply_count`** — the message is
   `source=SYSTEM`, not `source=AI`.

Edge cases:
- **"Microsoft Teams not configured" warning in the modal** — fill the four
  `microsoft.*` settings (SETUP.md §15.4). Until you do, you can still book —
  the customer just gets a placeholder URL instead of a real Teams link.
- **Graph returns 403 / Forbidden** — the application access policy in
  SETUP.md §15.3 either wasn't run or hasn't propagated yet (allow ~10
  minutes after grant). Re-check the policy targets the same
  `microsoft.organizer_user_id` GUID as the setting.
- **AI never proactively offers a demo** — by design. The strict KB-only
  system prompt forbids it. If you want AI to *suggest* booking when a
  customer asks for a call, add the suggestion text to a KB document and the
  AI will echo it (without booking). The actual booking always happens via
  the agent click.

### Audit who changed a setting

Settings page → top-right **Audit log** button. Filter by key (e.g., `ai.provider`)
to see every change.

### Restart everything cleanly

```bash
pm2 reload ecosystem.config.cjs --env production
```

`reload` keeps the API alive during the restart of each process (PM2 starts
the new instance, drains, then kills the old one). If you need a hard restart
(e.g., after a Prisma client regen):

```bash
cd /opt/sa/backend && npx prisma generate
pm2 restart all
```

## Backups

Daily at 03:00 server time the scheduler runs:
- `pg_dump --format=custom` → `backups/pg-YYYY-MM-DD.dump`
- `redis BGSAVE` → in-place RDB
- `tar -czf` of `.wwebjs_auth/` → `backups/wwebjs-YYYY-MM-DD.tar.gz`

Retention: 7 days. Adjust in [scheduler.worker.js](backend/src/workers/queues/scheduler.worker.js).

### Manual backup right now

```bash
node -e "
import('./src/shared/queue.js').then(({ getQueue }) =>
  getQueue('scheduler-jobs').add('backup', {})
    .then(() => process.exit(0))
);
" --input-type=module
```

Or open `/admin/queues` → scheduler-jobs → "Add new job" with name `backup`.

### Restore Postgres from a dump

```bash
pg_restore \
  --clean --if-exists \
  --dbname=postgresql://sa:sa@localhost:5432/salesautomation \
  /opt/sa/backend/backups/pg-2026-05-07.dump
```

### Restore .wwebjs_auth

```bash
pm2 stop sa-wa-worker
rm -rf .wwebjs_auth
tar -xzf backups/wwebjs-2026-05-07.tar.gz
pm2 start sa-wa-worker
```

## Health monitoring

`/api/health/full` returns 200 if everything is OK or 503 if any component
is red. Plug it into your uptime monitor (UptimeRobot, Pingdom, BetterStack):
- URL: `https://api.your-domain.com/api/health/full`
- Auth: needs a Bearer token. Easier: monitor the unauthenticated `/health`
  which gives db/redis/pgvector status.

## Rotating secrets

### JWT secret

```bash
# 1. Edit .env, set new JWT_SECRET
# 2. Restart API
pm2 restart sa-api
# All existing tokens invalidate — users must re-login.
```

### Encryption key

⚠️ Changing `ENCRYPTION_KEY` makes every encrypted setting (API keys,
Microsoft client_secret) unreadable. After changing:

```bash
# Re-enter every encrypted setting via Settings UI.
# Until you do, the AI provider falls back to env-supplied keys (if set).
```

### OpenAI / Gemini key

Settings → AI → click **Replace** next to the api key field → paste new
value → Enter. The AI provider cache invalidates within seconds.

## Scaling notes (when 4 GB stops being enough)

Watch for:
- `sa-wa-worker` RSS climbing past 700M consistently → Chromium leak. The
  `max_memory_restart: 800M` in [ecosystem.config.cjs](backend/ecosystem.config.cjs)
  catches this; investigate if it's restarting more than 1×/day.
- `sa-worker` queue depth growing during peaks → split scheduler off into its
  own process. Add a 4th PM2 entry with `script: "src/workers/scheduler-only.js"`.
- DB CPU saturating → upgrade Postgres tier; pgvector is the heavy reader.
- AI cost spike → tighten `ai.confidence_threshold` (more escalations to
  MANUAL = fewer LLM calls), or switch to `gpt-4o-mini` if not already.

For multi-tenant: re-architect first (row-level + per-tenant wa-worker
process). The schema is forward-compatible (`tenant_id` columns everywhere)
but the PM2 / Chromium-per-number constraint is the bottleneck.
