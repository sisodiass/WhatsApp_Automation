// Producer side of the pdf-processing queue. The actual job handler lives
// in kb.processor.js and is bound by the worker process.

import { getQueue, QUEUES } from "../../shared/queue.js";

export function enqueuePdfProcessing(documentId) {
  const queue = getQueue(QUEUES.PDF_PROCESSING);
  return queue.add(
    "process-pdf",
    { documentId },
    {
      // Idempotent retry: same document id → same job id → BullMQ dedup.
      // BullMQ rejects ":" in custom ids, so we use "-" as separator.
      jobId: `pdf-${documentId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );
}
