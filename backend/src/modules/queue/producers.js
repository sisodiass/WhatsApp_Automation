// Queue producers used from anywhere in the API process.
// Idempotent jobIds (A3 outbound dedup). Retries with exponential backoff.
//
// BullMQ rejects ":" in custom ids — we use "-" as the prefix separator.

import { getQueue, QUEUES } from "../../shared/queue.js";

const baseOpts = {
  attempts: 3,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 1000 },
};

// inbound message → AI pipeline entry point.
export function enqueueIncoming(messageId) {
  return getQueue(QUEUES.INCOMING).add(
    "process-inbound",
    { messageId },
    { ...baseOpts, jobId: `in-${messageId}` },
  );
}

// kb-search produces a new outbound AI message and enqueues it for sending.
export function enqueueKbSearch(messageId) {
  return getQueue(QUEUES.KB_SEARCH).add(
    "kb-search",
    { messageId },
    { ...baseOpts, jobId: `kb-${messageId}` },
  );
}

// outbound delivery. Same messageId → same jobId → BullMQ-native dedup.
// `delayMs` is the simulated typing delay BEFORE we publish to wa:outbound.
export function enqueueOutbound(messageId, opts = {}) {
  return getQueue(QUEUES.OUTGOING).add(
    "send-outbound",
    { messageId, delayMs: opts.delayMs ?? null },
    { ...baseOpts, jobId: `out-${messageId}` },
  );
}

// Bulk broadcast outbound. Same dedup discipline as enqueueOutbound but
// lives on a separate queue so single-chat AI replies don't starve when
// a bulk blast is in flight.
export function enqueueBulkOutbound(messageId, opts = {}) {
  return getQueue(QUEUES.BULK_OUTGOING).add(
    "send-bulk",
    { messageId, delayMs: opts.delayMs ?? null },
    { ...baseOpts, jobId: `bulk-${messageId}` },
  );
}

// M6: enqueue the NEXT step of an automation run. jobId is keyed on
// (runId, stepIndex) so retries are idempotent per-step; advancing the
// step bumps the index and yields a fresh jobId.
export function enqueueAutomationStep(runId, stepIndex, opts = {}) {
  return getQueue(QUEUES.AUTOMATION_RUNS).add(
    "step",
    { runId, stepIndex },
    {
      ...baseOpts,
      jobId: `auto-${runId}-${stepIndex}`,
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
    },
  );
}
