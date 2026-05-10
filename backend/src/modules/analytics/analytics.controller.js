import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { getCampaignBreakdown, getOverview, periodSince } from "./analytics.service.js";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "all"]);

export const overview = asyncHandler(async (req, res) => {
  const period = String(req.query.period || "7d");
  if (!VALID_PERIODS.has(period)) throw BadRequest("period must be 24h | 7d | 30d | all");
  const tenantId = await getDefaultTenantId();
  const since = periodSince(period);
  const [ov, byCampaign] = await Promise.all([
    getOverview(tenantId, period),
    getCampaignBreakdown(tenantId, period),
  ]);
  res.json({
    period,
    since: since ? since.toISOString() : null,
    overview: ov,
    by_campaign: byCampaign,
  });
});
