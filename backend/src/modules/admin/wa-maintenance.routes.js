import { Router } from "express";
import { asyncHandler } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { refreshLidContacts } from "./wa-maintenance.service.js";

// Mounted under /api/admin. SUPER_ADMIN + ADMIN only — these endpoints
// reach into the live WhatsApp worker session and modify CRM rows.

export const waMaintenanceRouter = Router();

waMaintenanceRouter.use(requireAuth);
waMaintenanceRouter.use(requireRole("SUPER_ADMIN", "ADMIN"));

waMaintenanceRouter.post(
  "/refresh-lid-contacts",
  asyncHandler(async (req, res) => {
    const tenantId = await getDefaultTenantId();
    const limit = Number(req.body?.limit) || undefined;
    const result = await refreshLidContacts(tenantId, { limit });
    res.json(result);
  }),
);
