import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { list, read, readAll, unreadCount } from "./notification.controller.js";

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

// "/unread-count" + "/read-all" before ":id" so they aren't shadowed.
notificationRouter.get("/unread-count", unreadCount);
notificationRouter.post("/read-all", readAll);
notificationRouter.get("/", list);
notificationRouter.post("/:id/read", read);
