import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

const PERIODS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

export default function Analytics() {
  const [period, setPeriod] = useState("7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/analytics/overview", { params: { period } });
      setData(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [period]);

  const ov = data?.overview;
  const aiManualRatio = ov && ov.ai_sessions + ov.manual_sessions > 0
    ? `${Math.round((ov.ai_sessions / (ov.ai_sessions + ov.manual_sessions)) * 100)}% AI · ${Math.round((ov.manual_sessions / (ov.ai_sessions + ov.manual_sessions)) * 100)}% Manual`
    : "—";

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={TrendingUp}
        title="Analytics"
        subtitle="Campaign-level rollups · derived from sessions, messages, and queue"
        actions={
          <div className="flex h-8 items-center gap-0.5 rounded-md border bg-card p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  period === p.value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading || !data ? (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-72" />
          </div>
        ) : (
          <>
            <section className="mb-6">
              <h2 className="mb-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Overview
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Sessions started" value={ov.sessions_started} />
                <Stat label="AI replies" value={ov.ai_replies} />
                <Stat label="AI / Manual" value={aiManualRatio} small />
                <Stat
                  label="Avg confidence"
                  value={ov.avg_confidence != null ? ov.avg_confidence.toFixed(2) : "—"}
                />
                <Stat label="Total messages" value={ov.total_messages} />
                <Stat label="Manual queue items" value={ov.manual_queue_items} />
                <Stat
                  label="Manual unresolved"
                  value={ov.manual_unresolved}
                  warn={ov.manual_unresolved > 0}
                />
                <Stat label="Demo bookings" value={ov.demo_bookings} />
              </div>
            </section>

            {/* M8 advanced rollups: CRM, bulk, follow-up, automations. */}
            <AdvancedRollups period={period} />

            <section>
              <h2 className="mb-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                By campaign
              </h2>
              {data.by_campaign?.length === 0 ? (
                <Card className="border-dashed">
                  <p className="p-12 text-center text-sm text-muted-foreground">No campaigns yet.</p>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Campaign</th>
                        <th className="px-4 py-2 text-right font-medium">Sessions</th>
                        <th className="px-4 py-2 text-right font-medium">AI replies</th>
                        <th className="px-4 py-2 text-right font-medium">Manual</th>
                        <th className="px-4 py-2 text-right font-medium">Escalations</th>
                        <th className="px-4 py-2 text-right font-medium">Resets</th>
                        <th className="px-4 py-2 text-right font-medium">Demos</th>
                        <th className="px-4 py-2 text-right font-medium">Avg conf</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(data.by_campaign || []).map((row) => (
                        <tr key={row.campaign_id} className="transition-colors hover:bg-accent">
                          <td className="px-4 py-2">
                            <div className="font-medium">{row.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">{row.tag}</div>
                          </td>
                          <Td>{row.sessions_started}</Td>
                          <Td>{row.ai_replies}</Td>
                          <Td>{row.manual_sessions}</Td>
                          <Td>{row.manual_escalations}</Td>
                          <Td>{row.session_resets}</Td>
                          <Td>{row.demo_bookings}</Td>
                          <Td>
                            {row.avg_confidence != null ? row.avg_confidence.toFixed(2) : "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, small, warn }) {
  return (
    <Card className={cn(warn && "border-warning/50")}>
      <CardContent className="p-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={cn("mt-1 font-semibold tracking-tight", small ? "text-base" : "text-2xl")}>
          {value ?? "—"}
        </div>
      </CardContent>
    </Card>
  );
}

function Td({ children }) {
  return <td className="px-4 py-2 text-right">{children ?? "—"}</td>;
}

// ─── M8: advanced rollups ───────────────────────────────────────────

function AdvancedRollups({ period }) {
  const [data, setData] = useState({ sources: [], funnel: null, bulk: [], followups: [], automations: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get("/analytics/sources", { params: { period } }).then((r) => r.data.items).catch(() => []),
      api.get("/analytics/funnel").then((r) => r.data).catch(() => null),
      api.get("/analytics/bulk").then((r) => r.data.items).catch(() => []),
      api.get("/analytics/followups", { params: { period } }).then((r) => r.data.items).catch(() => []),
      api.get("/analytics/automations").then((r) => r.data.items).catch(() => []),
    ])
      .then(([sources, funnel, bulk, followups, automations]) => {
        if (!cancelled) setData({ sources, funnel, bulk, followups, automations });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [period]);

  if (loading) {
    return (
      <section className="mb-6 grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </section>
    );
  }

  const funnelMax = Math.max(1, ...(data.funnel?.stages || []).map((s) => s.count));

  return (
    <div className="mb-6 space-y-6">
      {/* Pipeline funnel + Source breakdown side by side */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Pipeline funnel {data.funnel?.pipeline ? `· ${data.funnel.pipeline.name}` : ""}
          </h2>
          {!data.funnel?.stages?.length ? (
            <Card className="border-dashed">
              <p className="p-8 text-center text-xs text-muted-foreground">No pipeline data.</p>
            </Card>
          ) : (
            <Card>
              <div className="space-y-2 p-4">
                {data.funnel.stages.map((s) => (
                  <div key={s.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        {s.color && (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: s.color }}
                          />
                        )}
                        {s.name}
                      </span>
                      <span className="font-mono text-muted-foreground">{s.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full transition-all",
                          s.category === "WON" && "bg-success",
                          s.category === "LOST" && "bg-destructive",
                          s.category === "OPEN" && "bg-primary",
                        )}
                        style={{ width: `${(s.count / funnelMax) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>

        <section>
          <h2 className="mb-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Lead sources · {period}
          </h2>
          {data.sources.length === 0 ? (
            <Card className="border-dashed">
              <p className="p-8 text-center text-xs text-muted-foreground">
                No leads with a `source` value in this window.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Source</th>
                    <th className="px-4 py-2 text-right font-medium">Leads</th>
                    <th className="px-4 py-2 text-right font-medium">Won</th>
                    <th className="px-4 py-2 text-right font-medium">Conv %</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.sources.map((s) => (
                    <tr key={s.source} className="hover:bg-accent">
                      <td className="px-4 py-2 font-mono text-xs">{s.source}</td>
                      <Td>{s.total}</Td>
                      <Td>{s.won}</Td>
                      <Td>{Math.round(s.conversion * 100)}%</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </section>
      </div>

      {/* Bulk campaign rollup */}
      {data.bulk.length > 0 && (
        <section>
          <h2 className="mb-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Bulk broadcasts
          </h2>
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Campaign</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Sent</th>
                  <th className="px-4 py-2 text-right font-medium">Delivered</th>
                  <th className="px-4 py-2 text-right font-medium">Read</th>
                  <th className="px-4 py-2 text-right font-medium">Replied</th>
                  <th className="px-4 py-2 text-right font-medium">Reply %</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.bulk.map((b) => (
                  <tr key={b.id} className="hover:bg-accent">
                    <td className="px-4 py-2 font-medium">{b.name}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{b.status}</td>
                    <Td>{b.total}</Td>
                    <Td>{b.sent}</Td>
                    <Td>{b.delivered}</Td>
                    <Td>{b.read}</Td>
                    <Td>{b.replied}</Td>
                    <Td>{Math.round(b.replyRate * 100)}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {/* Follow-up + Automation perf side by side */}
      {(data.followups.length > 0 || data.automations.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.followups.length > 0 && (
            <section>
              <h2 className="mb-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Follow-up rules · {period}
              </h2>
              <Card className="overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Rule</th>
                      <th className="px-4 py-2 text-right font-medium">Idle ≥ h</th>
                      <th className="px-4 py-2 text-right font-medium">Fired</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.followups.map((r) => (
                      <tr key={r.id} className="hover:bg-accent">
                        <td className="px-4 py-2">
                          {r.name}
                          {!r.isActive && (
                            <span className="ml-2 text-[10px] text-muted-foreground">(paused)</span>
                          )}
                        </td>
                        <Td>{r.hoursSinceLastInbound}</Td>
                        <Td>{r.fired}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          )}

          {data.automations.length > 0 && (
            <section>
              <h2 className="mb-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Automation runs
              </h2>
              <Card className="overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Automation</th>
                      <th className="px-4 py-2 text-right font-medium">Done</th>
                      <th className="px-4 py-2 text-right font-medium">Failed</th>
                      <th className="px-4 py-2 text-right font-medium">Waiting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.automations.map((a) => (
                      <tr key={a.id} className="hover:bg-accent">
                        <td className="px-4 py-2">
                          <div>{a.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            <code>{a.trigger}</code>
                          </div>
                        </td>
                        <Td>{a.done}</Td>
                        <Td>{a.failed}</Td>
                        <Td>{a.waiting + a.running + a.pending}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
