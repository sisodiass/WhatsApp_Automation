import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  create,
  createStageRoute,
  deleteStageRoute,
  getOne,
  listAll,
  patch,
  patchStageRoute,
  remove,
  reorderStagesRoute,
} from "./pipeline.controller.js";

const ADMIN = ["SUPER_ADMIN", "ADMIN"];

export const pipelineRouter = Router();
pipelineRouter.use(requireAuth);
pipelineRouter.get("/", listAll);
pipelineRouter.get("/:id", getOne);
pipelineRouter.post("/", requireRole(...ADMIN), create);
pipelineRouter.patch("/:id", requireRole(...ADMIN), patch);
pipelineRouter.delete("/:id", requireRole(...ADMIN), remove);

// Stage routes nested under the pipeline.
pipelineRouter.post("/:pipelineId/stages", requireRole(...ADMIN), createStageRoute);
pipelineRouter.post("/:pipelineId/stages/reorder", requireRole(...ADMIN), reorderStagesRoute);
pipelineRouter.patch("/:pipelineId/stages/:stageId", requireRole(...ADMIN), patchStageRoute);
pipelineRouter.delete("/:pipelineId/stages/:stageId", requireRole(...ADMIN), deleteStageRoute);
