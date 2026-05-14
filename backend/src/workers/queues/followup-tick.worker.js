// Auto follow-up tick. Runs from the scheduler queue every 5 minutes.
// Walks every active FollowupRule and, for each, picks leads matching
// the rule's pipeline/stage filter that have been idle for at least the
// rule's hoursSinceLastInbound AND haven't yet hit the rule's
// maxReminders ceiling.
//
// Idle measurement uses chat.lastMessageAt — bumped on every message in
// either direction. This prevents a flurry of reminders within the
// threshold window (each reminder we send pushes lastMessageAt forward,
// resetting the timer for the next reminder).
//
// Fire path is per-recipient:
//   1. Render the configured template against contact + lead variables.
//   2. Find/create the chat's active session (placeholder if none).
//   3. Create a SYSTEM message (sentAt=NULL) and enqueue OUTGOING.
//   4. Write a FollowupLog row + a LeadActivity AUTOMATION entry.
//   5. Emit `lead.followup.sent` for M7 workflow consumers.
//
// The actual WhatsApp send and ack happen via the existing outgoing rail
// (outgoing.worker → wa-worker → markOutboundSent).

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { emit, Events } from "../../shared/events.js";
import { interpolate } from "../../modules/templates/template.service.js";
import {
  buildContactVars,
  buildStandardVars,
} from "../../modules/templates/variables.js";
import { enqueueOutbound } from "../../modules/queue/producers.js";

const log = child("q:followup-tick");

// Per-tick safety cap. Even with many matching leads, no single tick
// blasts more than this many reminders. Keeps tick runtime predictable
// and the outbound queue from suddenly spiking.
const PER_TICK_CAP = 50;

export async function processFollowupTick() {
  const rules = await prisma.followupRule.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  let fired = 0;
  for (const rule of rules) {
    if (fired >= PER_TICK_CAP) break;
    try {
      const remaining = PER_TICK_CAP - fired;
      fired += await runRule(rule, remaining);
    } catch (err) {
      log.error("rule failed", { ruleId: rule.id, err: err.message });
    }
  }
  return { rulesScanned: rules.length, fired };
}

async function runRule(rule, cap) {
  const now = new Date();
  if (insideQuietHours(now, rule.quietHoursStart, rule.quietHoursEnd)) {
    return 0;
  }

  const idleSince = new Date(now.getTime() - rule.hoursSinceLastInbound * 3600_000);

  // Find candidate leads: tenant + (optional pipeline) + (optional stage)
  // with the lead's contact's chat lastMessageAt ≤ idle threshold.
  const candidates = await prisma.lead.findMany({
    where: {
      tenantId: rule.tenantId,
      ...(rule.pipelineId ? { pipelineId: rule.pipelineId } : {}),
      ...(rule.stageId ? { stageId: rule.stageId } : {}),
      stage: { category: "OPEN" }, // skip WON/LOST leads
      contact: {
        deletedAt: null,
        chats: {
          some: {
            tenantId: rule.tenantId,
            // chat.lastMessageAt may be null (contact exists, no msg yet) —
            // those don't qualify; only chats with an actual last activity
            // older than the idle threshold do.
            lastMessageAt: { lte: idleSince, not: null },
          },
        },
      },
    },
    take: Math.min(cap * 3, 200), // over-pull to absorb the maxReminders filter
    include: {
      contact: {
        include: {
          chats: {
            where: { tenantId: rule.tenantId },
            orderBy: { lastMessageAt: "desc" },
            take: 1,
          },
        },
      },
      pipeline: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  // Filter out leads that have already hit maxReminders for THIS rule.
  // Done in app code rather than SQL because counting per-pair is awkward
  // to combine with the candidate filter — and the cardinality is low.
  let fired = 0;
  for (const lead of candidates) {
    if (fired >= cap) break;
    const used = await prisma.followupLog.count({
      where: { ruleId: rule.id, leadId: lead.id },
    });
    if (used >= rule.maxReminders) continue;

    try {
      await fireOne(rule, lead);
      fired += 1;
    } catch (err) {
      log.warn("fire failed", { ruleId: rule.id, leadId: lead.id, err: err.message });
      await prisma.followupLog.create({
        data: { ruleId: rule.id, leadId: lead.id, error: err.message?.slice(0, 500) },
      });
    }
  }
  if (fired > 0) {
    log.info("rule fired", { ruleId: rule.id, name: rule.name, fired });
  }
  return fired;
}

async function fireOne(rule, lead) {
  // Render template against contact + lead variables. Reuses M3 vars.
  const contact = lead.contact;
  const chat = contact.chats[0];
  if (!chat) throw new Error("no chat for contact");

  const vars = {
    ...buildStandardVars(),
    ...buildContactVars(contact),
    lead_source: lead.source ?? "",
    lead_stage: lead.stage?.name ?? "",
    assigned_agent: lead.assignedTo?.name ?? "",
  };
  // Resolve template by name (rule.templateName), interpolate against vars.
  const tpl = await prisma.messageTemplate.findFirst({
    where: { tenantId: rule.tenantId, name: rule.templateName, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!tpl) throw new Error(`template "${rule.templateName}" not found / inactive`);
  const body = interpolate(tpl.content, vars);

  // Find or create an active session for the chat. Follow-ups create a
  // session-less placeholder if none exists, mirroring bulk-drip.
  let session = await prisma.chatSession.findFirst({
    where: { chatId: chat.id, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!session) {
    session = await prisma.chatSession.create({
      data: { chatId: chat.id, state: "ACTIVE", mode: "AI" },
    });
  }

  const msg = await prisma.message.create({
    data: {
      sessionId: session.id,
      direction: "OUT",
      source: "SYSTEM",
      body,
      kbChunkIds: [],
    },
  });

  // Log + activity + queue dispatch in a single transaction so we never
  // half-fire (queue dispatch happens AFTER commit so a transaction
  // rollback doesn't leave an orphan job).
  await prisma.$transaction([
    prisma.followupLog.create({
      data: { ruleId: rule.id, leadId: lead.id, messageId: msg.id },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        kind: "AUTOMATION",
        messageId: msg.id,
        data: {
          event: "followup_sent",
          ruleId: rule.id,
          ruleName: rule.name,
          templateName: rule.templateName,
        },
      },
    }),
    // Bump chat.lastMessageAt so the idle timer resets and we don't
    // re-fire within the threshold window.
    prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  await enqueueOutbound(msg.id);

  // M7 workflow automation will subscribe to this event.
  emit(Events.LEAD_FOLLOWUP_SENT, {
    leadId: lead.id,
    tenantId: rule.tenantId,
    ruleId: rule.id,
    messageId: msg.id,
  });
}

// Same wrap-around quiet-hours semantics as bulk-drip.
function insideQuietHours(now, start, end) {
  if (!start || !end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sH, sM] = start.split(":").map(Number);
  const [eH, eM] = end.split(":").map(Number);
  const s = sH * 60 + sM;
  const e = eH * 60 + eM;
  if (s === e) return false;
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e;
}
