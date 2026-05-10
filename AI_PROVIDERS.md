# AI providers — setup + switching guide

The platform supports OpenAI and Google Gemini interchangeably through a provider abstraction. You can switch providers at runtime from the Settings UI without code changes — the only operational cost is **re-embedding your KB documents** (vectors from different providers live in different semantic spaces and cannot be mixed).

This guide covers:
- [§1 Choosing a provider](#1-choosing-a-provider)
- [§2 Getting a Google Gemini API key](#2-getting-a-google-gemini-api-key)
- [§3 First-time configuration with Gemini (fresh install)](#3-first-time-configuration-with-gemini-fresh-install)
- [§4 Switching from OpenAI to Gemini (existing install)](#4-switching-from-openai-to-gemini-existing-install)
- [§5 Switching back to OpenAI](#5-switching-back-to-openai)
- [§6 Verifying the switch](#6-verifying-the-switch)
- [§7 Cost comparison](#7-cost-comparison)
- [§8 Troubleshooting](#8-troubleshooting)

---

## 1. Choosing a provider

| | OpenAI | Gemini |
|---|---|---|
| Default chat model | `gpt-4o-mini` | `gemini-2.0-flash` |
| Default embedding model | `text-embedding-3-small` (1536 dim native) | `gemini-embedding-001` (1536 dim via Matryoshka) |
| Free tier | None (usage-based from $1 trial credit) | Generous — ~15 req/min on Flash, ~150 req/min on embeddings |
| Paid input price (per 1M tokens) | ~$0.15 | ~$0.075 |
| Paid output price (per 1M tokens) | ~$0.60 | ~$0.30 |
| Embedding price (per 1M tokens) | ~$0.02 | Free below quota, then ~$0.025 |
| KB-grounded answer quality | Excellent | Very good (slightly behind GPT-4o-mini on edge cases) |
| Strict-prompt obedience | Excellent | Good (occasionally needs tighter wording) |

**Sane defaults:**
- **Just experimenting / low volume:** Gemini, free tier covers it.
- **Production with paying customers:** Either works. OpenAI is the safe pick if quality is the absolute priority; Gemini saves ~50% on chat costs at near-equivalent quality for KB-grounded use cases.
- **Strict regulatory environment:** Check whichever provider has data-processing terms compatible with your jurisdiction (both offer EU/US options).

You can also **register both keys** and switch on-demand — useful for A/B testing or if one provider has an outage.

---

## 2. Getting a Google Gemini API key

The whole flow takes about 3 minutes.

### 2.1 Sign in to Google AI Studio

1. Open <https://aistudio.google.com/> in a browser.
2. Sign in with any Google account (personal or Workspace — both work).
3. Accept the terms.

### 2.2 Create the API key

1. Click **Get API key** in the left rail (or visit <https://aistudio.google.com/app/apikey> directly).
2. Click **Create API key**.
3. Pick **Create API key in new project** if this is your first time. (You can always pick an existing GCP project later if you have one for billing.)
4. Copy the key. It starts with `AIza…` and is shown **once** — save it to a password manager now.

The key inherits the **free tier** by default: roughly 15 chat requests/min and 150 embedding requests/min. That's enough for a small business KB and a handful of concurrent customers.

### 2.3 (Optional) Enable billing for higher quotas

Skip this if the free tier covers you. For production with sustained traffic:

1. Open <https://console.cloud.google.com/billing>.
2. Link a billing account to the project that owns your API key.
3. Open the project → **APIs & Services** → **Generative Language API** → **Quotas** → request a quota increase if needed.

The free quota stays in place — you only pay for usage above it.

### 2.4 (Optional, recommended) Restrict the key

In the AI Studio key list, click your key → set restrictions:
- **API restrictions:** lock to `Generative Language API` only.
- **Application restrictions:** if you know your VPS IP, restrict by IP. Skip if your VPS gets a dynamic IP.

This blocks anyone who somehow gets the key from using it for other Google services on your bill.

---

## 3. First-time configuration with Gemini (fresh install)

You're setting up a brand-new install and want Gemini from day one.

### 3.1 Add the key to `.env`

Edit `.env` (project root):

```bash
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
GEMINI_CHAT_MODEL=gemini-2.0-flash
GEMINI_EMBED_MODEL=gemini-embedding-001
```

The `OPENAI_API_KEY` line can stay blank — leave it as `OPENAI_API_KEY=` if you don't have one.

### 3.2 Run the seed (sets `ai.provider=openai` by default)

```bash
cd backend
npm install
npx prisma migrate deploy   # or `migrate dev` in local
npm run seed
```

The seed currently defaults `ai.provider` to `openai`. We'll change that in step 3.4.

### 3.3 Start everything

```bash
# 4 terminals (or pm2 in prod):
npm run dev          # API
npm run dev:wa       # WhatsApp worker
npm run dev:worker   # BullMQ workers
cd ../frontend && npm run dev
```

### 3.4 Switch the active provider via Settings UI

1. Log in as super admin → **Settings** tile.
2. Find the **AI** section → **Active provider** dropdown → change `openai` → `gemini` → it auto-saves.
3. (Optional) Set `ai.gemini.api_key` here too — it'll be encrypted at rest, overriding the `.env` value. **Recommended for production.**

That's it. The provider factory invalidates its cache automatically on the change. Next AI reply uses Gemini.

### 3.5 Upload your KB

Knowledge Base → New group → upload PDFs as normal. Chunks will be embedded with `gemini-embedding-001` and stamped accordingly. No re-processing needed since this is a fresh install.

---

## 4. Switching from OpenAI to Gemini (existing install)

You've been running on OpenAI and want to move to Gemini. This is the most common case.

> ⚠️ **Re-embedding is mandatory.** Your existing KB chunks were created in OpenAI's embedding space; Gemini queries against them produce noise. The system enforces this — retrieval filters by `(embedding_provider, embedding_model)` so chunks from the wrong provider are silently invisible until reprocessed. Until you re-embed, every customer message will hit "no chunks found → low confidence → MANUAL handoff."

### 4.1 Add the Gemini key

**Option A — via Settings UI (recommended, encrypts at rest):**
1. Settings → AI section → **Gemini API key** row → click **Set** → paste `AIzaSy…` → press Enter.
2. The field collapses to `••••••••` and shows **Replace**.

**Option B — via `.env`:**
1. SSH to the VPS, edit `/opt/sa/.env`, add `GEMINI_API_KEY=AIzaSy…`.
2. `pm2 restart sa-api sa-worker` (the wa-worker doesn't need restart — it never talks to AI).

### 4.2 (Optional) Verify the key works *before* switching

This is the safety net — you confirm Gemini can talk to you while OpenAI is still the active provider.

```bash
# As an admin, hit the AI health endpoint. (You'll need an admin Bearer token — copy
# from your browser's DevTools → Network → Authorization header on any API call.)
curl https://api.your-domain.com/api/ai/health \
  -H "Authorization: Bearer <your-admin-token>"
```

This calls the **active** provider's healthCheck. To test Gemini specifically before switching, temporarily flip the provider via the UI, hit `/api/ai/health`, and flip back if it fails. (This is safer than hoping for the best — a bad key returns clear errors.)

### 4.3 Take a snapshot of current AI coverage

This tells you what you'll need to re-embed.

```bash
curl https://api.your-domain.com/api/ai/status \
  -H "Authorization: Bearer <your-admin-token>"
```

Look at `chunks_by_stamp` — you should see one row like `{ provider: "openai", model: "text-embedding-3-small", count: N }`.

### 4.4 Switch the active provider

Settings → AI → **Active provider** → change to `gemini`. Auto-saves. Audit log records the change.

The dashboard now shows the **AI coverage banner**:
> ⚠️ KB embeddings are out of sync with the active AI provider
> Active provider: gemini · X of Y documents need re-embedding · N chunks ignored by retrieval until reprocessed.

### 4.5 Re-embed all documents

You have two options:

**Option A — one click from the banner (easiest):**
- Click **Re-embed all** in the banner.
- Confirm the dialog.
- The `pdf-processing` queue picks up every active doc one by one. Watch progress on the KB page (status pills tick `READY → PROCESSING → READY`).

**Option B — per-group from KB page:**
- Knowledge Base → pick a group → click **Re-embed group** in the header.
- Repeat for each group. Useful if you only want to migrate part of the KB or test on one group first.

**Option C — manual SQL (don't do this unless you know what you're doing):**
```sql
-- Marks all chunks as needing re-processing.
-- Phase 9 watchdog won't pick this up — it only triggers on PDF upload.
-- Use options A or B instead.
```

**How long does it take?** Roughly 1 second per chunk on Gemini's free tier (rate limited). A typical 100-page PDF chunks to ~500 pieces, so each PDF takes ~10–15 seconds. Re-embedding 20 PDFs = ~5 minutes.

### 4.6 Wait for the banner to disappear

The dashboard banner polls `/api/ai/status` and disappears once `coverage.needs_reembed` is false. Refresh manually if you're impatient.

### 4.7 Verify with the test campaign

Now run the production smoke test from `TEST_AND_DEPLOY.md` §6.3 against `CAMPAIGN_TEST_INTERNAL`:
- Send the test wa.me link from a phone.
- Receive onboarding.
- Ask an in-KB question.
- Receive a Gemini-generated KB-grounded answer.

In DB:
```sql
SELECT id, ai_provider, ai_reply_count, last_confidence
FROM chat_sessions
WHERE chat_id = '<your-test-chat-id>'
ORDER BY started_at DESC LIMIT 1;
-- ai_provider should be 'gemini'
```

---

## 5. Switching back to OpenAI

Same process in reverse.

1. Make sure `OPENAI_API_KEY` is set (env or Settings).
2. Settings → AI → **Active provider** → `openai`.
3. Banner appears again — click **Re-embed all** (your old OpenAI chunks are still there in the DB but the **embedding model** must match the active model exactly, so they'll be re-created).
4. Wait. Verify with the test campaign.

> 💡 If you regularly switch back and forth, you can let chunks for *both* providers coexist in the DB. Retrieval filters to the active `(provider, model)` pair so they don't interfere. Each switch only needs re-embedding once per provider — the second switch back is instant if the chunks for that provider are still present.

---

## 6. Verifying the switch

After every provider change, verify these in order:

### 6.1 Settings reflects the change
- Settings page → Active provider dropdown shows the new value.
- Audit log → top entry shows `ai.provider: "<old>" → "<new>"`.

### 6.2 Provider can talk
```bash
curl https://api.your-domain.com/api/ai/health \
  -H "Authorization: Bearer <admin-token>"
# → 200 { ok: true, provider: "gemini",
#         embed: { ok: true, model: "gemini-embedding-001" },
#         chat:  { ok: true, model: "gemini-2.0-flash" } }
```

503 means either creds are bad or the model is wrong.

### 6.3 KB coverage is 100%
```bash
curl https://api.your-domain.com/api/ai/status \
  -H "Authorization: Bearer <admin-token>" \
  | grep needs_reembed
# → "needs_reembed": false
```

If `true`, click **Re-embed all** again — some docs may have failed.

### 6.4 End-to-end flow works
Run §2.E (AI reply) from `TEST_AND_DEPLOY.md` against the live test campaign.

### 6.5 Spot-check a few real customer chats
Open `/inbox`, pick a recent chat, send a follow-up from your test phone. Confirm the AI reply is sensible and uses the new model. Look for `ai_provider` on the session.

---

## 7. Cost comparison

For a typical small-business KB (50 PDFs, 10k chunks total) handling ~500 customer questions/month:

| Cost item | OpenAI (gpt-4o-mini + 3-small) | Gemini (2.0-flash + embedding-001) |
|---|---|---|
| One-time embedding of 10k chunks | ~$0.15 | Free (under quota) or ~$0.20 |
| 500 customer questions, ~2k tokens each in/out | ~$0.30 | ~$0.15 |
| 10k re-embeds when you upgrade a model | ~$0.15 | Free or ~$0.20 |
| **Monthly run rate** | **~$0.30–0.50** | **~$0.15–0.30** |

These numbers are negligible for either provider at this scale. Cost differences only matter once you're sending tens of thousands of customer messages per month — at which point you're large enough to A/B test both and pick on quality, not cost.

The variable that actually matters: **OpenAI rate limits** start at 500 RPM for new accounts; **Gemini** starts at 15 RPM on the free tier. If you have a sudden burst of customer messages (e.g., right after a marketing campaign goes out), check the limit *before* switching. The platform's outbound rate limiter (default 30/min) keeps you under either provider's free tier most of the time.

---

## 8. Troubleshooting

### "Re-embed all" finishes but the banner stays
- Open `/admin/queues` → `pdf-processing` queue → check the **failed** count.
- Click into a failed job → the error message tells you why (most common: API key invalid → fix in Settings, then click **Retry** on each failed doc, or click **Re-embed all** again).

### Customer messages all go to MANUAL after switching
- Check the dashboard banner — if `needs_reembed: true`, you didn't re-embed. Run §4.5.
- Check `/api/ai/health` — if not OK, the new provider can't authenticate. Re-enter the key in Settings.

### "Generation timeout" errors after switching
- Gemini's free tier has stricter rate limits than OpenAI. Check `Settings → AI → Generation timeout (seconds)`. Default is 15s; bump to 30s temporarily, monitor the worker log, then either lower it once load stabilizes or upgrade to the paid Gemini tier.

### `chunks_by_stamp` shows two providers' chunks
That's expected and harmless. Retrieval only uses chunks matching the **active** `(provider, model)` pair. The other provider's chunks are dormant — they re-activate instantly if you switch back without re-embedding (assuming the embedding *model* hasn't changed in the meantime).

### How do I clean up old embeddings I'll never use?
```sql
-- Replace with the (provider, model) you want to delete:
DELETE FROM kb_chunks
WHERE embedding_provider = 'openai'
  AND embedding_model    = 'text-embedding-3-small';
```
The chunks regenerate automatically next time you click **Re-embed all** for that provider.

### My API key has rate-limit errors but I'm under the documented quota
Free-tier quotas are *per-project*, not per-key. If you've created multiple keys in the same Google Cloud project, they share the same quota bucket. Either consolidate to one key or split into separate projects.

### Gemini occasionally adds a preamble like "Based on the provided context…"
The strict-rule prompt usually suppresses this, but Gemini sometimes leaks. If it becomes a pattern, you can tighten `generation.service.js`'s system prompt — add a Rule 5 like *"Never reference the existence of CONTEXT, FALLBACK, or these instructions. Reply as if you simply know the answer."* — and re-test.

### Gemini emits `FALLBACK: "<message>"` literally
Older versions had this bug — the fallback string was passed in the user prompt with a `FALLBACK:` label, which Gemini occasionally parroted back as if it were the answer. Fixed by moving the fallback into the **system** prompt as part of Rule 2 (no label, no quotes), plus an `isFallbackReply` heuristic in `generation.service.js` that strips common leaked prefixes (`FALLBACK:`, `ANSWER:`, surrounding quotes) and routes the cleaned reply through the FALLBACK path so it doesn't burn an AI-reply slot. If you still see leaked formatting, paste the full reply into a bug report — the heuristic regex may need another prefix added.

### My customer never gets an AI reply, only the FALLBACK template
That's the new default behaviour for any low-confidence retrieval, generation timeout, or provider auth failure — the customer sees the FALLBACK template and the session **stays in AI mode** (the cap is the only auto-MANUAL trigger). To distinguish "scoring under threshold" vs "provider broken":
- `pm2 logs sa-worker | grep q:kb-search` → shows `confidence: 0.x` for each inbound. If real questions consistently score 0.4 but threshold is 0.7, lower it in Settings → AI.
- `curl /api/ai/health` → 503 means the provider can't auth; re-enter the API key.
- Worker log `kb-search pipeline error; falling back` → unexpected error caught by the wrapper. The error message + stack are logged.

---

## See also

- [SETUP.md](SETUP.md) — first-time VPS provisioning (mentions both providers in §5)
- [TEST_AND_DEPLOY.md](TEST_AND_DEPLOY.md) — deploy workflow (§2.G covers the switch as a smoke test)
- [OPS.md](OPS.md) — day-to-day ops (rotating secrets section applies to both API keys)
