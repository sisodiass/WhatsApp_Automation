// Subscribe to domain events and spawn AutomationRuns for matching
// automations. Loaded at boot in BOTH the API process (where LEAD_*
// events originate) and the worker process (where LEAD_FOLLOWUP_SENT
// originates).
//
// The EventEmitter in shared/events.js is process-local; cross-process
// triggers fan in via the database (event handler enqueues a BullMQ
// job → automation-runs worker picks it up regardless of which process
// observed the original event).

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { Events, on } from "../../shared/events.js";
import { spawnRun } from "./automation.engine.js";

const log = child("automation-sub");

let started = false;

export function startAutomationSubscribers() {
  if (started) return;
  started = true;

  on(Events.LEAD_CREATED, async (payload) => {
    await fanOutToAutomations("NEW_LEAD", payload);
  });
  on(Events.LEAD_STAGE_CHANGED, async (payload) => {
    await fanOutToAutomations("STAGE_CHANGED", payload);
  });
  on(Events.LEAD_ASSIGNED, async (payload) => {
    await fanOutToAutomations("LEAD_ASSIGNED", payload);
  });
  on(Events.LEAD_FOLLOWUP_SENT, async (payload) => {
    await fanOutToAutomations("NO_REPLY", payload);
  });

  log.info("automation subscribers started");
}

async function fanOutToAutomations(trigger, payload) {
  if (!payload?.tenantId) return;
  const automations = await prisma.automation.findMany({
    where: {
      tenantId: payload.tenantId,
      trigger,
      isActive: true,
    },
  });
  for (const a of automations) {
    try {
      await spawnRun(a, payload);
    } catch (err) {
      log.error("spawn failed", { automationId: a.id, err: err.message });
    }
  }
}
