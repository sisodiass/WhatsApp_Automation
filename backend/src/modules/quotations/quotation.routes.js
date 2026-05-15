import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  accept,
  aiDraft,
  create,
  decideApprovalCtrl,
  getOne,
  list,
  patch,
  pdfCtrl,
  reject,
  remove,
  requestApprovalCtrl,
  revise,
  send,
} from "./quotation.controller.js";

const WRITE = ["SUPER_ADMIN", "ADMIN", "AGENT"];
const ADMIN = ["SUPER_ADMIN", "ADMIN"];

export const quotationRouter = Router();
quotationRouter.use(requireAuth);

// AI-seam mounted BEFORE :id routes so the path is unambiguous.
quotationRouter.post("/ai-draft", requireRole(...ADMIN), aiDraft);

quotationRouter.get("/", list);
quotationRouter.get("/:id", getOne);
quotationRouter.get("/:id/pdf", pdfCtrl);

quotationRouter.post("/", requireRole(...WRITE), create);
quotationRouter.patch("/:id", requireRole(...WRITE), patch);
quotationRouter.delete("/:id", requireRole(...WRITE), remove);

quotationRouter.post("/:id/send", requireRole(...WRITE), send);
quotationRouter.post("/:id/accept", requireRole(...WRITE), accept);
quotationRouter.post("/:id/reject", requireRole(...WRITE), reject);
quotationRouter.post("/:id/revise", requireRole(...WRITE), revise);

quotationRouter.post("/:id/approvals", requireRole(...WRITE), requestApprovalCtrl);
quotationRouter.post(
  "/:id/approvals/:approvalId/decide",
  requireRole(...ADMIN),
  decideApprovalCtrl,
);
