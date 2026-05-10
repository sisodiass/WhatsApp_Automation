import { Server } from "socket.io";
import { config } from "../config/index.js";
import { child } from "./logger.js";
import { verifyAccessToken } from "../modules/auth/auth.service.js";

const log = child("socket");

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.frontendUrl,
      credentials: true,
    },
  });

  // JWT handshake. Frontend connects with `io({ auth: { token } })`.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("missing token"));
    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      socket.data.tenantId = payload.tid;
      next();
    } catch {
      next(new Error("invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const { userId, role } = socket.data;
    log.debug("client connected", { id: socket.id, userId, role });

    // Anyone authenticated joins the admins room. Roles are still enforced
    // at the REST layer; the room just gates broadcast targets.
    socket.join("admins");

    socket.on("disconnect", (reason) => {
      log.debug("client disconnected", { id: socket.id, reason });
    });
  });

  return io;
}

export function getIo() {
  if (!io) throw new Error("Socket.io not initialized — call initSocket() first");
  return io;
}

export function emitToAdmins(event, payload) {
  if (!io) return;
  io.to("admins").emit(event, payload);
}

// Convenience: a single message landed in a chat. The frontend filters
// by chatId so a single broadcast covers every open chat-detail page.
export function emitChatMessage(message) {
  if (!io || !message) return;
  io.to("admins").emit("chat:message", {
    id: message.id,
    chatId: message.chatId, // caller may inject; otherwise the consumer reads it via session
    sessionId: message.sessionId,
    direction: message.direction,
    source: message.source,
    body: message.body,
    confidence: message.confidence ?? null,
    createdAt: message.createdAt,
    sentAt: message.sentAt ?? null,
  });
}

export function emitSessionUpdate(sessionId, patch) {
  if (!io) return;
  io.to("admins").emit("session:update", { sessionId, ...patch });
}
