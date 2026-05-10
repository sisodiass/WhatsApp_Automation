import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { book, status } from "./demo.controller.js";

export const demoRouter = Router();
demoRouter.use(requireAuth);

const ACTOR = ["SUPER_ADMIN", "ADMIN", "AGENT"];

demoRouter.get("/teams/status", status);
demoRouter.post("/chats/:chatId/demo", requireRole(...ACTOR), book);
