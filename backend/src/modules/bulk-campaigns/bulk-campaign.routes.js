import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  addRecipients,
  analytics,
  approve,
  cancel,
  create,
  deleteRecipient,
  getOne,
  list,
  patch,
  pause,
  previewAudience,
  recipients,
  remove,
  resume,
  submit,
} from "./bulk-campaign.controller.js";

const WRITE = ["SUPER_ADMIN", "ADMIN"]; // bulk sends are admin-only
const VIEW = ["SUPER_ADMIN", "ADMIN", "AGENT", "VIEWER"];

export const bulkCampaignRouter = Router();
bulkCampaignRouter.use(requireAuth);

// Read endpoints
bulkCampaignRouter.get("/", requireRole(...VIEW), list);
bulkCampaignRouter.get("/:id", requireRole(...VIEW), getOne);
bulkCampaignRouter.get("/:id/recipients", requireRole(...VIEW), recipients);
bulkCampaignRouter.get("/:id/analytics", requireRole(...VIEW), analytics);

// Write endpoints — admin only
bulkCampaignRouter.post("/", requireRole(...WRITE), create);
bulkCampaignRouter.patch("/:id", requireRole(...WRITE), patch);
bulkCampaignRouter.delete("/:id", requireRole(...WRITE), remove);

// Audience
bulkCampaignRouter.post("/:id/recipients", requireRole(...WRITE), addRecipients);
bulkCampaignRouter.post("/:id/audience/preview", requireRole(...WRITE), previewAudience);
bulkCampaignRouter.delete("/:id/recipients/:recipientId", requireRole(...WRITE), deleteRecipient);

// Lifecycle transitions
bulkCampaignRouter.post("/:id/submit", requireRole(...WRITE), submit);
bulkCampaignRouter.post("/:id/approve", requireRole(...WRITE), approve);
bulkCampaignRouter.post("/:id/pause", requireRole(...WRITE), pause);
bulkCampaignRouter.post("/:id/resume", requireRole(...WRITE), resume);
bulkCampaignRouter.post("/:id/cancel", requireRole(...WRITE), cancel);
