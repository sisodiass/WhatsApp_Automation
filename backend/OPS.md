# OPS

The canonical day-to-day operations runbook lives at the repo root:

→ [../OPS.md](../OPS.md)

This stub exists so people who land in `backend/` first don't miss it. Don't
edit this file — update `OPS.md` at the repo root and this pointer will keep
working.

Scenarios covered in the canonical runbook:

- Process management (PM2 `status`, `logs`, `reload`, `restart`)
- WhatsApp logged out / linked-device limit
- KB stops returning answers — distinguishing embeddings out of sync vs
  threshold too tight vs pgvector down vs provider auth (the FALLBACK
  template now covers all of these without flipping MANUAL)
- Worker queue backed up (Bull-Board access via the sidebar tile, not bare URL)
- Customer's session is stuck (and a reminder that the 10-cap is the only
  auto-MANUAL trigger)
- Disable AI globally for an hour
- **Book a demo for a customer** — agent-initiated flow + edge cases (Teams
  not configured, Graph 403, why the AI never proactively offers a demo)
- Audit who changed a setting
- Restart everything cleanly
- Backups (daily schedule, manual trigger, restore)
- Health monitoring (`/api/health/full`)
- Rotating secrets (JWT, encryption key, OpenAI/Gemini key)
- Scaling notes for when 4 GB stops being enough

See also at the repo root:
- [../SETUP.md](../SETUP.md) — first-time VPS provisioning (includes §15 Demo
  booking with the full Azure AD walkthrough)
- [../TEST_AND_DEPLOY.md](../TEST_AND_DEPLOY.md) — local smoke + deploy workflow
- [../AI_PROVIDERS.md](../AI_PROVIDERS.md) — OpenAI vs Gemini setup + switching
- [../README.md](../README.md) — project overview
