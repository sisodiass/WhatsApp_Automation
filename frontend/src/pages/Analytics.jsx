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
