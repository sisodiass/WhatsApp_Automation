// automation-runs worker — progresses one step of an AutomationRun per
// job. Idempotent via jobId="auto-<runId>-<stepIndex>" upstream; the
// engine's executeNextStep is the source of truth for state transitions
// and re-enqueue.
//
// WAIT steps schedule the next job with `delay`; other step types
// enqueue immediately. The worker itself is dumb — all logic lives in
// automation.engine.js.

import { child } from "../../shared/logger.js";
import { executeNextStep } from "../../modules/automations/automation.engine.js";

const log = child("q:automation-runs");

export async function processAutomationStepJob(job) {
  const { runId, stepIndex } = job.data;
  const result = await executeNextStep(runId);
  log.debug("step result", { runId, stepIndex, result });
  return result;
}
