// Subscribe to domain events and emit in-app notifications for users who
// care about the event. Loaded at boot in both the API and worker
// processes so events from either side land in the DB.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { Events, on } from "../../shared/events.js";
import { createNotification } from "./notification.service.js";

const log = child("notification-sub");

let started = false;

export function startNotificationSubscribers() {
  if (started) return;
  started = true;

  // Lead assignment → notify the new assignee.
  on(Events.LEAD_ASSIGNED, async ({ leadId, tenantId, toUserId, fromUserId, actorId }) => {
    if (!toUserId || toUserId === actorId) return; // don't notify yourself
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { contact: { select: { firstName: true, lastName: true, mobile: true } } },
    });
    if (!lead) return;
    const name = [lead.contact?.firstName, lead.contact?.lastName].filter(Boolean).join(" ")
      || lead.contact?.mobile
      || "(no name)";
    await createNotification({
      tenantId,
      userId: toUserId,
      kind: "LEAD_ASSIGNED",
      title: `Lead assigned: ${name}`,
      body: fromUserId
        ? `Reassigned to you.`
        : `Assigned to you.`,
      leadId,
      url: `/leads/${leadId}`,
    });
  });

  // Lead created with an immediate assignee → same notification.
  on(Events.LEAD_CREATED, async ({ leadId, tenantId, assignedToId, actorId }) => {
    if (!assignedToId || assignedToId === actorId) return;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { contact: { select: { firstName: true, lastName: true, mobile: true } } },
    });
    if (!lead) return;
    const name = [lead.contact?.firstName, lead.contact?.lastName].filter(Boolean).join(" ")
      || lead.contact?.mobile
      || "(no name)";
    await createNotification({
      tenantId,
      userId: assignedToId,
      kind: "LEAD_CREATED",
      title: `New lead assigned: ${name}`,
      leadId,
      url: `/leads/${leadId}`,
    });
  });

  // Follow-up fired → notify the lead's owner (assignedTo) so they know
  // the reminder is in flight. Quiet but informative.
  on(Events.LEAD_FOLLOWUP_SENT, async ({ leadId, tenantId, ruleId }) => {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        assignedToId: true,
        contact: { select: { firstName: true, lastName: true, mobile: true } },
      },
    });
    if (!lead?.assignedToId) return;
    const name = [lead.contact?.firstName, lead.contact?.lastName].filter(Boolean).join(" ")
      || lead.contact?.mobile
      || "(no name)";
    const rule = await prisma.followupRule.findUnique({
      where: { id: ruleId },
      select: { name: true },
    });
    await createNotification({
      tenantId,
      userId: lead.assignedToId,
      kind: "FOLLOWUP_SENT",
      title: `Follow-up sent to ${name}`,
      body: rule?.name ? `Rule: ${rule.name}` : null,
      leadId,
      url: `/leads/${leadId}`,
    });
  });

  log.info("notification subscribers started");
}
