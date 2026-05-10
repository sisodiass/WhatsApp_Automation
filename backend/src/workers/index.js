// Combined worker process. Runs all BullMQ queues in a single Node
// instance to keep the 4GB-VPS memory budget tight.
//
// Phase 4 wired pdf-processing. Phase 5 wires incoming-messages,
// kb-search, outgoing-messages. Phase 9 will add scheduler-jobs.
//
// Run: `npm run start:worker` (production via PM2) or `npm run dev:worker`.

import { child } from "../shared/logger.js";
import { closeAllQueues, getQueue, makeWorker, QUEUES } from "../shared/queue.js";
import { redis } from "../shared/redis.js";
import { getDefaultTenantId } from "../shared/tenant.js";
import { getSettings } from "../modules/settings/settings.service.js";
import { processPdfJob } from "../modules/kb/kb.processor.js";
import { processIncomingJob } from "./queues/incoming.worker.js";
import { processKbSearchJob } from "./queues/kb-search.worker.js";
import { processOutgoingJob } from "./queues/outgoing.worker.js";
import { processSchedulerJob } from "./queues/scheduler.worker.js";

const log = child("worker");

async function bootstrap() {
  log.info("worker booting");

  // R8 + A1: read outbound rate limit from settings at boot. Restart the
  // worker process to pick up changes (Phase 8 settings UI documents this).
  const tenantId = await getDefaultTenantId();
  const cfg = await getSettings(tenantId, [
    "wa.outbound_per_minute_max",
    "wa.warmup_outbound_per_minute_max",
    "wa.warmup_mode",
    "ai.concurrent_retrieval_limit",
  ]);
  const warmup = cfg["wa.warmup_mode"] === true;
  const outboundMax = Number(
    warmup
      ? cfg["wa.warmup_outbound_per_minute_max"] ?? 10
      : cfg["wa.outbound_per_minute_max"] ?? 30,
  );
  const kbConcurrency = Number(cfg["ai.concurrent_retrieval_limit"] ?? 3);

  log.info("worker config", { outboundMax, kbConcurrency, warmup });

  // A5: surface stalled-job count on boot (BullMQ's stall detector handles
  // re-queuing; idempotent jobIds make retries safe).
  for (const name of Object.values(QUEUES)) {
    try {
      const q = getQueue(name);
      const counts = await q.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed",
      );
      log.info(`queue ${name}`, counts);
    } catch (err) {
      log.warn(`queue counts ${name} failed`, { err: err.message });
    }
  }

  const workers = [];

  workers.push(
    makeWorker(QUEUES.PDF_PROCESSING, processPdfJob, { concurrency: 2 }),
  );
  workers.push(
    makeWorker(QUEUES.INCOMING, processIncomingJob, { concurrency: 5 }),
  );
  workers.push(
    makeWorker(QUEUES.KB_SEARCH, processKbSearchJob, {
      concurrency: kbConcurrency,
    }),
  );
  workers.push(
    makeWorker(QUEUES.OUTGOING, processOutgoingJob, {
      concurrency: 1,
      limiter: { max: outboundMax, duration: 60_000 },
    }),
  );
  workers.push(makeWorker(QUEUES.SCHEDULER, processSchedulerJob, { concurrency: 1 }));

  // Schedule repeating jobs. Idempotent: BullMQ dedups repeats by (name, repeat-key).
  await scheduleRepeats();

  for (const w of workers) {
    w.on("completed", (job, result) =>
      log.debug("job completed", { queue: w.name, id: job.id, result }),
    );
    w.on("failed", (job, err) =>
      log.error("job failed", {
        queue: w.name,
        id: job?.id,
        attempts: job?.attemptsMade,
        err: err.message,
      }),
    );
  }

  log.info("workers ready", { queues: Object.values(QUEUES) });
  return workers;
}

async function scheduleRepeats() {
  const q = (await import("../shared/queue.js")).getQueue(QUEUES.SCHEDULER);
  // Watchdog: every 30s. Heartbeat is every 15s, dead after 45s.
  await q.add(
    "watchdog",
    {},
    {
      repeat: { every: 30_000 },
      jobId: "watchdog",
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  );
  // Nightly backup at 03:00 server time.
  await q.add(
    "backup",
    {},
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: "backup",
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
  log.info("repeating jobs scheduled", { jobs: ["watchdog (30s)", "backup (cron 0 3 * * *)"] });
}

let workersPromise = bootstrap().catch((err) => {
  log.error("worker bootstrap failed", { err: err.message, stack: err.stack });
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`received ${signal}, shutting down`);
  try {
    const workers = await workersPromise;
    await Promise.all((workers || []).map((w) => w.close().catch(() => {})));
  } catch {}
  await closeAllQueues();
  await redis.quit().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) =>
  log.error("unhandledRejection", { err: err?.message || String(err) }),
);
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { err: err.message, stack: err.stack });
  shutdown("uncaughtException");
});
