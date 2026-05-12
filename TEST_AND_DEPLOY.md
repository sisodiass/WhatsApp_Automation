# Testing + production deploy guide

The full cycle: **local smoke test → build verify → ship to VPS → post-deploy verify → rollback if needed.**

For first-time VPS provisioning, see [SETUP.md](SETUP.md). For day-to-day ops once it's live, see [OPS.md](OPS.md). This file is the workflow that connects them.

> **No automated test suite ships with the repo yet.** Everything below is a manual smoke checklist. If you want CI, the recommended additions live in [§9](#9-future-adding-automated-tests).

---

## 1. Pre-flight: local smoke test

Before any deploy. Catches dep-version drift, schema mistakes, env misconfig.

### 1.1 Bring up local infra

```bash
cp .env.example .env                       # if not already
# Generate secrets:
#   openssl rand -hex 64    → JWT_SECRET
#   openssl rand -hex 32    → ENCRYPTION_KEY
# Paste your real OPENAI_API_KEY (and GEMINI_API_KEY if testing both providers).
#
# Microsoft Teams demo booking (optional — needed only if you'll smoke-test §H2):
#   You can leave the four `microsoft.*` settings blank — demo booking falls
#   back to stub mode and sends a placeholder URL to the customer. The full
#   Azure AD walkthrough is in SETUP.md §15.

docker compose up -d                       # postgres+pgvector, redis
docker compose ps                          # both should be "healthy"
```

### 1.2 Apply migrations + seed

```bash
cd backend
npm install
npx prisma migrate dev                     # creates DB, applies all migrations
npm run seed                               # tenant + super_admin + templates + test campaign
```

**Note the printed admin password.** Lose it and you'll need to manually rebuild the `users.password_hash` row.

### 1.3 Start all four processes

Four terminals, all from the repo root:

```bash
cd backend  && npm run dev                 # API on :4000
cd backend  && npm run dev:wa              # wa-worker (Chromium, ~150MB first run)
cd backend  && npm run dev:worker          # BullMQ workers + scheduler
cd frontend && npm install && npm run dev  # Vite on :5173
```

Health checkpoint:

```bash
curl http://localhost:4000/health
# → 200 { status: "ok", api: "ok", db: "ok", redis: "ok", vector: "ok" }
```

If any field isn't `ok`, fix it before continuing.

---

## 2. Acceptance smoke tests (local)

Run these in order. Each one exercises one or more phases. **All nine should pass before you touch production.**

You'll need:
- Browser logged in as `admin@local.test` (the seeded super admin)
- A test phone (cannot be the same WhatsApp account that's linked as the business number)

### A. Auth + RBAC
- [ ] Log in with the seeded super admin → land on dashboard.
- [ ] Open DevTools → delete the `accessToken` from localStorage → next page nav silently refreshes via the cookie. (Phase 1)

### B. WhatsApp connection
- [ ] WhatsApp tile → status is `AWAITING_QR`.
- [ ] Scan QR with the business phone (Settings → Linked Devices → Link a Device).
- [ ] Status flips through `AUTHENTICATING` → `READY`. (Phase 2)
- [ ] Restart only the wa-worker terminal — status reconnects without rescan (LocalAuth persisted to `backend/.wwebjs_auth/`).

### C. KB upload + embedding
- [ ] Knowledge Base → New group "Sales".
- [ ] Upload a real PDF (any pricing doc / FAQ). Status badge ticks `PENDING → PROCESSING → READY` within seconds.
- [ ] Open Prisma Studio (`npx prisma studio`) → `kb_chunks` rows have non-null `embedding`, `embedding_provider`, `embedding_model`. (Phase 4)

### D. Test campaign — end-to-end
- [ ] Campaigns page → see `Test (internal)` row with the SYSTEM badge. (Add the Sales KB group via Edit if you want to test AI replies.)
- [ ] From the test phone, send: `https://wa.me/<business-number>?text=CAMPAIGN_TEST_INTERNAL`
- [ ] Onboarding message arrives within ~2 seconds. (Phase 3)
- [ ] DB: a new `chats` row + `chat_sessions` row with `state=NEW, ai_reply_count=0`.

### E. AI reply (Phase 5)
- [ ] From the test phone, ask a question that's actually answered in the PDF (e.g. "what's the price for the Pro plan?").
- [ ] Worker logs show: `q:kb-search retrieved { chunks: N, confidence: 0.x }` → `enqueued AI reply` → `q:outgoing dispatched`.
- [ ] Customer receives a KB-grounded answer within ~10–25s.
- [ ] DB: `chat_sessions.ai_reply_count = 1`, `last_confidence` set, `ai_provider` populated.

### F. Confidence gate + 10-cap → manual queue (Phase 6)

> **Behavioural note (read first).** Low-confidence retrieval no longer flips
> the session to MANUAL. The customer gets the FALLBACK template, the session
> stays in AI mode, and the FALLBACK message counts toward the 10-AI-reply
> cap. The **only** thing that auto-flips MANUAL is hitting the cap. So this
> test is now two parts: confirm the fallback path, then confirm the cap path.

**F1 — Low-confidence fallback (no MANUAL flip):**
- [ ] From the test phone, ask something off-topic ("what's the weather?").
- [ ] Customer receives the **FALLBACK** template (default: "I can currently
      assist only with topics available in our knowledge base.").
- [ ] Chat session badge in the admin chat view stays **AI** (does NOT flip MANUAL).
- [ ] `chat_sessions.ai_reply_count` increments by 1 (the fallback counts).
- [ ] No new entry in the Manual Queue tile.

**F2 — 10-cap → MANUAL escalation:**
- [ ] Send 9 more in-KB or off-topic messages until `ai_reply_count` hits 10.
- [ ] On the 11th inbound, the customer receives the `MANUAL_HANDOFF` template
      (NOT a fallback or AI reply).
- [ ] Session badge flips to **MANUAL**, Manual Queue tile shows count +1.
- [ ] Click "Claim & open" → chat detail opens. Type "Hi, agent here." → send.
      Customer sees the agent reply.
- [ ] Click "Hand back to AI" → mode flips back. (Confirms A2 manual override
      too — any in-flight AI reply would have been cancelled.)

### G. Provider switch (provider abstraction)
*Full step-by-step in [AI_PROVIDERS.md](AI_PROVIDERS.md). Skip if you only have one AI key.*
- [ ] Settings → AI → set the Gemini API key (encrypted at rest), then change `ai.provider` from `openai` to `gemini`.
- [ ] Dashboard banner appears warning that KB embeddings need re-processing. Click "Re-embed all".
- [ ] After all docs go back to READY, ask the same in-KB question. Worker logs show the provider as `gemini`. `chat_sessions.ai_provider` populates with `"gemini"`.
- [ ] Switch back to `openai`, re-embed, retry — confirms round-trip.

### H. Settings + audit
- [ ] Settings → toggle `ai.global_enabled` off → next inbound customer message
      gets the **FALLBACK** template (and the session **stays in AI** — the
      cap is the only auto-MANUAL trigger). Toggle back on; AI replies resume
      with no manual intervention needed.
- [ ] Audit log → see both rows with the right old → new + your email. (Phase 8)

### H2. Demo booking (Phase 9 — Microsoft Teams)
*Skip if you haven't filled the four `microsoft.*` settings. Stub mode also
works for this test — the customer just gets a placeholder URL instead of a
real Teams link, and the modal warns you up-front.*

- [ ] Open any active chat as super admin or admin.
- [ ] Chat toolbar → click **Book demo** (calendar icon).
- [ ] Modal opens. If Teams is not configured, the warning banner is visible.
- [ ] Pick a time ~15 min in the future, duration 30, subject "Smoke test demo".
      Submit.
- [ ] Toast: "Demo booked — Teams link sent to customer" (or
      "Demo recorded (Teams not configured — placeholder link sent)" in stub mode).
- [ ] Customer receives the `DEMO_CONFIRMATION` template with the join URL.
- [ ] DB: `demo_bookings` row with `meetingUrl` populated; `chat_sessions.ai_reply_count`
      did **not** change (correct — system messages don't count).
- [ ] (Real Teams mode only) Click the join URL in WhatsApp → joins the
      Teams meeting lobby in the browser.

If the modal submits but Graph returns 403, see SETUP.md §15.3 — most often
the application access policy hasn't propagated yet (allow ~10 minutes after
`Grant-CsApplicationAccessPolicy`).

### I. Health dashboard
- [ ] `/health` → all components green.
- [ ] Stop the wa-worker terminal → within ~35 seconds the wa-worker card flips to DOWN, overall banner becomes DEGRADED. Restart → recovers.
- [ ] (Don't kill Postgres unless you're prepared to re-up it; otherwise the API returns 503.)

---

## 3. Build verification

Before pushing the version that will get deployed, build it locally exactly the way production will.

### 3.1 Backend production install

```bash
cd backend
rm -rf node_modules
npm install --omit=dev                     # production-only deps; should still complete
npx prisma generate                        # ensures the client builds
node --check src/index.js                  # syntax sanity
node --check src/workers/index.js
node --check src/workers/whatsapp.worker.js
```

If any of these fail, the prod deploy will fail too.

### 3.2 Frontend production build

```bash
cd frontend
rm -rf node_modules dist
npm install
VITE_API_BASE_URL=https://api.your-domain.com/api \
VITE_SOCKET_URL=https://api.your-domain.com \
  npm run build
ls dist/                                   # should contain index.html + assets/
```

If you're deploying to Cloudflare Pages, the env vars are set in the Pages dashboard — locally you just verify the build succeeds.

### 3.3 Migration dry-run

```bash
cd backend
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

If this prints SQL, you have un-migrated schema changes. Run `npx prisma migrate dev --name <name>` to capture them before deploying. Pushing schema-drifting code to prod and running `migrate deploy` against it will fail.

---

## 4. Production deploy — first time

Walk through [SETUP.md](SETUP.md) end to end. Budget ~2 hours including DNS propagation and Let's Encrypt provisioning.

After finishing SETUP.md §13 (verify), come back here and run §6 below.

---

## 5. Production deploy — subsequent updates

Once SETUP.md has been done once, every later deploy is short.

### 5.1 On the VPS

```bash
ssh you@your-vps
cd /opt/sa
```

### 5.2 Stash anything local + pull

```bash
git status                                 # should be clean; if not, stash or commit
git pull --ff-only
```

### 5.3 Backend

```bash
cd backend
npm install --omit=dev
npx prisma migrate deploy                  # safe in prod; only applies new migrations
```

If the migration includes any **destructive** change (column drop, type change), back up first:

```bash
# Force a fresh backup before applying:
pm2 trigger sa-worker backup               # if you've wired pm2 trigger; otherwise:
node -e "import('./src/shared/queue.js').then(({ getQueue }) => \
  getQueue('scheduler-jobs').add('backup', {}).then(() => process.exit(0))" \
  --input-type=module
ls -lh backups/                            # confirm fresh dump exists
```

### 5.4 Frontend

If frontend is on Cloudflare Pages: nothing to do — pushing your branch triggers an automatic build. Verify at https://app.your-domain.com after Pages reports "deployed".

If you self-host the frontend: rebuild and copy `dist/` to your nginx root.

### 5.5 Reload PM2

```bash
cd /opt/sa/backend
pm2 reload ecosystem.config.cjs --env production
pm2 status                                 # all three should be "online"
```

`reload` does the rolling restart — the API stays up while each process is replaced.

---

## 6. Post-deploy verification

Run these against the **production URLs**. Every check must pass before you walk away.

### 6.1 Health endpoint
```bash
curl https://api.your-domain.com/health
# → 200 { status: "ok", ... }
```

If 503, immediately check `pm2 logs` for which component failed.

### 6.2 PM2 process status
```bash
pm2 status
# All three (sa-api, sa-wa-worker, sa-worker) should be "online" with low restart counts.
# A restart count > 5 since the deploy = something's flapping.
```

### 6.3 Smoke test the live system

Repeat **the exact same flow as the test campaign acceptance check (§2.D + 2.E)** but on production:

- [ ] Log in to https://app.your-domain.com as super admin.
- [ ] WhatsApp tile shows READY. (If not, re-scan QR — first prod boot needs it.)
- [ ] Send `https://wa.me/<prod-number>?text=CAMPAIGN_TEST_INTERNAL` from a test phone.
- [ ] Receive onboarding within 2 seconds.
- [ ] Ask an in-KB question (assuming you've uploaded production KB docs already). Receive AI reply within 25s.
- [ ] Check `chat_sessions.ai_reply_count = 1` for that chat (Prisma Studio over an SSH tunnel: `ssh -L 5555:localhost:5555 user@vps -- 'cd /opt/sa/backend && npx prisma studio'`).

### 6.4 Health dashboard
- [ ] `/health` page in admin UI → all components green.
- [ ] `/admin/queues` → all five queues visible, no failed jobs accumulating.
      **Important:** open this from the sidebar **Queues** tile, not by pasting
      the URL. The sidebar appends `?token=…` which the middleware swaps into
      a short-lived `sa_queues_token` cookie scoped to `/admin/queues`. Pasting
      the bare URL bypasses the handoff and you'll see "missing bearer token".

### 6.5 Rate limiter sanity (production only)
```bash
for i in {1..25}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://api.your-domain.com/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"nope@nope","password":"nope"}'
done
```

After ~20 requests you should start seeing `429`. Confirms the auth limiter is doing its job behind the proxy. If you never get `429`, check that nginx is forwarding `X-Forwarded-For` and that `app.set("trust proxy", 1)` is in effect.

---

## 7. Rollback

If post-deploy verification fails, roll back **before** debugging.

### 7.1 Code rollback
```bash
ssh you@your-vps
cd /opt/sa
git log --oneline -10                      # find the previous good commit
git checkout <previous-good-sha>
cd backend
npm install --omit=dev
pm2 reload ecosystem.config.cjs --env production
```

### 7.2 Schema rollback
Prisma doesn't auto-generate down migrations. **If the bad deploy applied a migration, you must roll the schema back manually:**

Option A — restore from the pre-deploy backup (cleanest):
```bash
pm2 stop sa-api sa-worker
pg_restore --clean --if-exists \
  --dbname=postgresql://sa:sa@localhost:5432/salesautomation \
  /opt/sa/backend/backups/pg-YYYY-MM-DD.dump
# Reset Prisma's _prisma_migrations table to mark the bad migration as rolled back:
psql postgresql://sa:sa@localhost:5432/salesautomation \
  -c "DELETE FROM _prisma_migrations WHERE migration_name = '<bad_migration_name>';"
pm2 start sa-api sa-worker
```

Option B — write a manual reverse-migration:
```bash
cd /opt/sa/backend
npx prisma migrate dev --create-only --name reverse_<bad_change>
# Edit the generated SQL to reverse the bad change.
npx prisma migrate deploy
```

Option A is faster and more reliable for non-trivial changes. Option B is better when the bad migration only added a column you can drop without data loss.

### 7.3 .wwebjs_auth rollback (rarely needed)
If a deploy somehow corrupted the WhatsApp session:
```bash
pm2 stop sa-wa-worker
rm -rf /opt/sa/backend/.wwebjs_auth
tar -xzf /opt/sa/backend/backups/wwebjs-YYYY-MM-DD.tar.gz -C /opt/sa/backend/
pm2 start sa-wa-worker
```

---

## 8. Deploy checklist (printable)

Pin this to your wall. Tick off in order.

```
PRE-DEPLOY
[ ] Local §1 + §2 acceptance tests pass against current branch
[ ] §3.1 backend prod install succeeds
[ ] §3.2 frontend prod build succeeds
[ ] §3.3 prisma diff is empty OR migration captured
[ ] Tagged the deploy: git tag deploy-YYYY-MM-DD-HHMM && git push --tags

DEPLOY
[ ] SSH to VPS, git pull --ff-only
[ ] Trigger fresh backup if migration is destructive
[ ] npm install --omit=dev + npx prisma migrate deploy
[ ] pm2 reload ecosystem.config.cjs --env production
[ ] pm2 status — all online, restart counts low

POST-DEPLOY (within 5 min)
[ ] curl /health → 200
[ ] §6.3 smoke test (campaign tag → onboarding → AI reply)
[ ] §6.4 /health page + /admin/queues green (open via sidebar tile, not bare URL)
[ ] §6.5 rate limiter sanity
[ ] (If Teams creds set) §H2 Book demo smoke test → real Teams join URL received

IF ANYTHING FAILS
[ ] §7 rollback BEFORE debugging
[ ] Capture pm2 logs to a file for the post-mortem
```

---

## 9. Future: adding automated tests

The repo doesn't ship with a test runner. Where you'd add one:

- **Backend unit tests** — `vitest` is light. Highest-leverage targets:
  - `session.service.handleInbound` — the three-path engine (reset / resume / normal). Mock Prisma + the queue producers.
  - `kb/chunker.chunkText` — pure function, easy to fuzz.
  - `kb/retrieval.hybridSearch` — needs a test Postgres with seeded chunks.
  - `ai/providers/*.healthCheck` — needs a stubbed fetch.
- **Backend integration tests** — `supertest` against an in-process Express app, with a test database container. Cover auth, RBAC, the full campaign + session + AI flow.
- **Frontend** — `vitest` + `@testing-library/react` for the heavier pages (Inbox filters, CustomerPanel optimistic updates, Settings render-by-type).
- **End-to-end** — `playwright` against `npm run dev` + Docker infra. Most valuable for catching socket regressions (live chat updates) and the QR flow.

A reasonable CI shape: GitHub Actions matrix on Node 20, runs `npm install`, `npx prisma migrate deploy` against a sidecar Postgres+pgvector service, then `npm test` for backend + frontend. Block PRs to `main` on green.

---

## See also

- [SETUP.md](SETUP.md) — first-time VPS provisioning
- [OPS.md](OPS.md) — day-to-day operations runbook
- [AI_PROVIDERS.md](AI_PROVIDERS.md) — OpenAI vs Gemini setup, getting API keys, switching providers
- [README.md](README.md) — project overview + status
