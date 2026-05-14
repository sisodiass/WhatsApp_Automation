// bulk-outgoing worker — bulk broadcast last-mile sender. Mirrors
// outgoing.worker.js but skips AI-session state checks (a CAMPAIGN
// message belongs to a recipient, not a back-and-forth conversation) and
// updates the BulkCampaignRecipient row alongside the message row.
//
// Dedup discipline (same as OUTGOING):
//   jobId="bulk-<messageId>"        — BullMQ-native
//   messages.sent_at IS NULL guard  — DB-level, survives queue replay

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { getSettings } from "../../modules/settings/settings.service.js";
import { Channels, publish } from "../../modules/whatsapp/whatsapp.bus.js";
import { toWaJid } from "../../utils/phone.js";

const log = child("q:bulk-outgoing");

export async function processBulkOutgoingJob(job) {
  const { messageId, delayMs } = job.data;

  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      session: { include: { chat: true } },
      bulkRecipients: { include: { bulkCampaign: true }, take: 1 },
    },
  });
  if (!msg) return { skipped: "missing" };
  if (msg.sentAt) return { skipped: "already_sent" };
  if (msg.direction !== "OUT" || msg.source !== "CAMPAIGN") {
    return { skipped: "not_campaign_outbound" };
  }
  const recipient = msg.bulkRecipients?.[0];
  if (!recipient) {
    log.warn("bulk message without recipient row — skipping", { messageId });
    return { skipped: "no_recipient" };
  }
  // Honor pause / cancel: if the parent bulk was halted between
  // drip-enqueue and worker-pickup, mark the recipient FAILED with a
  // clear reason rather than firing an unauthorized send.
  const bulkStatus = recipient.bulkCampaign?.status;
  if (bulkStatus && !["RUNNING", "SCHEDULED"].includes(bulkStatus)) {
    await prisma.bulkCampaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "FAILED", failedAt: new Date(), error: `bulk ${bulkStatus}` },
    });
    return { skipped: `bulk_${bulkStatus}` };
  }

  const tenantId = msg.session.chat.tenantId;
  const cfg = await getSettings(tenantId, [
    "wa.delay_min_seconds",
    "wa.delay_max_seconds",
    "wa.warmup_mode",
    "wa.warmup_delay_min_seconds",
    "wa.warmup_delay_max_seconds",
  ]);

  const warmup = cfg["wa.warmup_mode"] === true;
  // For bulk we honor BOTH the campaign's delay range AND the global
  // warmup floor. The producer already jittered between campaign min/max
  // when enqueuing; here we add a small warmup-aware typing simulation
  // so the per-message cadence still looks human.
  const typingMin = Number(
    warmup ? cfg["wa.warmup_delay_min_seconds"] ?? 15 : cfg["wa.delay_min_seconds"] ?? 8,
  );
  const typingMax = Number(
    warmup ? cfg["wa.warmup_delay_max_seconds"] ?? 40 : cfg["wa.delay_max_seconds"] ?? 25,
  );
  let typingMs;
  if (delayMs !== null && delayMs !== undefined) {
    typingMs = Math.max(0, Number(delayMs));
  } else {
    const span = Math.max(0, typingMax - typingMin);
    typingMs = (typingMin + Math.random() * span) * 1000;
  }

  await publish(Channels.OUTBOUND, {
    messageId: msg.id,
    to: toWaJid(msg.session.chat.phone),
    body: msg.body,
    simulateTyping: Math.round(typingMs),
  });

  log.info("dispatched bulk", {
    messageId,
    bulkId: recipient.bulkCampaignId,
    typingMs: Math.round(typingMs),
    warmup,
  });
  return { ok: true };
}
