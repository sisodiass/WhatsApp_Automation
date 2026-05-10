# SETUP

The canonical production setup guide lives at the repo root:

→ [../SETUP.md](../SETUP.md)

This stub exists so people who land in `backend/` first don't miss it. Don't
edit this file — update `SETUP.md` at the repo root and this pointer will
keep working.

Topics covered in the canonical guide:

- Ubuntu 22 system packages, Node 20, PM2, Docker
- `.env` keys (JWT, encryption, OpenAI/Gemini)
- Bringing up Postgres+pgvector and Redis via `docker compose`
- Backend bootstrap (migrations, seed, super-admin password)
- PM2 ecosystem (3 processes: api, wa-worker, worker)
- Nginx reverse proxy + Let's Encrypt
- Cloudflare Pages frontend deploy
- WhatsApp QR setup
- Settings UI walk-through (AI, Session, WhatsApp warmup, Manual Queue,
  Microsoft Teams, Templates)
- **§15 Demo booking (Microsoft Teams)** — Azure AD app registration,
  application access policy via PowerShell, customising the
  `DEMO_CONFIRMATION` template, end-to-end verification
- Troubleshooting (low-confidence FALLBACK behaviour, Bull-Board token cookie,
  re-embedding after a provider switch)
- Backups + upgrades

See also at the repo root:
- [../OPS.md](../OPS.md) — day-to-day runbook
- [../TEST_AND_DEPLOY.md](../TEST_AND_DEPLOY.md) — local smoke + deploy workflow
- [../AI_PROVIDERS.md](../AI_PROVIDERS.md) — OpenAI vs Gemini setup + switching
- [../README.md](../README.md) — project overview
