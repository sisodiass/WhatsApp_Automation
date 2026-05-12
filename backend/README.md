# Backend

This is the Node + Express + Prisma + BullMQ + Socket.io backend for the
SalesAutomation WhatsApp CRM platform.

The canonical project README lives at the repo root:

→ [../README.md](../README.md)

## Quick local start (from repo root)

```bash
docker compose up -d
cd backend
npm install
npx prisma migrate dev --name init
npm run seed                       # NOTE the printed admin password!

# Three terminals:
npm run dev                        # API on :4000
npm run dev:wa                     # whatsapp-web.js worker
npm run dev:worker                 # BullMQ workers + scheduler
```

Log in at http://localhost:5173 with `admin@local.test` and the seeded
password.

## Where things live

```
backend/
├── prisma/
│   ├── schema.prisma              # full schema, all phases
│   └── seed.js                    # tenant + super admin + templates + test campaign
├── ecosystem.config.cjs            # 3-process PM2 layout
└── src/
    ├── index.js                   # api process entrypoint
    ├── config/                    # env + runtime settings cache
    ├── shared/                    # logger, prisma, redis, socket, errors, hardening
    ├── modules/                   # auth, campaigns, sessions, kb, chat, ai,
    │                              # settings, teams, analytics, ...
    ├── workers/
    │   ├── whatsapp.worker.js     # wa-worker process
    │   └── queues/                # incoming, kb-search, outgoing, pdf, scheduler
    └── utils/                     # crypto, time
```

## Documentation (all at repo root)

- [../README.md](../README.md) — project overview, status, quick start
- [../SETUP.md](../SETUP.md) — first-time VPS provisioning, includes
  **§15 Demo booking (Microsoft Teams)** with the full Azure AD setup
- [../OPS.md](../OPS.md) — day-to-day runbook (includes "Book a demo for a
  customer" scenario and the auto-MANUAL contract)
- [../TEST_AND_DEPLOY.md](../TEST_AND_DEPLOY.md) — local smoke + deploy workflow
- [../AI_PROVIDERS.md](../AI_PROVIDERS.md) — OpenAI vs Gemini setup + switching

## License

Proprietary.
