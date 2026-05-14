import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  create,
  list,
  patch,
  preview,
  remove,
  variables,
} from "./template.controller.js";

export const templateRouter = Router();
templateRouter.use(requireAuth);

// Variables registry + live preview — declared BEFORE the :id routes so
// neither path can be shadowed.
templateRouter.get("/variables", variables);
templateRouter.post("/preview", preview);

templateRouter.get("/", list);
templateRouter.post("/", requireRole("SUPER_ADMIN", "ADMIN"), create);
templateRouter.patch("/:id", requireRole("SUPER_ADMIN", "ADMIN"), patch);
templateRouter.delete("/:id", requireRole("SUPER_ADMIN", "ADMIN"), remove);
