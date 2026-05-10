# AI-initiated demo intent detection — design doc

**Status:** Not implemented. Intentionally descoped from v1.
**Audience:** Whoever picks this up later (likely the same operator + contractor pair).
**Estimated effort:** ~4 dev days end-to-end, including QA.
**Pre-requisites:** Microsoft Graph creds wired (SETUP.md §15), real chat data from 2–4 weeks of agent-initiated bookings.

---

## 1. Why this is descoped today

Three real reasons it isn't built yet — re-read these before starting work, because each is a sign you might be about to ship something annoying:

1. **Cost: an extra LLM call per inbound.** Cheap in dollars, but doubles the kb-search worker's quota footprint. Matters on free tiers with strict per-minute caps (Gemini free = 15 RPM).
2. **Calendar conflict logic is fiddly.** Time-zones, organizer availability vs customer's TZ, lead time, business hours, holidays. The `slot-finder` is the part most likely to ship buggy.
3. **Risk of being annoying.** A classifier that fires too eagerly will offer demos in 30%+ of conversations, which destroys the UX. You only know the right threshold by running it on real chat data — which v1 doesn't have.

**Pre-flight check (do before writing code):**
- [ ] At least 50 chats where an agent clicked **Book demo** (the v1 path). Pull the customer's last 3 messages before the booking — that's your eval set.
- [ ] At least 100 chats where the agent did NOT book a demo. Same — customer's last 3 messages — that's your negative set.
- [ ] Run the classifier prompt manually (paste into ChatGPT / AI Studio) against both sets. Tune the threshold so you capture ≥70% of the positives without tripping >10% of the negatives. **If you can't hit those numbers, do not ship.** The classifier needs more prompt work or a different model.

---

## 2. What "AI-initiated" means here

Today the AI is a strict KB question-answerer. It cannot say "want me to set up a call?" — the system prompt in `generation.service.js` forbids anything not in the CONTEXT.

The new feature does NOT change that prompt. Instead, it runs a **parallel lightweight classifier** on the customer's last few messages. If demo intent is detected with high confidence:

1. The bot appends a soft offer to the normal KB reply (or sends a follow-up message a few seconds later).
2. The offer presents 2–3 concrete time slots already checked against the organizer's calendar.
3. The customer replies with a number; the existing `bookDemo` service from v1 handles the rest.

The customer never gets booked without confirming. The classifier just decides *when to ask* and *what to suggest*.

---

## 3. Architecture overview

```
incoming-messages
       |
       +---> kb-search (existing) --------> outgoing AI reply
       |
       +---> demo-intent (NEW)
                |
                +-- intent != "demo"  -> no-op
                |
                +-- intent == "demo" -> slot-finder (NEW)
                                            |
                                            +-> Graph: getSchedule
                                            +-> writes proposed_demo_offer
                                            +-> augments outgoing OR queues follow-up
```

Two new BullMQ workers, two new tables, ~10 new settings keys, one new template (`DEMO_OFFER`), one new branch in the existing incoming.worker.

---

## 4. Data model changes

### 4.1 New table: `proposed_demo_offers`

```prisma
model ProposedDemoOffer {
  id               String   @id @default(cuid())
  tenantId         String   @map("tenant_id")
  chatId           String   @map("chat_id")
  sessionId        String   @map("session_id")
  triggeredByMsgId String   @map("triggered_by_msg_id")  // the inbound that fired the classifier
  offerMsgId       String?  @map("offer_msg_id")          // the OUT message that presented the slots
  slots            Json     // [{ start, end, label }]
  intentConfidence Float    @map("intent_confidence")
  state            OfferState @default(PROPOSED)
  acceptedSlotIdx  Int?     @map("accepted_slot_idx")
  expiresAt        DateTime @map("expires_at")           // 24h from creation
  createdAt        DateTime @default(now()) @map("created_at")
  resolvedAt       DateTime? @map("resolved_at")
  bookingId        String?  @map("booking_id")            // FK to demo_bookings once accepted

  tenant  Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  chat    Chat         @relation(fields: [chatId], references: [id], onDelete: Cascade)
  session ChatSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  booking DemoBooking? @relation(fields: [bookingId], references: [id], onDelete: SetNull)

  @@index([sessionId, state])
  @@index([expiresAt])  // for the expiry sweep
  @@map("proposed_demo_offers")
}

enum OfferState {
  PROPOSED
  ACCEPTED
  DECLINED
  EXPIRED
  RESCHEDULED   // customer asked for a different time -> escalated to MANUAL
}
```

### 4.2 New column on `chat_sessions`

```prisma
demoOffersCount Int @default(0) @map("demo_offers_count")
```

Used to enforce `demo.max_offers_per_session` (default 1). Bump on every PROPOSED row creation.

### 4.3 Migration

Single `prisma migrate dev --name demo_intent_detection`. Non-destructive. Safe to deploy without data backfill.

---

## 5. New settings keys

Add to `seed.js` defaults AND to the `WRITABLE` allowlist in `settings.controller.js`:

| Key | Type | Default | Purpose |
|---|---|---|---|
| `demo.intent_detection_enabled` | bool | **false** | Master kill switch. Default off so existing deploys keep current behaviour. |
| `demo.intent_threshold` | number | 0.75 | Min classifier confidence to fire an offer. |
| `demo.classifier_model` | string | `null` | Override for classifier model. If null, uses the active provider's chat model. |
| `demo.business_hours_start` | string | `"09:00"` | Local-time start of bookable window (HH:MM). |
| `demo.business_hours_end` | string | `"17:00"` | Local-time end. |
| `demo.business_days` | string | `"Mon,Tue,Wed,Thu,Fri"` | Comma-separated. Add `Sat`/`Sun` if your business runs weekends. |
| `demo.timezone` | string | `"Asia/Kolkata"` | IANA TZ name. |
| `demo.slot_duration_minutes` | number | 30 | Length of each proposed demo. |
| `demo.min_lead_time_hours` | number | 2 | Earliest slot is this far from now. Prevents surprise instant calls. |
| `demo.max_lead_time_days` | number | 5 | Don't propose slots beyond this horizon. |
| `demo.slots_per_offer` | number | 3 | How many options to show the customer (cap at 5). |
| `demo.offer_expiry_hours` | number | 24 | After this, the offer expires and the customer's reply (if any) is treated as a normal message. |
| `demo.max_offers_per_session` | number | 1 | Anti-nag. Per session. |

**Add a new group to `Settings.jsx`:**
```js
{ id: "demo", label: "Demo intent (AI)", help: "AI-initiated demo offers — classifier, calendar window, slot rules." }
```

---

## 6. The `demo-intent` worker

### 6.1 Trigger

Currently `incoming.worker` enqueues `kb-search`. After this feature, it ALSO enqueues `demo-intent` with the same `messageId`, in parallel:

```js
// incoming.worker.js, after the existing kb-search enqueue:
const demoEnabled = await getSetting(tenantId, "demo.intent_detection_enabled", false);
if (demoEnabled && session.demoOffersCount < maxOffers) {
  await enqueueDemoIntent(messageId);
}
```

### 6.2 Classifier prompt

System prompt, locked in code (provider-agnostic, like `generation.service.js`):

```
You classify whether a customer's recent WhatsApp messages signal a desire
to schedule a live demo, sales call, or product walkthrough.

Return JSON only, no preamble, no markdown fences:

{
  "intent": "demo" | "info" | "support" | "other",
  "confidence": 0.0,
  "preferred_window": "morning" | "afternoon" | "evening" | "any" | null,
  "preferred_day": "today" | "tomorrow" | "this_week" | "next_week" | null,
  "explicit_request": true | false
}

Rules:
- "demo" only if the customer is asking for synchronous human time
  (call, demo, walkthrough, meeting). Asking for product information,
  pricing, or features is NOT demo intent — that's "info".
- "explicit_request" is true only if they used words like "call",
  "demo", "meeting", "schedule", "book", "talk to someone".
  Vague interest like "tell me more" is false.
- "preferred_*" fields: only fill if the customer mentioned a time
  preference. Otherwise null.
- Be conservative. When unsure, use lower confidence.
```

User prompt: just the customer's last 3 inbound messages, newest last, prefixed `[N min ago]` so the model has temporal context.

### 6.3 Provider call

Uses the existing AI provider abstraction — no vendor SDK imports. Add a new method to the provider interface:

```js
// providers/openai.js, providers/gemini.js
async classifyJson({ systemPrompt, userPrompt, schema, timeoutMs }) {
  // OpenAI: response_format: { type: "json_object" } (or json_schema for stricter)
  // Gemini: responseMimeType: "application/json" + responseSchema
}
```

Return shape: parsed JSON or throws on schema mismatch / timeout.

Timeout: hard 8s (cheaper than the 15s generation timeout because the prompt is tiny). Setting key: `demo.classifier_timeout_seconds`.

### 6.4 Decision logic

```js
const result = await provider.classifyJson({...});
if (result.intent !== "demo") return { skipped: "not_demo" };
if (result.confidence < threshold) return { skipped: "low_confidence" };

// Hand off to slot-finder.
await enqueueSlotFinder({ messageId, intent: result });
```

---

## 7. The `slot-finder` worker

### 7.1 Microsoft Graph call

```
POST /v1.0/users/{organizer_user_id}/calendar/getSchedule
{
  "schedules": ["{organizer_user_id}"],
  "startTime": { "dateTime": "<now>", "timeZone": "<demo.timezone>" },
  "endTime":   { "dateTime": "<now + max_lead_time_days>", "timeZone": "<demo.timezone>" },
  "availabilityViewInterval": <slot_duration_minutes>
}
```

Returns an `availabilityView` string like `"002200120000…"` where each char is a 30-min interval (`0`=free, `2`=busy, `1`=tentative, etc.).

### 7.2 Slot selection

```js
function pickSlots(availabilityView, settings, intentHint) {
  // 1. Decode the string into [{start, end, free}] intervals
  // 2. Filter: free === true, within business hours + business days, >= min_lead_time_hours from now
  // 3. Apply preferred_day / preferred_window from intentHint as a *boost*, not a hard filter
  //    (avoid empty results when the customer's preference doesn't match availability)
  // 4. Pick top N by (preference_match desc, start asc)
  // 5. Format labels: "Tomorrow 10:30am", "Thu 2:00pm" — relative to demo.timezone
}
```

Edge cases worth covering in unit tests:
- Customer says "tomorrow" but tomorrow is fully booked -> propose day after, don't return zero.
- Customer says "tomorrow" but tomorrow is a weekend / outside `business_days` -> skip to next business day, mention this in the offer ("Tomorrow is a weekend — here are some options for Monday").
- Organizer's TZ ≠ customer's TZ — currently we don't know the customer's TZ. **Decision: always present in `demo.timezone` (the business's TZ) and include the TZ name in the message.** Don't try to infer customer TZ from phone country code; it's wrong too often.
- All slots in the next 5 days are busy — fall back to MANUAL escalation with a friendly "let me get someone to find a time that works" message.

### 7.3 Persistence

```js
const offer = await prisma.proposedDemoOffer.create({
  data: {
    tenantId, chatId, sessionId,
    triggeredByMsgId: messageId,
    slots,                // [{ start, end, label }]
    intentConfidence: intent.confidence,
    expiresAt: new Date(Date.now() + offerExpiryHours * 3600_000),
  },
});
await prisma.chatSession.update({
  where: { id: sessionId },
  data: { demoOffersCount: { increment: 1 } },
});
```

### 7.4 Reply augmentation

Two modes — pick one based on how fast the classifier returns relative to kb-search:

**Mode A — append to KB reply** (preferred when classifier finishes first):

The kb-search worker, right before persisting the AI reply, checks for a fresh PROPOSED offer for this session. If found:

```js
const offerSuffix = await renderTemplate(tenantId, "DEMO_OFFER", {
  slots_list: offer.slots.map((s, i) => `${i + 1}. ${s.label}`).join("\n"),
});
replyText = `${replyText}\n\n${offerSuffix}`;
```

Update the offer row with `offerMsgId = out.id`.

**Mode B — separate follow-up** (when slot-finder is slower than kb-search):

`slot-finder` enqueues an outbound `source=SYSTEM` message with `delayMs=5000` and the rendered `DEMO_OFFER` template as its body.

**Both modes**: the offer message uses `source=SYSTEM` if standalone (Mode B), or shares the AI message's `source=AI` if appended (Mode A). The `ai_reply_count` accounting stays the same as today.

---

## 8. Customer reply parsing

New branch in `incoming.worker`, runs **before** the kb-search enqueue:

```js
const lastOut = await prisma.message.findFirst({
  where: { sessionId: session.id, direction: "OUT" },
  orderBy: { createdAt: "desc" },
});

const activeOffer = await prisma.proposedDemoOffer.findFirst({
  where: {
    sessionId: session.id,
    state: "PROPOSED",
    expiresAt: { gt: new Date() },
  },
  orderBy: { createdAt: "desc" },
});

if (activeOffer && lastOut?.id === activeOffer.offerMsgId) {
  return await handleOfferReply({ msg, offer: activeOffer });
}
```

### 8.1 Parser

```js
function parseOfferReply(body, slotCount) {
  const m = body.trim().toLowerCase();
  // numeric pick
  if (new RegExp(`^[1-${slotCount}]$`).test(m)) {
    return { kind: "select", index: Number(m) - 1 };
  }
  // verbose pick — "option 2", "the 1st", etc.
  const match = m.match(/(?:option\s*|^|\s)(\d)(?:st|nd|rd|th)?\b/);
  if (match) {
    const idx = Number(match[1]) - 1;
    if (idx >= 0 && idx < slotCount) return { kind: "select", index: idx };
  }
  if (/^(other|different|change|another time|new time)/.test(m)) return { kind: "other" };
  if (/^(no|cancel|not now|skip|nope|maybe later)/.test(m)) return { kind: "decline" };
  return { kind: "unrecognized" };
}
```

### 8.2 Handlers

| Parser result | Action |
|---|---|
| `select` | Call existing `bookDemo({ chatId, scheduledAt: slot.start, durationMinutes, subject: "Demo" })`. Mark offer ACCEPTED, link `bookingId`. The existing `DEMO_CONFIRMATION` template fires — no change needed. |
| `other` | Mark offer RESCHEDULED. Flip session to MANUAL with reason `DEMO_RESCHEDULE_REQUEST`. Push to manual queue with a special badge so the agent knows to use the Book Demo modal with a custom time. |
| `decline` | Mark offer DECLINED. Send a short acknowledgement (`DEMO_DECLINED` template — new, content like "No worries — let me know if anything else comes up"). Continue normal AI flow on the customer's next message. |
| `unrecognized` | Do nothing special — let the message flow into the normal kb-search pipeline. The offer remains PROPOSED until expiry. **This is important** — most "unrecognized" replies are legitimate follow-up questions ("actually, can you tell me more about pricing first?") and should not be treated as demo replies. |

### 8.3 Expiry sweep

Add to `scheduler.worker.js` (the cron worker):

```js
// Every 15 minutes
async function expireStaleOffers() {
  await prisma.proposedDemoOffer.updateMany({
    where: { state: "PROPOSED", expiresAt: { lt: new Date() } },
    data: { state: "EXPIRED", resolvedAt: new Date() },
  });
}
```

---

## 9. New templates

Add to `seed.js` and the Templates UI:

### `DEMO_OFFER`
Default content:
```
If you'd like to see it in action, I can set up a quick {{duration}}-min demo. Reply with the number:

{{slots_list}}

Or reply "other" for a different time, or "no" to skip.
```
Variables: `slots_list`, `duration`, `timezone`.

### `DEMO_DECLINED`
Default content:
```
No worries — let me know if anything else comes up. Happy to keep helping with questions.
```
Variables: none.

### `DEMO_RESCHEDULE_PENDING`
Default content (sent when the customer says "other"):
```
Got it — I'll have someone reach out to find a time that works better for you.
```
Variables: none.

---

## 10. End-to-end conversation example

```
[Customer] Hi, do you guys have an EDR product?
   - kb-search: confidence 0.84 -> AI reply queued
   - demo-intent: intent=info, conf=0.4 -> no offer
[Bot]      Yes, Sansiso EDR uses behavioural sensors and a cloud
           analytics layer. Want details on a specific feature?

[Customer] Sounds good. Can we get on a call to discuss?
   - kb-search: confidence 0.31 (no KB content about scheduling) -> FALLBACK queued
   - demo-intent: intent=demo, conf=0.91, explicit_request=true
       -> slot-finder runs
           -> Graph getSchedule returns availability
           -> picks 3 slots (>2h lead, within business hours)
           -> proposed_demo_offers row created
   - kb-search worker, before persisting FALLBACK, sees fresh offer
     -> replaces FALLBACK with DEMO_OFFER template
[Bot]      I can set up a quick 30-min demo. Reply with the number:
           1. Tomorrow 10:30am
           2. Tomorrow 2:00pm
           3. Thursday 11:00am
           Or reply "other" for a different time, or "no" to skip.

[Customer] 1
   - incoming.worker sees DEMO_OFFER as last OUT, parser returns {kind:"select", index:0}
       -> bookDemo() runs
           -> Graph creates onlineMeeting
           -> demo_bookings row written
           -> proposed_demo_offers row marked ACCEPTED, bookingId linked
           -> DEMO_CONFIRMATION enqueued (source=SYSTEM, no ai_reply_count bump)
[Bot]      Booked! Tomorrow 10:30am-11:00am IST.
           Join: https://teams.microsoft.com/l/meetup-join/...
```

Session stays in AI mode throughout. `ai_reply_count` bumps once for the demo-offer reply (it's `source=AI` in Mode A), `DEMO_CONFIRMATION` is `source=SYSTEM` (no bump) — same accounting as the agent-initiated path.

---

## 11. Edge cases + decisions

| Situation | Decision |
|---|---|
| Customer asks for a demo while session is already MANUAL | Skip demo-intent entirely. Let the agent handle it. |
| Customer asks for a demo when global AI is off | Skip — same reason as above; the FALLBACK template fires. |
| Customer asks for a demo but `microsoft.*` settings are blank | Skip slot-finder entirely; no offer fires. (Don't fall through to a placeholder URL like the agent path does — proactive offers without real bookings are confusing.) |
| Customer's reply is `"1, but can we do it next week?"` | Parser hits `select 1` first; demo gets booked. **Acceptable cost** — customer can cancel via "other" if needed, or the agent reschedules from the chat. |
| Two concurrent inbound messages from the same chat | The existing `chats.processing_lock_until` handles this. The classifier sees only one message at a time; no double-offer risk because `max_offers_per_session=1` blocks the second. |
| Classifier itself fails / times out | Treat as `intent=other`; do not block kb-search. Log + continue. |
| Slot-finder fails (Graph down) | Same — log, no offer. The kb-search reply still goes out normally. |
| Customer phone country differs from organizer's TZ | Always present in `demo.timezone` and append the TZ name to slot labels (e.g. "Tomorrow 10:30am IST"). Customer can mentally convert. |
| Customer accepts a slot that just got booked by someone else (race) | Graph returns 409. We catch it, mark offer state=PROPOSED still (don't lose it), and re-run slot-finder to propose 3 fresh slots. Send a polite "that slot just got taken — here are fresh options" message. |

---

## 12. Microsoft Graph permissions

In addition to the v1 permission (`OnlineMeetings.ReadWrite.All`), this feature requires:

- **`Calendars.Read`** (Application permission) — to read the organizer's free/busy via `getSchedule`.

Re-grant admin consent in the Azure AD app registration after adding it. The application access policy (SETUP.md §15.3) doesn't need updating — it scopes the *existing* app-id to the *existing* organizer-user-id; both already in place.

---

## 13. Settings UI additions

Add the new "Demo intent (AI)" group to `frontend/src/pages/Settings.jsx` `GROUPS` array. Add `META` entries for each new key with helpful tooltips. Pattern is identical to the existing groups; nothing structurally new.

If `demo.intent_detection_enabled` is `false`, consider greying out the rest of the group (visually, not disabling — user can still configure ahead of toggling on).

---

## 14. Testing strategy

### 14.1 Unit tests (vitest, when added)

- `parseOfferReply` — fuzz with realistic replies. Cover `1`, `2.`, `option 1`, `the first one`, `1!`, `1 please`, `actually maybe option 2`, `no thanks`, `not right now`, gibberish.
- `pickSlots` — deterministic pure function. Test fully-busy days, holidays, TZ boundaries, lead-time enforcement, preference matching.
- `decodeAvailabilityView` — Microsoft's quirky string format. Test the fence cases (`"022"` etc.).

### 14.2 Integration tests

- Stub the AI provider's `classifyJson` to return canned intents. Exercise both Mode A and Mode B reply augmentation. Assert exactly one `proposed_demo_offers` row, correct state transitions.
- Stub Microsoft Graph (`@vitest/spy`). Test the 409 race-condition retry path.

### 14.3 Smoke test (add to TEST_AND_DEPLOY.md §H)

Manual flow:
1. Settings -> Demo intent -> toggle `demo.intent_detection_enabled=true`.
2. From test phone, send: `"hey, can we set up a quick call to discuss?"`
3. Expected: receive `DEMO_OFFER` with 3 real slots within ~5s (longer than normal AI reply because of the extra Graph round-trip).
4. Reply `"1"`.
5. Expected: receive `DEMO_CONFIRMATION` with a real Teams join URL within 10s.
6. DB: `proposed_demo_offers` row state=ACCEPTED, `demo_bookings` row exists.
7. Toggle setting back off, repeat step 2: receive normal FALLBACK or KB reply, NO offer.

---

## 15. Rollout plan

Three-stage rollout. Don't skip stages.

### Stage 1 — Shadow mode (1 week)

- Deploy with `demo.intent_detection_enabled=true` BUT skip the slot-finder + reply augmentation. The classifier runs and writes results to a new `demo_intent_classifications` log table, but nothing is sent to the customer.
- After a week, query the table and review every row classified as `intent=demo, confidence>=threshold`. Were they real demo asks?
- Tune the prompt or threshold. Repeat for another week if needed.

### Stage 2 — Soft launch (2 weeks)

- Enable Mode B (separate follow-up message) only.
- Set `demo.max_offers_per_session=1` and a short `demo.offer_expiry_hours=4` to limit blast radius.
- Watch the manual queue for "RESCHEDULED" escalations — high volume means slot-finder is suggesting bad times.
- Watch decline rate — high decline rate means classifier is too eager.

### Stage 3 — Full launch

- Enable Mode A (inline reply augmentation).
- Increase `offer_expiry_hours` back to 24.
- Document the new flow in `OPS.md`.

### Kill switch

`demo.intent_detection_enabled=false` short-circuits everything. No code rollback needed if the feature misbehaves — flip the setting and existing PROPOSED offers expire on schedule. Customers in flight see the offer through to completion, but no new offers fire.

---

## 16. Implementation effort breakdown

| Day | Work |
|---|---|
| 1 | Schema migration + `proposed_demo_offers` table + new settings + seed updates + WRITABLE allowlist + Settings UI group. |
| 2 | `demo-intent` worker: classifier prompt, provider abstraction extension (`classifyJson`), JSON-schema enforcement, timeout handling. Shadow-mode logging table. |
| 2.5 | `slot-finder` worker: Graph `getSchedule` integration, `pickSlots` algorithm, TZ handling, edge cases. Heavy unit test coverage. |
| 1 | Reply augmentation (both modes), `DEMO_OFFER` / `DEMO_DECLINED` / `DEMO_RESCHEDULE_PENDING` templates, customer reply parser, expiry sweep cron. |
| 0.5 | Smoke tests, OPS.md update, the rollout-stage feature flags. |

**Total: ~5 dev days.** (Slightly more than the original ~4 estimate — Stage 1 shadow-mode logging is the addition.)

---

## 17. Things to deliberately NOT build

These will come up in code review; pre-empting:

- **Customer-side TZ inference.** Everyone gets `demo.timezone`. Phone country code is a terrible TZ proxy (people travel, dual-SIM, VoIP). Slot labels include the TZ name; customers cope.
- **Full natural-language slot picking** (e.g. "how about tomorrow at 3?"). The numeric-reply pattern is on purpose — it's faster to parse correctly and it teaches customers the interaction model. The "other" escape valve handles freeform requests via MANUAL escalation.
- **Recurring demo support.** This is sales-call territory, not what v1 was built for. If a customer asks for weekly check-ins, that's a MANUAL escalation.
- **Multi-attendee meetings.** v1's `bookDemo` creates a 1:1 organizer<->customer call. Don't extend this without a UX rethink (customer never explicitly opts in to extra attendees being on the call).
- **AI-suggested topic/agenda for the demo.** Tempting but adds another LLM call and another failure mode. The booked Teams meeting subject is just `"Product demo"`; the human owns the agenda.

---

## 18. Files this will touch

For estimation purposes, here's the file footprint:

```
backend/prisma/schema.prisma                                 (+ ~30 lines)
backend/prisma/seed.js                                       (+ ~25 lines settings, + 3 templates)
backend/src/modules/settings/settings.controller.js          (+ allowlist entries)
backend/src/modules/ai/providers/openai.js                   (+ classifyJson method)
backend/src/modules/ai/providers/gemini.js                   (+ classifyJson method)
backend/src/modules/ai/providers/index.js                    (+ export)
backend/src/modules/demo/demo-intent.service.js              (NEW)
backend/src/modules/demo/slot-finder.service.js              (NEW)
backend/src/modules/demo/offer-parser.js                     (NEW, pure utils)
backend/src/modules/teams/teams.service.js                   (+ getSchedule wrapper)
backend/src/workers/queues/demo-intent.worker.js             (NEW)
backend/src/workers/queues/slot-finder.worker.js             (NEW)
backend/src/workers/queues/incoming.worker.js                (+ classifier enqueue + offer-reply branch)
backend/src/workers/queues/kb-search.worker.js               (+ Mode A reply augmentation)
backend/src/workers/queues/scheduler.worker.js               (+ expiry sweep)
backend/src/modules/queue/producers.js                       (+ enqueueDemoIntent, enqueueSlotFinder)
backend/src/shared/queue.js                                  (+ 2 new queue names)
frontend/src/pages/Settings.jsx                              (+ "demo" group + META entries)
TEST_AND_DEPLOY.md                                           (+ §H3 demo-intent smoke test)
OPS.md                                                       (+ "Demo offers backed up" troubleshooting)
SETUP.md §15                                                 (+ Calendars.Read permission note)
```

---

## See also

- [SETUP.md §15](SETUP.md#15-demo-booking-microsoft-teams--optional) — the v1 agent-initiated demo booking + Azure AD setup. Pre-requisite for this feature.
- [OPS.md](OPS.md) — v1 demo booking operator scenarios.
- [AI_PROVIDERS.md](AI_PROVIDERS.md) — provider abstraction. The classifier extension lives here.
- [README.md](README.md) — behavioural contract section. Update it when this ships ("AI never proactively offers a demo" -> "AI may offer a demo when intent is detected, gated by `demo.intent_detection_enabled`").
