// Workflow Automation engine.
//
// Two responsibilities:
//   1. spawnRun(automation, payload) — called by the event subscriber.
//      Validates the trigger filter against the payload, creates an
//      AutomationRun row, enqueues the first step.
//   2. executeNextStep(runId) — called by the automation-runs worker.
//      Loads the run + automation, picks the step at currentStep,
//      executes it, persists state, then either reschedules the next
//      step or marks the run DONE/FAILED.
//
// Step types are pure data; the executor here is the source of truth.
// Step output (e.g. messageId from SEND_MESSAGE) is merged into the
// run's context so later IF conditions can see it.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { interpolate } from "../templates/template.service.js";
import {
  buildContactVars,
  buildStandardVars,
} from "../templates/variables.js";
import { enqueueOutbound, enqueueAutomationStep } from "../queue/producers.js";

const log = child("automation");

// ─── Trigger filter ─────────────────────────────────────────────────
// Returns true if `payload` matches `automation.triggerConfig`. Each
// trigger gets its own narrow set of supported filter keys.

export function matchesTrigger(automation, payload) {
  const cfg = automation.triggerConfig || {};
  if (Object.keys(cfg).length === 0) return true;

  switch (automation.trigger) {
    case "NEW_LEAD":
      // payload: { leadId, tenantId, contactId, assignedToId?, actorId? }
      // No lead loading here — the filter operates on payload only.
      return true; // v1: no per-event filter for NEW_LEAD; future: source, pipelineId
    case "STAGE_CHANGED":
      // payload: { leadId, tenantId, fromStageId?, toStageId, actorId? }
      if (cfg.toStageId && payload.toStageId !== cfg.toStageId) return false;
      if (cfg.fromStageId && payload.fromStageId !== cfg.fromStageId) return false;
      return true;
    case "NO_REPLY":
      // payload: { leadId, tenantId, ruleId, messageId }
      if (cfg.ruleId && payload.ruleId !== cfg.ruleId) return false;
      return true;
    default:
      return true;
  }
}

// ─── Spawn ──────────────────────────────────────────────────────────

export async function spawnRun(automation, payload) {
  if (!automation.isActive) return null;
  if (!matchesTrigger(automation, payload)) return null;

  const run = await prisma.automationRun.create({
    data: {
      automationId: automation.id,
      leadId: payload.leadId ?? null,
      chatId: payload.chatId ?? null,
      contactId: payload.contactId ?? null,
      status: "PENDING",
      currentStep: 0,
      // Seed context with the trigger payload so steps can reference it.
      context: { trigger: automation.trigger, payload },
    },
  });

  await enqueueAutomationStep(run.id, 0);
  log.info("spawned automation run", {
    automationId: automation.id,
    runId: run.id,
    leadId: payload.leadId,
  });
  return run;
}

// ─── Step executor ──────────────────────────────────────────────────

export async function executeNextStep(runId) {
  const run = await prisma.automationRun.findUnique({
    where: { id: runId },
    include: { automation: true },
  });
  if (!run) return { skipped: "missing_run" };
  if (run.status === "DONE" || run.status === "CANCELLED" || run.status === "FAILED") {
    return { skipped: `terminal_${run.status}` };
  }

  const def = run.automation.definition || {};
  const steps = Array.isArray(def.steps) ? def.steps : [];

  if (run.currentStep >= steps.length) {
    return finishRun(runId, "DONE");
  }

  const step = steps[run.currentStep];
  // Mark RUNNING during step execution (cleared to WAITING when WAIT
  // reschedules, or back to RUNNING for synchronous steps).
  await prisma.automationRun.update({
    where: { id: runId },
    data: { status: "RUNNING" },
  });

  try {
    const result = await runStep(step, run);

    if (result?.kind === "wait") {
      // WAIT: persist new currentStep + flip to WAITING + reschedule.
      const nextStep = run.currentStep + 1;
      await prisma.automationRun.update({
        where: { id: runId },
        data: { status: "WAITING", currentStep: nextStep },
      });
      await enqueueAutomationStep(runId, nextStep, { delayMs: result.delayMs });
      return { waited: result.delayMs };
    }

    if (result?.kind === "end") {
      // IF guard failed → END the run cleanly.
      return finishRun(runId, "DONE");
    }

    // Synchronous step: merge any output into context, advance, enqueue.
    const ctxPatch = result?.contextPatch || {};
    const nextStep = run.currentStep + 1;
    await prisma.automationRun.update({
      where: { id: runId },
      data: {
        currentStep: nextStep,
        context: { ...(run.context || {}), ...ctxPatch },
      },
    });
    if (nextStep >= steps.length) {
      return finishRun(runId, "DONE");
    }
    await enqueueAutomationStep(runId, nextStep);
    return { ok: true, advanced: nextStep };
  } catch (err) {
    log.error("step failed", { runId, step: step?.type, err: err.message });
    return finishRun(runId, "FAILED", err.message);
  }
}

async function finishRun(runId, status, error) {
  await prisma.automationRun.update({
    where: { id: runId },
    data: { status, finishedAt: new Date(), error: error?.slice(0, 500) ?? null },
  });
  return { finished: status };
}

// ─── Step implementations ───────────────────────────────────────────

async function runStep(step, run) {
  if (!step || typeof step !== "object" || !step.type) {
    throw new Error("step missing 'type'");
  }
  switch (step.type) {
    case "WAIT":
      return doWait(step);
    case "SEND_MESSAGE":
      return doSendMessage(step, run);
    case "ASSIGN":
      return doAssign(step, run);
    case "ADD_TAG":
      return doAddTag(step, run);
    case "MOVE_STAGE":
      return doMoveStage(step, run);
    case "CREATE_TASK":
      return doCreateTask(step, run);
    case "IF":
      return doIf(step, run);
    case "CREATE_QUOTATION":
      return doCreateQuotation(step, run);
    case "SEND_PAYMENT_LINK":
      return doSendPaymentLink(step, run);
    default:
      throw new Error(`unknown step type: ${step.type}`);
  }
}

function doWait(step) {
  const minutes = Number(step.minutes);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error("WAIT.minutes must be a non-negative number");
  }
  // BullMQ delay caps at int32 ms; we clamp to 24h × 30 = 30 days max.
  const ms = Math.min(minutes * 60_000, 30 * 24 * 3600 * 1000);
  return { kind: "wait", delayMs: ms };
}

async function doSendMessage(step, run) {
  if (!step.templateName) throw new Error("SEND_MESSAGE.templateName required");
  if (!run.leadId) throw new Error("SEND_MESSAGE requires a leadId on the run");

  const lead = await prisma.lead.findUnique({
    where: { id: run.leadId },
    include: {
      contact: { include: { chats: { take: 1, orderBy: { lastMessageAt: "desc" } } } },
      stage: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });
  if (!lead) throw new Error("lead not found");
  const chat = lead.contact?.chats?.[0];
  if (!chat) throw new Error("contact has no chat — cannot send");

  const tpl = await prisma.messageTemplate.findFirst({
    where: { tenantId: run.automation.tenantId, name: step.templateName, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!tpl) throw new Error(`template "${step.templateName}" not found / inactive`);

  const vars = {
    ...buildStandardVars(),
    ...buildContactVars(lead.contact),
    lead_source: lead.source ?? "",
    lead_stage: lead.stage?.name ?? "",
    lead_status: lead.stage?.name ?? "",
    assigned_agent: lead.assignedTo?.name ?? "",
    expected_value: lead.expectedValue ? String(lead.expectedValue) : "",
    currency: lead.currency ?? "",
  };
  const body = interpolate(tpl.content, vars);

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

  // Write an AUTOMATION activity for the timeline.
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      kind: "AUTOMATION",
      messageId: msg.id,
      data: {
        event: "send_message",
        automationId: run.automationId,
        templateName: step.templateName,
      },
    },
  });

  await enqueueOutbound(msg.id);
  return { kind: "ok", contextPatch: { lastMessageId: msg.id } };
}

async function doAssign(step, run) {
  if (!step.userId) throw new Error("ASSIGN.userId required");
  if (!run.leadId) throw new Error("ASSIGN requires a leadId on the run");
  await prisma.lead.update({
    where: { id: run.leadId },
    data: { assignedToId: step.userId },
  });
  await prisma.leadActivity.create({
    data: {
      leadId: run.leadId,
      kind: "ASSIGNMENT",
      data: { event: "automation_assign", automationId: run.automationId, userId: step.userId },
    },
  });
  return { kind: "ok" };
}

async function doAddTag(step, run) {
  if (!step.tagId) throw new Error("ADD_TAG.tagId required");
  if (!run.leadId) throw new Error("ADD_TAG requires a leadId on the run");
  const lead = await prisma.lead.findUnique({
    where: { id: run.leadId },
    include: { contact: { include: { chats: true } } },
  });
  if (!lead) throw new Error("lead not found");
  // Idempotent: upsert via the composite key.
  for (const chat of lead.contact?.chats || []) {
    await prisma.chatTag.upsert({
      where: { chatId_tagId: { chatId: chat.id, tagId: step.tagId } },
      create: { chatId: chat.id, tagId: step.tagId },
      update: {},
    });
  }
  await prisma.leadActivity.create({
    data: {
      leadId: run.leadId,
      kind: "TAG_CHANGE",
      data: { event: "automation_add_tag", automationId: run.automationId, tagId: step.tagId },
    },
  });
  return { kind: "ok" };
}

async function doMoveStage(step, run) {
  if (!step.stageId) throw new Error("MOVE_STAGE.stageId required");
  if (!run.leadId) throw new Error("MOVE_STAGE requires a leadId on the run");
  // Re-use the lead service so domain events (LEAD_STAGE_CHANGED) fire
  // and the wonAt/lostAt logic is centralized.
  const { moveLeadStage } = await import("../leads/lead.service.js");
  await moveLeadStage(run.automation.tenantId, run.leadId, step.stageId, null);
  return { kind: "ok" };
}

async function doCreateTask(step, run) {
  if (!step.title?.trim()) throw new Error("CREATE_TASK.title required");
  if (!run.leadId) throw new Error("CREATE_TASK requires a leadId on the run");
  const dueAt = step.daysOut
    ? new Date(Date.now() + Number(step.daysOut) * 24 * 3600 * 1000)
    : step.dueAt
    ? new Date(step.dueAt)
    : null;
  const task = await prisma.task.create({
    data: {
      tenantId: run.automation.tenantId,
      leadId: run.leadId,
      title: step.title.trim(),
      description: step.description ?? null,
      dueAt,
      assignedToId: step.assignedToId ?? null,
    },
  });
  await prisma.leadActivity.create({
    data: {
      leadId: run.leadId,
      kind: "TASK",
      taskId: task.id,
      data: { event: "automation_create_task", automationId: run.automationId },
    },
  });
  return { kind: "ok", contextPatch: { lastTaskId: task.id } };
}

// M11: CREATE_QUOTATION — creates a DRAFT quotation tied to the run's
// lead. Step shape: { type, lineItems: [...], terms?, notes? }. The lead's
// contact is resolved automatically. The new quote id lands in context for
// downstream steps to reference.
async function doCreateQuotation(step, run) {
  if (!run.leadId) throw new Error("CREATE_QUOTATION requires a leadId");
  if (!Array.isArray(step.lineItems) || step.lineItems.length === 0) {
    throw new Error("CREATE_QUOTATION.lineItems required");
  }
  const lead = await prisma.lead.findUnique({ where: { id: run.leadId } });
  if (!lead) throw new Error("lead not found");
  const { createQuotation } = await import("../quotations/quotation.service.js");
  const quote = await createQuotation(run.automation.tenantId, {
    contactId: lead.contactId,
    leadId: lead.id,
    lineItems: step.lineItems,
    terms: step.terms ?? null,
    notes: step.notes ?? null,
  });
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      kind: "AUTOMATION",
      data: {
        event: "create_quotation",
        automationId: run.automationId,
        quotationId: quote.id,
      },
    },
  });
  return { kind: "ok", contextPatch: { lastQuotationId: quote.id } };
}

// M11: SEND_PAYMENT_LINK — creates a payment link for the run's lead /
// quotation. Step shape: { type, amount?, currency?, quotationId?,
// description? }. If amount/currency are omitted and a quotationId
// (either explicit or via context.lastQuotationId) is present, we read
// grandTotal from the quote.
async function doSendPaymentLink(step, run) {
  if (!run.leadId) throw new Error("SEND_PAYMENT_LINK requires a leadId");
  const lead = await prisma.lead.findUnique({ where: { id: run.leadId } });
  if (!lead) throw new Error("lead not found");

  const ctx = run.context || {};
  let quotationId = step.quotationId || ctx.lastQuotationId || null;
  let amount = step.amount;
  let currency = step.currency;

  if (!amount || !currency) {
    if (!quotationId) {
      throw new Error("SEND_PAYMENT_LINK needs amount+currency or a quotationId");
    }
    const q = await prisma.quotation.findFirst({
      where: { id: quotationId, tenantId: run.automation.tenantId, deletedAt: null },
    });
    if (!q) throw new Error("quotation not found for link");
    amount = amount ?? Number(q.grandTotal);
    currency = currency ?? q.currency;
  }

  const { createPaymentLink } = await import("../payments/payment.service.js");
  const link = await createPaymentLink(run.automation.tenantId, {
    contactId: lead.contactId,
    leadId: lead.id,
    quotationId,
    amount,
    currency,
    description: step.description || "Payment",
  });
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      kind: "AUTOMATION",
      data: {
        event: "send_payment_link",
        automationId: run.automationId,
        paymentLinkId: link.id,
      },
    },
  });
  return { kind: "ok", contextPatch: { lastPaymentLinkId: link.id } };
}

// IF: a guard. If the condition resolves true, the run continues to
// the next step. If false, the run ENDS cleanly (DONE, not FAILED).
async function doIf(step, run) {
  const cond = String(step.condition || "");
  const ok = await evaluateCondition(cond, run);
  if (!ok) return { kind: "end" };
  return { kind: "ok" };
}

// Conditions are tiny strings parsed here. v1 supports:
//   "no_reply:<hours>"   — true if contact's chat has had no inbound in N hours
//   "has_tag:<tagId>"    — true if any of the contact's chats carry the tag
//   "stage_is:<stageId>" — true if lead is currently in the stage
async function evaluateCondition(cond, run) {
  if (!cond) return true; // no condition → vacuous truth

  const [name, arg] = cond.split(":");
  if (name === "no_reply" && run.leadId) {
    const hours = Number(arg) || 24;
    const since = new Date(Date.now() - hours * 3600_000);
    const lead = await prisma.lead.findUnique({
      where: { id: run.leadId },
      include: { contact: { include: { chats: { take: 1, orderBy: { lastMessageAt: "desc" } } } } },
    });
    const chat = lead?.contact?.chats?.[0];
    if (!chat) return true;
    // True if the most recent INBOUND message is older than the window
    // (or none exists at all).
    const lastInbound = await prisma.message.findFirst({
      where: { session: { chatId: chat.id }, direction: "IN" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return !lastInbound || lastInbound.createdAt < since;
  }

  if (name === "has_tag" && run.leadId && arg) {
    const lead = await prisma.lead.findUnique({
      where: { id: run.leadId },
      include: { contact: { include: { chats: { include: { tags: true } } } } },
    });
    return (lead?.contact?.chats || []).some((c) =>
      c.tags.some((t) => t.tagId === arg),
    );
  }

  if (name === "stage_is" && run.leadId && arg) {
    const lead = await prisma.lead.findUnique({
      where: { id: run.leadId },
      select: { stageId: true },
    });
    return lead?.stageId === arg;
  }

  log.warn("unknown condition", { cond });
  return true; // unknown conditions don't block (fail open for v1)
}
