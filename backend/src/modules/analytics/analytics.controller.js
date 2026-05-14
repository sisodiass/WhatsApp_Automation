import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  getAutomationPerformance,
  getBulkRollup,
  getCampaignBreakdown,
  getFollowupPerformance,
  getOverview,
  getPipelineFunnel,
  getSourceBreakdown,
  periodSince,
} from "./analytics.service.js";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "all"]);

function parsePeriod(req, fallback = "7d") {
  const p = String(req.query.period || fallback);
  if (!VALID_PERIODS.has(p)) throw BadRequest("period must be 24h | 7d | 30d | all");
  return p;
}

export const overview = asyncHandler(async (req, res) => {
  const period = parsePeriod(req);
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

export const sources = asyncHandler(async (req, res) => {
  const period = parsePeriod(req, "30d");
  const tenantId = await getDefaultTenantId();
  const items = await getSourceBreakdown(tenantId, period);
  res.json({ period, items });
});

export const funnel = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const data = await getPipelineFunnel(tenantId, req.query.pipelineId?.toString());
  res.json(data);
});

export const bulk = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await getBulkRollup(tenantId);
  res.json({ items });
});

export const followups = asyncHandler(async (req, res) => {
  const period = parsePeriod(req, "30d");
  const tenantId = await getDefaultTenantId();
  const items = await getFollowupPerformance(tenantId, period);
  res.json({ period, items });
});

export const automations = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await getAutomationPerformance(tenantId);
  res.json({ items });
});
