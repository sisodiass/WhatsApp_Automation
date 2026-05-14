// Campaign-level rollups derived from existing tables. No new event log
// table — everything we need lives in chat_sessions + manual_queue_items
// + demo_bookings + messages. Recomputed on every request; the volumes
// at this scale don't need a precomputed materialized view.
//
// M8 adds advanced CRM rollups on top: source-wise conversion, pipeline
// funnel, bulk-campaign performance, follow-up engine performance, and
// automation engine performance.

import { prisma } from "../../shared/prisma.js";

const PERIODS = {
  "24h": 24 * 3600 * 1000,
  "7d": 7 * 24 * 3600 * 1000,
  "30d": 30 * 24 * 3600 * 1000,
  all: null,
};

export function periodSince(period) {
  const ms = PERIODS[period];
  if (!ms) return null;
  return new Date(Date.now() - ms);
}

export async function getOverview(tenantId, period) {
  const since = periodSince(period);

  // We use $queryRawUnsafe so we can conditionally drop the time filter
  // for `period=all`. All inputs are fixed strings or DB-derived; no SQL
  // injection surface.
  const sinceFilter = since ? `AND cs.started_at >= '${since.toISOString()}'::timestamptz` : "";
  const sinceMsg = since ? `AND m.created_at >= '${since.toISOString()}'::timestamptz` : "";
  const sinceBk = since ? `AND db.created_at >= '${since.toISOString()}'::timestamptz` : "";

  // Top-level numbers.
  const [overview] = await prisma.$queryRawUnsafe(`
    WITH t AS (SELECT $1::text AS tenant_id),
    s AS (
      SELECT cs.id, cs.mode, cs.ai_reply_count, cs.last_confidence, cs.ended_reason
        FROM chat_sessions cs
        JOIN chats c ON c.id = cs.chat_id
       WHERE c.tenant_id = (SELECT tenant_id FROM t)
         ${sinceFilter}
    )
    SELECT
      (SELECT COUNT(*)::int FROM s)                                        AS sessions_started,
      (SELECT COUNT(*)::int FROM s WHERE mode = 'AI')                      AS ai_sessions,
      (SELECT COUNT(*)::int FROM s WHERE mode = 'MANUAL')                  AS manual_sessions,
      (SELECT COALESCE(SUM(ai_reply_count), 0)::int FROM s)                AS ai_replies,
      (SELECT ROUND(AVG(last_confidence)::numeric, 3)::float FROM s WHERE last_confidence IS NOT NULL) AS avg_confidence,
      (SELECT COUNT(*)::int FROM s WHERE ended_reason = 'CAMPAIGN_REENTRY') AS session_resets,
      (SELECT COUNT(*)::int FROM messages m
         JOIN chat_sessions cs2 ON cs2.id = m.session_id
         JOIN chats c2 ON c2.id = cs2.chat_id
        WHERE c2.tenant_id = (SELECT tenant_id FROM t) ${sinceMsg}) AS total_messages,
      (SELECT COUNT(*)::int FROM manual_queue_items mq
         JOIN chats c3 ON c3.id = mq.chat_id
        WHERE c3.tenant_id = (SELECT tenant_id FROM t)
          ${since ? `AND mq.created_at >= '${since.toISOString()}'::timestamptz` : ""}) AS manual_queue_items,
      (SELECT COUNT(*)::int FROM manual_queue_items mq
         JOIN chats c3 ON c3.id = mq.chat_id
        WHERE c3.tenant_id = (SELECT tenant_id FROM t) AND mq.resolved_at IS NULL) AS manual_unresolved,
      (SELECT COUNT(*)::int FROM demo_bookings db
         JOIN chats c4 ON c4.id = db.chat_id
        WHERE c4.tenant_id = (SELECT tenant_id FROM t) ${sinceBk}) AS demo_bookings
  `, tenantId);

  return overview;
}

export async function getCampaignBreakdown(tenantId, period) {
  const since = periodSince(period);
  const sinceFilter = since
    ? `AND cs.started_at >= '${since.toISOString()}'::timestamptz`
    : "";
  const sinceBk = since
    ? `AND db.created_at >= '${since.toISOString()}'::timestamptz`
    : "";

  return prisma.$queryRawUnsafe(`
    SELECT
      c.id    AS campaign_id,
      c.name  AS name,
      c.tag   AS tag,
      c.is_active AS is_active,
      COALESCE(s.sessions_started, 0)::int      AS sessions_started,
      COALESCE(s.ai_replies, 0)::int            AS ai_replies,
      COALESCE(s.session_resets, 0)::int        AS session_resets,
      COALESCE(s.manual_sessions, 0)::int       AS manual_sessions,
      COALESCE(esc.escalations, 0)::int         AS manual_escalations,
      COALESCE(d.demo_bookings, 0)::int         AS demo_bookings,
      ROUND(s.avg_confidence::numeric, 3)::float AS avg_confidence
    FROM campaigns c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int                                            AS sessions_started,
        SUM(cs.ai_reply_count)::int                              AS ai_replies,
        SUM((cs.ended_reason = 'CAMPAIGN_REENTRY')::int)::int    AS session_resets,
        SUM((cs.mode = 'MANUAL')::int)::int                      AS manual_sessions,
        AVG(cs.last_confidence) FILTER (WHERE cs.last_confidence IS NOT NULL) AS avg_confidence
      FROM chat_sessions cs
      WHERE cs.campaign_id = c.id ${sinceFilter}
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS escalations
      FROM manual_queue_items mq
      JOIN chat_sessions cs ON cs.id = mq.session_id
      WHERE cs.campaign_id = c.id ${sinceFilter}
    ) esc ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS demo_bookings
      FROM demo_bookings db
      JOIN chats ch ON ch.id = db.chat_id
      JOIN chat_sessions cs ON cs.chat_id = ch.id
      WHERE cs.campaign_id = c.id ${sinceBk} ${sinceFilter}
    ) d ON true
    WHERE c.tenant_id = $1
    ORDER BY sessions_started DESC, c.created_at DESC
  `, tenantId);
}

// ─── M8: advanced CRM rollups ───────────────────────────────────────

// Lead source breakdown with WON / total conversion. Useful for "which
// channels actually convert?". Excludes leads with no source.
export async function getSourceBreakdown(tenantId, period) {
  const since = periodSince(period);
  const where = {
    tenantId,
    source: { not: null },
    ...(since ? { createdAt: { gte: since } } : {}),
  };
  const grouped = await prisma.lead.groupBy({
    by: ["source"],
    where,
    _count: true,
    orderBy: { _count: { id: "desc" } },
  });
  // Won counts per source — second query keeps the GROUP BY simple
  // (Prisma's groupBy doesn't support conditional counts directly).
  const wonGrouped = await prisma.lead.groupBy({
    by: ["source"],
    where: {
      ...where,
      stage: { category: "WON" },
    },
    _count: true,
  });
  const wonBySource = new Map(wonGrouped.map((g) => [g.source, g._count]));
  return grouped.map((g) => {
    const won = wonBySource.get(g.source) ?? 0;
    return {
      source: g.source,
      total: g._count,
      won,
      conversion: g._count > 0 ? Number((won / g._count).toFixed(3)) : 0,
    };
  });
}

// Pipeline funnel — counts per stage for the default pipeline (the
// "active" one). Caller can pass `pipelineId` to scope to another.
export async function getPipelineFunnel(tenantId, pipelineId) {
  let pipeline;
  if (pipelineId) {
    pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, tenantId },
      include: { stages: { orderBy: { order: "asc" } } },
    });
  } else {
    pipeline = await prisma.pipeline.findFirst({
      where: { tenantId, isDefault: true },
      include: { stages: { orderBy: { order: "asc" } } },
    });
  }
  if (!pipeline) return { pipeline: null, stages: [] };

  const stageIds = pipeline.stages.map((s) => s.id);
  const grouped = await prisma.lead.groupBy({
    by: ["stageId"],
    where: { tenantId, pipelineId: pipeline.id, stageId: { in: stageIds } },
    _count: true,
  });
  const countByStage = new Map(grouped.map((g) => [g.stageId, g._count]));
  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    stages: pipeline.stages.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      category: s.category,
      color: s.color,
      count: countByStage.get(s.id) ?? 0,
    })),
  };
}

// Bulk-campaign rollup — top-N by recency with the denormalized counters
// already maintained on the row. Handy "what's running" widget.
export async function getBulkRollup(tenantId) {
  const items = await prisma.bulkCampaign.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      status: true,
      sentCount: true,
      deliveredCount: true,
      readCount: true,
      failedCount: true,
      repliedCount: true,
      createdAt: true,
      scheduledAt: true,
      _count: { select: { recipients: true } },
    },
  });
  return items.map((b) => ({
    id: b.id,
    name: b.name,
    status: b.status,
    scheduledAt: b.scheduledAt,
    createdAt: b.createdAt,
    total: b._count.recipients,
    sent: b.sentCount,
    delivered: b.deliveredCount,
    read: b.readCount,
    failed: b.failedCount,
    replied: b.repliedCount,
    replyRate: b.sentCount > 0 ? Number((b.repliedCount / b.sentCount).toFixed(3)) : 0,
  }));
}

// Follow-up engine performance. Rule-level fires + replies-after-fire
// (proxy = next inbound message within 7 days on that contact's chat).
export async function getFollowupPerformance(tenantId, period) {
  const since = periodSince(period);
  const rules = await prisma.followupRule.findMany({
    where: { tenantId },
    select: { id: true, name: true, isActive: true, hoursSinceLastInbound: true },
  });
  const out = [];
  for (const rule of rules) {
    const where = {
      ruleId: rule.id,
      ...(since ? { sentAt: { gte: since } } : {}),
    };
    const fired = await prisma.followupLog.count({ where });
    out.push({
      id: rule.id,
      name: rule.name,
      isActive: rule.isActive,
      hoursSinceLastInbound: rule.hoursSinceLastInbound,
      fired,
    });
  }
  return out.sort((a, b) => b.fired - a.fired);
}

// Automation engine performance — per-automation run counts grouped by
// status. Lets operators spot failing automations quickly.
export async function getAutomationPerformance(tenantId) {
  const automations = await prisma.automation.findMany({
    where: { tenantId },
    select: { id: true, name: true, trigger: true, isActive: true },
  });
  const out = [];
  for (const a of automations) {
    const grouped = await prisma.automationRun.groupBy({
      by: ["status"],
      where: { automationId: a.id },
      _count: true,
    });
    const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count]));
    out.push({
      id: a.id,
      name: a.name,
      trigger: a.trigger,
      isActive: a.isActive,
      pending: counts.PENDING ?? 0,
      running: counts.RUNNING ?? 0,
      waiting: counts.WAITING ?? 0,
      done: counts.DONE ?? 0,
      failed: counts.FAILED ?? 0,
      cancelled: counts.CANCELLED ?? 0,
    });
  }
  return out.sort((a, b) => (b.done + b.failed) - (a.done + a.failed));
}
