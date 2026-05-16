import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  agentProductivity,
  automations,
  bulk,
  burndown,
  followups,
  funnel,
  overview,
  sources,
  sourcesRoi,
} from "./analytics.controller.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);
analyticsRouter.get("/overview", overview);
// M8 advanced rollups
analyticsRouter.get("/sources", sources);
analyticsRouter.get("/funnel", funnel);
analyticsRouter.get("/bulk", bulk);
analyticsRouter.get("/followups", followups);
analyticsRouter.get("/automations", automations);
// M11.D4 advanced analytics
analyticsRouter.get("/sources-roi", sourcesRoi);
analyticsRouter.get("/burndown", burndown);
analyticsRouter.get("/agent-productivity", agentProductivity);
