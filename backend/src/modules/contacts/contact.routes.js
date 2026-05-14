import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  create,
  exportFile,
  fields,
  getOne,
  importFile,
  importUploadMiddleware,
  list,
  patch,
  remove,
  renameSourceCtrl,
  sources,
} from "./contact.controller.js";

const WRITE = ["SUPER_ADMIN", "ADMIN", "AGENT"];
const ADMIN = ["SUPER_ADMIN", "ADMIN"];

export const contactRouter = Router();
contactRouter.use(requireAuth);

// Import + export sit ABOVE :id routes so the path matcher doesn't
// shadow them.
contactRouter.get("/fields", fields);
contactRouter.get("/export", exportFile);
contactRouter.post(
  "/import",
  requireRole(...ADMIN),
  importUploadMiddleware,
  importFile,
);
// Sources master — list any non-null `source` value across contacts +
// leads with counts; rename does a transactional bulk update across
// both tables.
contactRouter.get("/sources", sources);
contactRouter.post("/sources/rename", requireRole(...ADMIN), renameSourceCtrl);

contactRouter.get("/", list);
contactRouter.get("/:id", getOne);
contactRouter.post("/", requireRole(...WRITE), create);
contactRouter.patch("/:id", requireRole(...WRITE), patch);
contactRouter.delete("/:id", requireRole(...ADMIN), remove);
