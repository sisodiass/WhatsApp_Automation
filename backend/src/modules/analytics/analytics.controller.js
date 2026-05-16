import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  getAgentProductivity,
  getAutomationPerformance,
  getBulkRollup,
  getCampaignBreakdown,
  getFollowupPerformance,
  getOverview,
  getPipelineBurndown,
  getPipelineFunnel,
  getSourceBreakdown,
  getSourceRoi,
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

// M11.D4: revenue-aware source breakdown.
export const sourcesRoi = asyncHandler(async (req, res) => {
  const period = parsePeriod(req, "30d");
  const tenantId = await getDefaultTenantId();
  const items = await getSourceRoi(tenantId, period);
  res.json({ period, items });
});

// M11.D4: pipeline burndown — daily stage counts over a window.
export const burndown = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const days = Math.min(90, Math.max(7, Number(req.query.days || 30)));
  const data = await getPipelineBurndown(
    tenantId,
    req.query.pipelineId?.toString(),
    days,
  );
  res.json({ days, ...data });
});

// M11.D4: per-agent productivity (messages sent + leads won).
export const agentProductivity = asyncHandler(async (req, res) => {
  const period = parsePeriod(req, "30d");
  const tenantId = await getDefaultTenantId();
  const items = await getAgentProductivity(tenantId, period);
  res.json({ period, items });
});
