import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  createGroup,
  deleteGroup,
  getGroup,
  listDocs,
  listGroups,
  patchGroup,
  reembedAll,
  removeDocument,
  reprocessDocument,
  uploadDocument,
  uploadMiddleware,
} from "./kb.controller.js";

export const kbRouter = Router();

kbRouter.use(requireAuth);

// Groups
kbRouter.get("/groups", listGroups);
kbRouter.get("/groups/:id", getGroup);
kbRouter.post("/groups", requireRole("SUPER_ADMIN", "ADMIN"), createGroup);
kbRouter.patch("/groups/:id", requireRole("SUPER_ADMIN", "ADMIN"), patchGroup);
kbRouter.delete("/groups/:id", requireRole("SUPER_ADMIN", "ADMIN"), deleteGroup);

// Documents within a group
kbRouter.get("/groups/:id/documents", listDocs);
kbRouter.post(
  "/groups/:id/documents",
  requireRole("SUPER_ADMIN", "ADMIN"),
  uploadMiddleware,
  uploadDocument,
);
kbRouter.delete(
  "/documents/:docId",
  requireRole("SUPER_ADMIN", "ADMIN"),
  removeDocument,
);
kbRouter.post(
  "/documents/:docId/reprocess",
  requireRole("SUPER_ADMIN", "ADMIN"),
  reprocessDocument,
);

// Bulk re-embed for the active AI provider. Use after a provider/model
// switch. Idempotent: each enqueue uses jobId="pdf-<docId>".
kbRouter.post("/groups/:id/reembed", requireRole("SUPER_ADMIN", "ADMIN"), reembedAll);
kbRouter.post("/reembed", requireRole("SUPER_ADMIN", "ADMIN"), reembedAll);
