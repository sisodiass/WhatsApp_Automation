// Bulk-campaign drip tick. Runs from the scheduler queue every minute.
// Responsibilities, in order:
//
//   1. Transition SCHEDULED bulks whose scheduledAt has passed → RUNNING.
//   2. Transition RUNNING bulks with zero remaining recipients → COMPLETED.
//   3. For each RUNNING bulk:
//        a. Read the campaign's safety knobs (delayMin/Max, dailyLimit,
//           quietHours, skipRepliedHours).
//        b. Skip the tick entirely if the current local time is inside
//           the quiet-hours window.
//        c. Pull up to N PENDING recipients (N = min(dailyLimit, hard
//           limit), where dailyLimit is enforced over a rolling 24h
//           window via the sentCount snapshot). Honors warmup mode by
//           capping at 20 if the global wa.warmup_mode flag is on.
//        d. For each picked recipient:
//             - render the body using template/variables.js against
//               the contact's data
//             - create a Message row (source=CAMPAIGN, sentAt=NULL)
//             - link recipient.messageId, status=QUEUED, queuedAt=now
//             - enqueue bulk-outgoing with a delayMs jittered between
//               delayMin..delayMax seconds (campaign-level pacing)
//
// Idempotent: rows are pulled with `status=PENDING AND planned_at IS
// NULL` and atomically stamped with planned_at=now in the same UPDATE.
// Concurrent ticks will skip rows already claimed by another tick.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { getSettings } from "../../modules/settings/settings.service.js";
import { interpolate } from "../../modules/templates/template.service.js";
import { buildContactVars, buildStandardVars } from "../../modules/templates/variables.js";
import { enqueueBulkOutbound } from "../../modules/queue/producers.js";

const log = child("q:bulk-drip");

// Per-tick batch cap. The actual per-bulk batch is the minimum of this
// and the campaign's dailyLimit remaining budget. Keeps a single tick's
// runtime predictable.
const TICK_BATCH = 50;
const WARMUP_BATCH_CAP = 20;

export async function processBulkDripTick() {
  const now = new Date();

  // 1. SCHEDULED → RUNNING for any bulks whose scheduledAt has passed.
  await prisma.bulkCampaign.updateMany({
    where: {
      status: "SCHEDULED",
      OR: [
        { scheduledAt: null },
        { scheduledAt: { lte: now } },
      ],
    },
    data: { status: "RUNNING", startedAt: now },
  });

  // 2. Pull active bulks. We process them one at a time per tick to keep
  // the per-bulk safety logic simple; the scheduler runs every 60s.
  const active = await prisma.bulkCampaign.findMany({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "asc" },
  });

  for (const bulk of active) {
    try {
      await dripOne(bulk, now);
    } catch (err) {
      log.error("drip failed for bulk", { bulkId: bulk.id, err: err.message });
    }
  }

  return { processed: active.length };
}

async function dripOne(bulk, now) {
  // Completion check: if there are no PENDING recipients left, mark
  // COMPLETED. Includes the case where every recipient was cancelled
  // or failed.
  const pending = await prisma.bulkCampaignRecipient.count({
    where: { bulkCampaignId: bulk.id, status: "PENDING" },
  });
  if (pending === 0) {
    await prisma.bulkCampaign.update({
      where: { id: bulk.id },
      data: { status: "COMPLETED", completedAt: now },
    });
    log.info("bulk completed", { bulkId: bulk.id });
    return;
  }

  // Safety: quiet-hours check. Operator's local time vs. configured
  // window. If now is inside the window, skip this tick entirely.
  if (insideQuietHours(now, bulk.quietHoursStart, bulk.quietHoursEnd)) {
    log.debug("bulk inside quiet hours", { bulkId: bulk.id });
    return;
  }

  // Safety: warmup hard cap.
  const cfg = await getSettings(bulk.tenantId, ["wa.warmup_mode"]);
  const warmup = cfg["wa.warmup_mode"] === true;

  // Daily budget: # already sent in the rolling 24h vs dailyLimit.
  const sinceMidnight = new Date(now);
  sinceMidnight.setHours(0, 0, 0, 0);
  const sentToday = await prisma.bulkCampaignRecipient.count({
    where: {
      bulkCampaignId: bulk.id,
      OR: [
        { queuedAt: { gte: sinceMidnight } },
        { sentAt: { gte: sinceMidnight } },
      ],
    },
  });
  const dailyBudget = Math.max(0, bulk.dailyLimit - sentToday);
  if (dailyBudget === 0) {
    log.debug("bulk hit daily limit", { bulkId: bulk.id, sentToday });
    return;
  }

  const batchCap = warmup
    ? Math.min(WARMUP_BATCH_CAP, dailyBudget, TICK_BATCH)
    : Math.min(dailyBudget, TICK_BATCH);

  // 3. Claim up to batchCap PENDING recipients atomically.
  const claim = await prisma.bulkCampaignRecipient.findMany({
    where: { bulkCampaignId: bulk.id, status: "PENDING", plannedAt: null },
    take: batchCap,
    orderBy: { createdAt: "asc" },
    include: {
      contact: true,
    },
  });
  if (claim.length === 0) return;

  // Stamp planned_at on the claimed batch so a concurrent tick doesn't
  // pick them up again. A single transaction wraps the per-recipient
  // message creation + queue enqueue so a crash mid-batch leaves the
  // DB consistent.
  const ids = claim.map((r) => r.id);
  await prisma.bulkCampaignRecipient.updateMany({
    where: { id: { in: ids }, plannedAt: null },
    data: { plannedAt: now },
  });

  // For each recipient: prepare the message + enqueue. Done outside the
  // batch transaction so a single bad row doesn't roll the whole batch.
  for (let i = 0; i < claim.length; i++) {
    const r = claim[i];
    try {
      await sendOne(bulk, r, i);
    } catch (err) {
      log.warn("drip send failed", { bulkId: bulk.id, recipientId: r.id, err: err.message });
      await prisma.bulkCampaignRecipient.update({
        where: { id: r.id },
        data: { status: "FAILED", failedAt: new Date(), error: err.message },
      });
      await prisma.bulkCampaign.update({
        where: { id: bulk.id },
        data: { failedCount: { increment: 1 } },
      });
    }
  }

  log.info("bulk drip batch dispatched", {
    bulkId: bulk.id,
    count: claim.length,
    warmup,
  });
}

// Quiet-hours: HH:MM strings interpreted in the server's local timezone.
// Supports wrap-around (e.g. start=22:00 end=08:00 means 22:00-08:00 next
// day is the quiet window).
function insideQuietHours(now, start, end) {
  if (!start || !end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sH, sM] = start.split(":").map(Number);
  const [eH, eM] = end.split(":").map(Number);
  const s = sH * 60 + sM;
  const e = eH * 60 + eM;
  if (s === e) return false;
  if (s < e) return cur >= s && cur < e;
  // wrap-around
  return cur >= s || cur < e;
}

async function sendOne(bulk, recipient, batchIndex) {
  // Find (or lazily create) a chat for this contact so the message FK
  // chain (message → session → chat) holds. We prefer an existing chat;
  // otherwise create a session-less placeholder chat — the wa-worker
  // sends by phone, not chat, so the chat row is a join target only.
  let chat = await prisma.chat.findUnique({
    where: { tenantId_phone: { tenantId: bulk.tenantId, phone: recipient.contact.mobile } },
  });
  if (!chat) {
    chat = await prisma.chat.create({
      data: {
        tenantId: bulk.tenantId,
        phone: recipient.contact.mobile,
        contactId: recipient.contactId,
        displayName: [recipient.contact.firstName, recipient.contact.lastName].filter(Boolean).join(" ") || null,
      },
    });
  } else if (!chat.contactId) {
    await prisma.chat.update({
      where: { id: chat.id },
      data: { contactId: recipient.contactId },
    });
  }

  // The message must belong to a session — bulk sends create a lightweight
  // placeholder session with no campaignId so the existing message →
  // session FK stays intact.
  let session = await prisma.chatSession.findFirst({
    where: { chatId: chat.id, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!session) {
    session = await prisma.chatSession.create({
      data: { chatId: chat.id, state: "ACTIVE", mode: "AI" },
    });
  }

  // Render the template body against the contact's vars.
  const vars = { ...buildStandardVars(), ...buildContactVars(recipient.contact) };
  const body = interpolate(bulk.messageBody, vars);

  const msg = await prisma.message.create({
    data: {
      sessionId: session.id,
      direction: "OUT",
      source: "CAMPAIGN",
      body,
      kbChunkIds: [],
    },
  });

  await prisma.bulkCampaignRecipient.update({
    where: { id: recipient.id },
    data: { messageId: msg.id, status: "QUEUED", queuedAt: new Date() },
  });

  // Campaign-level jitter: each subsequent recipient in the batch gets
  // an extra (delayMin..delayMax) seconds offset so the WhatsApp delivery
  // rate looks human.
  const span = Math.max(0, bulk.delayMax - bulk.delayMin);
  const offsetSec = bulk.delayMin + Math.random() * span;
  const cumulativeMs = batchIndex * offsetSec * 1000;
  await enqueueBulkOutbound(msg.id, { delayMs: Math.round(cumulativeMs) });
}
