# SalesAutomation — WhatsApp CRM Platform

Production-ready, KB-grounded WhatsApp CRM. whatsapp-web.js only (no Meta Cloud API). AI replies sourced **only** from uploaded PDF knowledge bases. Max 10 AI replies per session, then mandatory manual handoff. Session reset only on valid campaign re-entry after >7 days inactivity.

## Status

**Project complete — all 10 phases shipped.** See [SETUP.md](SETUP.md) for production deployment on Ubuntu 22 + Cloudflare Pages, and [OPS.md](OPS.md) for the day-to-day runbook.

Future-work designs (intentionally not built):
- [FUTURE_AI_DEMO_INTENT.md](FUTURE_AI_DEMO_INTENT.md) — AI-initiated demo offers (classifier + slot-finder + customer-reply parsing). ~5 dev days when you're ready.

What's in:
- **Phase 0–1** Foundations + auth + RBAC
- **Phase 2** WhatsApp worker (whatsapp-web.js, QR, Redis pub/sub, Socket.io status)
- **Phase 3** Campaigns CRUD + session engine (7d reset, 24h resume, processing locks)
- **Phase 4** KB pipeline (PDF → BullMQ → chunker → embeddings → pgvector HNSW, lightweight versioning)
- **Phase 5** BullMQ AI pipeline (incoming → kb-search → outgoing, hybrid retrieval with RRF, strict KB-only generation, 15s timeout, confidence gate, A1 warmup mode, A2 manual override, A3 dedup, R8 outbound rate limit)
- **AI provider abstraction** (OpenAI + Gemini, runtime-switchable, per-(provider, model) chunk stamps, bulk re-embed)
- **Phase 6** Manual queue UI, agent reply panel with auto-MANUAL, mode/state controls including PAUSED
- **Phase 7** Admin dashboard core (inbox, customer panel with tags + notes, templates editor, Bull-Board, global AI switch)
- **Phase 8** Settings engine (AES-256-GCM encryption, audit log, 30s read cache, traffic-light health dashboard)
- **Phase 9** Analytics rollups, scheduler-jobs queue (R9 watchdog + nightly backups), MS Teams demo booking (agent-initiated; Azure AD setup in [SETUP.md §15](SETUP.md#15-demo-booking-microsoft-teams--optional))
- **Phase 10** helmet + rate limit + compression + request-id, polished PM2 ecosystem, Cloudflare Pages config, [SETUP.md](SETUP.md), [OPS.md](OPS.md)

### Behavioural contract (auto-MANUAL trigger)

The **only** thing that auto-flips a session to MANUAL is hitting the
`ai.max_replies_per_session` cap (default 10). Low confidence, no KB groups
on the campaign, global AI off, generation timeout, and provider auth
errors all route through the FALLBACK template (and count toward the cap),
keeping the session in AI mode. Admin override (Take over / Hand back to AI
in the chat UI) remains the only manual path. AI never proactively offers a
demo — demo booking is agent-initiated via the **Book demo** button in the
chat toolbar; see [OPS.md](OPS.md#book-a-demo-for-a-customer).

See [the implementation plan](C:\Users\Admin\.claude\plans\build-a-production-ready-saas-capable-cosmic-babbage.md) for the full roadmap.

## Local development (Windows)

### Prerequisites
- Node.js 20+
- Docker Desktop (for PostgreSQL+pgvector and Redis)
- An OpenAI API key

### One-time setup
```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env: paste your OPENAI_API_KEY, generate JWT_SECRET and ENCRYPTION_KEY
#   openssl rand -hex 64   → JWT_SECRET
#   openssl rand -hex 32   → ENCRYPTION_KEY

# 2. Start infra
docker compose up -d

# 3. Backend
cd backend
npm install
npx prisma migrate dev --name init
npm run seed
# (note the printed admin password — shown once)

# 4. Frontend
cd ../frontend
npm install
```

### Run
```bash
# terminal 1 — API
cd backend && npm run dev
# terminal 2 — wa-worker (Chromium starts; first run downloads ~150MB)
cd backend && npm run dev:wa
# terminal 3 — worker (BullMQ pdf-processing + future queues)
cd backend && npm run dev:worker
# terminal 4 — frontend
cd frontend && npm run dev
```

- API: http://localhost:4000  (health: http://localhost:4000/health)
- Frontend: http://localhost:5173

Log in with `admin@local.test` and the password printed by the seed script. Open the WhatsApp tile on the dashboard, scan the QR with Settings → Linked Devices → Link a device.

## Repo layout
```
.
├── docker-compose.yml          # postgres+pgvector, redis
├── .env.example
├── backend\                    # Node + Express + Prisma + BullMQ + Socket.io
│   ├── prisma\schema.prisma    # full schema (all tables, all phases)
│   └── src\
│       ├── config, shared, utils
│       ├── modules\            # auth, campaigns, sessions, kb, chat, ...
│       └── workers\            # whatsapp.worker, queue.worker, scheduler.worker
└── frontend\                   # React + Vite + Tailwind + Zustand
```

## Architecture (one-liner)

API server (Express + Socket.io) ↔ Redis pub/sub ↔ wa-worker (whatsapp-web.js LocalAuth in its own PM2 process) ↔ BullMQ workers + scheduler (3rd PM2 process running incoming-messages, kb-search, outgoing-messages, scheduler-jobs queues). PostgreSQL with pgvector holds everything — chats, sessions, messages, KB metadata, and embeddings. Socket.io is used **only** for live chat messages and QR updates; queue/analytics dashboards use REST polling.

## License

Proprietary.
