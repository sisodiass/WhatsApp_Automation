// M11.D3 — terminal-job-failure → in-app Notification.
//
// BullMQ retries with exponential backoff until `attempts` is exhausted.
// When that happens, the job lands in the failed set. Operators have no
// visibility today except by tailing logs. This helper surfaces the
// failure as a Notification routed to every ADMIN/SUPER_ADMIN user in
// the relevant tenant — same channel as the manual queue, lead
// reminders, etc.
//
// Best-effort: every step is try/catch'd. A failure inside this helper
// must never throw — that would compound the original job failure.
//
// Wiring:
//   import { notifyOnTerminalJobFailure } from "../shared/job-failure-alerts.js";
//   worker.on("failed", (job, err) =>
//     notifyOnTerminalJobFailure(job, err, {
//       descriptor: "Outbound message delivery",
//       resolveTenantId: (j) => resolveFromMessageId(j.data.messageId),
//     }),
//   );

import { prisma } from "./prisma.js";
import { child } from "./logger.js";

const log = child("job-failure-alerts");

// Roles allowed to receive operational notifications. Mirrors the
// existing pattern used by sessions/manual-queue notifications.
const ALERT_ROLES = ["SUPER_ADMIN", "ADMIN"];

export async function notifyOnTerminalJobFailure(job, err, opts) {
  if (!job) return;
  try {
    const attemptsMade = job.attemptsMade || 0;
    const maxAttempts = job.opts?.attempts || 1;
    // Only fire on the LAST failed attempt. Earlier failures are still
    // logged by the worker's own `failed` listener.
    if (attemptsMade < maxAttempts) return;

    const tenantId = await safeResolve(opts.resolveTenantId, job);
    if (!tenantId) {
      log.warn("no tenantId for failed job — skipping notification", {
        queue: job.queueName,
        jobId: job.id,
      });
      return;
    }

    // Recipients: every active admin user in this tenant. Small set
    // (typically 1-5); a per-tenant fan-out is acceptable. If this
    // becomes a hot path we can switch to a single SUPER_ADMIN.
    const admins = await prisma.user.findMany({
      where: {
        tenantId,
        role: { in: ALERT_ROLES },
        isActive: true,
      },
      select: { id: true },
    });
    if (admins.length === 0) return;

    const descriptor = opts.descriptor || `Job (${job.queueName})`;
    const title = `${descriptor} failed after ${attemptsMade} attempts`;
    const body = [
      err?.message ? err.message.slice(0, 400) : "Unknown error",
      `Job ID: ${job.id}`,
      `Queue: ${job.queueName}`,
    ].join("\n");

    await prisma.notification.createMany({
      data: admins.map((u) => ({
        tenantId,
        userId: u.id,
        kind: "JOB_FAILED",
        title,
        body,
      })),
    });

    log.error("terminal job failure notified", {
      queue: job.queueName,
      jobId: job.id,
      tenantId,
      recipients: admins.length,
      err: err?.message,
    });
  } catch (alertErr) {
    // Swallow — alerting must not mask the original failure.
    log.warn("failed to emit job-failure notification", {
      jobId: job?.id,
      err: alertErr?.message,
    });
  }
}

async function safeResolve(fn, job) {
  if (!fn) return null;
  try {
    return await fn(job);
  } catch (err) {
    log.warn("resolveTenantId threw", { jobId: job?.id, err: err?.message });
    return null;
  }
}

// ─── Standard tenantId resolvers ──────────────────────────────────────
// Most queue jobs reference one of: a messageId, a campaignId, an
// automationRunId, a quotationId, or a paymentLinkId. These helpers
// resolve to tenantId without forcing every call site to write its own
// query.

export async function tenantIdFromMessageId(messageId) {
  if (!messageId) return null;
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    select: { session: { select: { chat: { select: { tenantId: true } } } } },
  });
  return row?.session?.chat?.tenantId || null;
}

export async function tenantIdFromAutomationRunId(runId) {
  if (!runId) return null;
  const row = await prisma.automationRun.findUnique({
    where: { id: runId },
    select: { tenantId: true },
  });
  return row?.tenantId || null;
}

export async function tenantIdFromQuotationId(quotationId) {
  if (!quotationId) return null;
  const row = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { tenantId: true },
  });
  return row?.tenantId || null;
}
