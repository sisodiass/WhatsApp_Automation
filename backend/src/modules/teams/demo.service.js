import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { emitChatMessage, emitSessionUpdate } from "../../shared/socket.js";
import { renderTemplate } from "../templates/template.service.js";
import { enqueueOutbound } from "../queue/producers.js";
import { createTeamsMeeting } from "./teams.service.js";

const log = child("demo");

export async function bookDemo({ tenantId, chatId, scheduledAt, durationMinutes = 30, subject }) {
  const when = new Date(scheduledAt);
  if (isNaN(when.getTime())) throw BadRequest("scheduledAt must be a valid datetime");
  if (when.getTime() < Date.now() - 60_000) throw BadRequest("scheduledAt must be in the future");

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      sessions: { where: { endedAt: null }, orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  if (!chat || chat.tenantId !== tenantId) throw NotFound("chat not found");
  const session = chat.sessions[0];
  if (!session) throw BadRequest("chat has no active session");

  // 1. Create the Teams meeting (or stub).
  const meeting = await createTeamsMeeting({
    scheduledAt: when,
    durationMinutes,
    subject: subject || `Demo with ${chat.displayName || chat.phone}`,
  });

  // 2. Persist the booking + flip session to DEMO_PENDING in one transaction.
  const booking = await prisma.$transaction(async (tx) => {
    const b = await tx.demoBooking.create({
      data: {
        chatId,
        teamsMeetingId: meeting.id,
        teamsJoinUrl: meeting.joinUrl,
        scheduledAt: when,
      },
    });
    await tx.chatSession.update({
      where: { id: session.id },
      data: { state: "DEMO_PENDING" },
    });
    return b;
  });

  emitSessionUpdate(session.id, { state: "DEMO_PENDING" });

  // 3. Send confirmation message via the templates engine.
  const text = await renderTemplate(tenantId, "DEMO_CONFIRMATION", {
    scheduled_at: when.toLocaleString(),
    join_url: meeting.joinUrl || "(link will follow)",
  });
  if (text) {
    const out = await prisma.message.create({
      data: {
        sessionId: session.id,
        direction: "OUT",
        source: "SYSTEM",
        body: text,
        kbChunkIds: [],
      },
    });
    emitChatMessage({ ...out, chatId });
    await enqueueOutbound(out.id, { delayMs: 0 });
  }

  log.info("demo booked", {
    chatId,
    sessionId: session.id,
    bookingId: booking.id,
    stub: meeting.stub,
    when: when.toISOString(),
  });

  return { booking, meeting };
}
