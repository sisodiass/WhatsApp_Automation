import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  create,
  fire,
  getOne,
  list,
  patch,
  remove,
  runs,
} from "./automation.controller.js";

const ADMIN = ["SUPER_ADMIN", "ADMIN"];
const VIEW = ["SUPER_ADMIN", "ADMIN", "AGENT", "VIEWER"];

export const automationRouter = Router();
automationRouter.use(requireAuth);

// "/runs" sits above ":id" so the matcher doesn't shadow it.
automationRouter.get("/runs", requireRole(...VIEW), runs);
automationRouter.get("/", requireRole(...VIEW), list);
automationRouter.get("/:id", requireRole(...VIEW), getOne);
automationRouter.post("/", requireRole(...ADMIN), create);
automationRouter.patch("/:id", requireRole(...ADMIN), patch);
automationRouter.delete("/:id", requireRole(...ADMIN), remove);
automationRouter.post("/:id/fire", requireRole(...ADMIN), fire);
