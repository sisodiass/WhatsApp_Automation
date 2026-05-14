import { asyncHandler, Unauthorized } from "../../shared/errors.js";
import {
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
} from "./notification.service.js";

// requireAuth sets req.auth = { userId, role, tenantId }. The rest of
// the codebase reads req.auth.userId for the same purpose.
function userId(req) {
  if (!req.auth?.userId) throw Unauthorized("no user");
  return req.auth.userId;
}

export const list = asyncHandler(async (req, res) => {
  const items = await listNotifications(userId(req), {
    limit: req.query.limit,
    unreadOnly: req.query.unreadOnly === "true",
  });
  res.json({ items });
});

export const unreadCount = asyncHandler(async (req, res) => {
  const count = await countUnread(userId(req));
  res.json({ count });
});

export const read = asyncHandler(async (req, res) => {
  const item = await markRead(userId(req), req.params.id);
  res.json(item);
});

export const readAll = asyncHandler(async (req, res) => {
  const r = await markAllRead(userId(req));
  res.json(r);
});
