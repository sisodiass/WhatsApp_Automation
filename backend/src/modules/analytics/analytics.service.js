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

// M11.D4: source breakdown with realized revenue (won-quote totals)
// alongside lead counts. The existing getSourceBreakdown stops at
// counts + conversion rate; this adds the money column operators
// actually want for ROI math.
//
// "Revenue" = sum of Quotation.grandTotal for ACCEPTED quotes whose
// lead.source matches. This excludes EXPIRED/REJECTED and any DRAFT/SENT
// in-flight. Reflects actual closed-won value, not pipeline value.
export async function getSourceRoi(tenantId, period) {
  const since = periodSince(period);
  const leadWhere = {
    tenantId,
    source: { not: null },
    ...(since ? { createdAt: { gte: since } } : {}),
  };
  const leads = await prisma.lead.groupBy({
    by: ["source"],
    where: leadWhere,
    _count: true,
  });
  const wonGrouped = await prisma.lead.groupBy({
    by: ["source"],
    where: { ...leadWhere, stage: { category: "WON" } },
    _count: true,
  });
  const wonBySource = new Map(wonGrouped.map((g) => [g.source, g._count]));

  // Revenue per source from ACCEPTED quotations. Join through lead.source.
  // groupBy can't reach across relations cleanly, so we pull accepted
  // quotes with their lead's source and aggregate in JS.
  const acceptedQuotes = await prisma.quotation.findMany({
    where: {
      tenantId,
      status: "ACCEPTED",
      deletedAt: null,
      ...(since ? { createdAt: { gte: since } } : {}),
      lead: { source: { not: null } },
    },
    select: { grandTotal: true, currency: true, lead: { select: { source: true } } },
  });
  const revenueBySource = new Map(); // source -> { currency -> Decimal-string-sum }
  for (const q of acceptedQuotes) {
    const src = q.lead?.source;
    if (!src) continue;
    const bucket = revenueBySource.get(src) || {};
    const cur = q.currency || "INR";
    bucket[cur] = (Number(bucket[cur] || 0) + Number(q.grandTotal)).toFixed(2);
    revenueBySource.set(src, bucket);
  }

  return leads
    .map((g) => {
      const won = wonBySource.get(g.source) ?? 0;
      const revenue = revenueBySource.get(g.source) || {};
      return {
        source: g.source,
        total: g._count,
        won,
        conversion: g._count > 0 ? Number((won / g._count).toFixed(3)) : 0,
        // Per-currency map so multi-currency tenants don't lose detail.
        // Frontend sums across currencies after rendering each row.
        revenueByCurrency: revenue,
      };
    })
    .sort((a, b) => b.total - a.total);
}

// M11.D4: pipeline burndown — daily lead count per stage over a window.
// Uses LeadActivity (STAGE_CHANGE entries) as the event log, joined with
// the current lead.stageId for leads that haven't moved in-window. The
// shape is a time-series the frontend can render as a stacked-area chart.
//
// Window is bucketed by UTC day. For a 30d window that's 30 rows.
export async function getPipelineBurndown(tenantId, pipelineId, days = 30) {
  const pipeline = pipelineId
    ? await prisma.pipeline.findFirst({
        where: { id: pipelineId, tenantId },
        include: { stages: { orderBy: { order: "asc" } } },
      })
    : await prisma.pipeline.findFirst({
        where: { tenantId, isDefault: true },
        include: { stages: { orderBy: { order: "asc" } } },
      });
  if (!pipeline) return { pipeline: null, stages: [], series: [] };

  const stageIds = pipeline.stages.map((s) => s.id);
  const stageById = new Map(pipeline.stages.map((s) => [s.id, s]));

  // Stage moves in-window. Each entry has data.toStageId / data.fromStageId
  // (per automation.engine + lead.service stamp conventions).
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const activities = await prisma.leadActivity.findMany({
    where: {
      lead: { tenantId, pipelineId: pipeline.id },
      kind: "STAGE_CHANGE",
      createdAt: { gte: since },
    },
    select: { createdAt: true, data: true, leadId: true },
    orderBy: { createdAt: "asc" },
  });

  // Snapshot of the current stage per lead — combined with activities,
  // we reconstruct the per-day count by walking backward.
  const currentLeads = await prisma.lead.findMany({
    where: { tenantId, pipelineId: pipeline.id, stageId: { in: stageIds } },
    select: { id: true, stageId: true },
  });
  const currentByLead = new Map(currentLeads.map((l) => [l.id, l.stageId]));

  // Walk back day-by-day from today. For each day we maintain a map
  // (stageId -> count) by applying activities in reverse.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const series = [];
  const liveCounts = new Map(); // current per-stage count
  for (const stage of pipeline.stages) liveCounts.set(stage.id, 0);
  for (const stageId of currentByLead.values()) {
    liveCounts.set(stageId, (liveCounts.get(stageId) || 0) + 1);
  }

  // Activities sorted DESC for reverse walk.
  const reverseActivities = [...activities].reverse();
  let actIdx = 0;

  for (let i = 0; i < days; i++) {
    const dayStart = new Date(todayStart.getTime() - i * 24 * 3600 * 1000);
    // Apply (reverse) all activities that happened ON or AFTER this day
    // but BEFORE the next-newer day we already processed. On the first
    // iteration (i=0) that's "everything from today onward" → nothing.
    while (actIdx < reverseActivities.length) {
      const act = reverseActivities[actIdx];
      if (act.createdAt < dayStart) break;
      const toStage = act.data?.toStageId;
      const fromStage = act.data?.fromStageId;
      // Reverse: decrement the to-side, increment the from-side.
      if (toStage && liveCounts.has(toStage)) {
        liveCounts.set(toStage, Math.max(0, liveCounts.get(toStage) - 1));
      }
      if (fromStage && liveCounts.has(fromStage)) {
        liveCounts.set(fromStage, (liveCounts.get(fromStage) || 0) + 1);
      }
      actIdx++;
    }
    series.unshift({
      date: dayStart.toISOString().slice(0, 10),
      counts: Object.fromEntries(liveCounts),
    });
  }

  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    stages: pipeline.stages.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      category: s.category,
      color: s.color,
    })),
    series,
  };
}

// M11.D4: per-agent productivity. The Message table doesn't carry an
// authorId today (it's tracked indirectly via session.mode flips); the
// trustworthy attribution we have is Lead.assignedToId. Each row counts:
//   - assigned:    leads currently assigned to the agent
//   - wonInWindow: leads won (stage.category=WON, wonAt in window)
//   - lostInWindow: leads lost in window
// Add per-message attribution later when Message.authorId lands —
// noted in TEST_AND_DEPLOY.md as a follow-up.
export async function getAgentProductivity(tenantId, period) {
  const since = periodSince(period);
  const wonWhere = {
    tenantId,
    stage: { category: "WON" },
    assignedToId: { not: null },
    ...(since ? { wonAt: { gte: since } } : {}),
  };
  const lostWhere = {
    tenantId,
    stage: { category: "LOST" },
    assignedToId: { not: null },
    ...(since ? { lostAt: { gte: since } } : {}),
  };
  const assignedWhere = {
    tenantId,
    assignedToId: { not: null },
    stage: { category: "OPEN" },
  };

  const [wonByAgent, lostByAgent, assignedByAgent] = await Promise.all([
    prisma.lead.groupBy({ by: ["assignedToId"], where: wonWhere, _count: true }),
    prisma.lead.groupBy({ by: ["assignedToId"], where: lostWhere, _count: true }),
    prisma.lead.groupBy({
      by: ["assignedToId"],
      where: assignedWhere,
      _count: true,
    }),
  ]);

  const agentIds = new Set([
    ...wonByAgent.map((r) => r.assignedToId),
    ...lostByAgent.map((r) => r.assignedToId),
    ...assignedByAgent.map((r) => r.assignedToId),
  ]);
  if (agentIds.size === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...agentIds] }, tenantId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const wonMap = new Map(wonByAgent.map((r) => [r.assignedToId, r._count]));
  const lostMap = new Map(lostByAgent.map((r) => [r.assignedToId, r._count]));
  const assignedMap = new Map(
    assignedByAgent.map((r) => [r.assignedToId, r._count]),
  );

  return [...agentIds]
    .map((id) => {
      const u = userById.get(id);
      const won = wonMap.get(id) ?? 0;
      const lost = lostMap.get(id) ?? 0;
      return {
        userId: id,
        name: u?.name || u?.email || "(unknown)",
        role: u?.role || null,
        active: u?.isActive ?? false,
        openAssigned: assignedMap.get(id) ?? 0,
        won,
        lost,
        // Closed-deal win rate over the window. Defensive denominator.
        winRate: won + lost > 0 ? Number((won / (won + lost)).toFixed(3)) : 0,
      };
    })
    .sort((a, b) => b.won - a.won);
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
