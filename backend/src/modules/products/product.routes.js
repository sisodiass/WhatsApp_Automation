import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  create,
  createRule,
  getOne,
  list,
  listRules,
  patch,
  patchRule,
  remove,
  removeRule,
} from "./product.controller.js";

const ADMIN = ["SUPER_ADMIN", "ADMIN"];

export const productRouter = Router();
productRouter.use(requireAuth);

productRouter.get("/", list);
productRouter.get("/:id", getOne);
productRouter.post("/", requireRole(...ADMIN), create);
productRouter.patch("/:id", requireRole(...ADMIN), patch);
productRouter.delete("/:id", requireRole(...ADMIN), remove);

export const pricingRuleRouter = Router();
pricingRuleRouter.use(requireAuth, requireRole(...ADMIN));
pricingRuleRouter.get("/", listRules);
pricingRuleRouter.post("/", createRule);
pricingRuleRouter.patch("/:id", patchRule);
pricingRuleRouter.delete("/:id", removeRule);
