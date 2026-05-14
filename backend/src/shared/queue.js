// BullMQ helpers. Single Redis connection shared across all queues.
//
// Phase 4 ships the pdf-processing queue. Phase 5 will add
// incoming-messages, kb-search, outgoing-messages, scheduler-jobs.

import { Queue, Worker } from "bullmq";
import { config } from "../config/index.js";

export const QUEUES = {
  PDF_PROCESSING: "pdf-processing",
  INCOMING: "incoming-messages",
  KB_SEARCH: "kb-search",
  OUTGOING: "outgoing-messages",
  // Dedicated queue for bulk broadcasts. Separate from OUTGOING so a
  // large campaign blast can't starve single-chat AI replies; each queue
  // has its own concurrency + rate limiter budget.
  BULK_OUTGOING: "bulk-outgoing",
  // M6: each automation run step is its own job. WAIT steps reschedule
  // the next step with a delay; everything else completes synchronously
  // and enqueues the next step immediately. JobId = "auto-<runId>-<step>"
  // so retries on a given step are idempotent.
  AUTOMATION_RUNS: "automation-runs",
  SCHEDULER: "scheduler-jobs",
};

// BullMQ wants a connection object, not just a URL string. ioredis options
// must NOT include `maxRetriesPerRequest` here — BullMQ enforces null itself.
function connectionOptions() {
  return {
    connection: { url: config.redisUrl },
    prefix: "sa", // namespaces all keys under sa:bull:*
  };
}

const _queueCache = new Map();

export function getQueue(name) {
  if (_queueCache.has(name)) return _queueCache.get(name);
  const q = new Queue(name, connectionOptions());
  _queueCache.set(name, q);
  return q;
}

export function makeWorker(name, handler, opts = {}) {
  return new Worker(name, handler, {
    ...connectionOptions(),
    concurrency: 1,
    ...opts,
  });
}

export async function closeAllQueues() {
  for (const q of _queueCache.values()) {
    await q.close().catch(() => {});
  }
  _queueCache.clear();
}
