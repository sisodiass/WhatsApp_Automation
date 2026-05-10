import { useEffect, useState } from "react";
import { Heart, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { Dot } from "../components/ui/Badge.jsx";
import { cn } from "../lib/cn.js";

const STATUS_VARIANT = {
  ok: "success",
  yellow: "warning",
  red: "destructive",
};

const STATUS_LABEL = {
  ok: "OK",
  yellow: "DEGRADED",
  red: "DOWN",
};

export default function Health() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/health/full");
      setHealth(data);
      setLastFetched(new Date());
    } catch (err) {
      if (err.response?.data) {
        setHealth(err.response.data);
        setLastFetched(new Date());
      } else {
        setError(err.message || "fetch failed");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const overall = health?.status || "yellow";

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Heart}
        title="System Health"
        subtitle={lastFetched ? `Last refreshed ${lastFetched.toLocaleTimeString()}` : "Loading…"}
        actions={
          <Button onClick={load} disabled={loading} size="sm" variant="outline">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="flex-1 space-y-4 p-6">
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {!health && loading ? (
          <>
            <Skeleton className="h-16" />
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          </>
        ) : health ? (
          <>
            <Card
              className={cn(
                "animate-fade-in border-l-4",
                overall === "ok" && "border-l-success",
                overall === "yellow" && "border-l-warning",
                overall === "red" && "border-l-destructive",
              )}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Dot variant={STATUS_VARIANT[overall] || "muted"} className="h-2.5 w-2.5" />
                  <span className="text-sm font-semibold">
                    Overall: {STATUS_LABEL[overall] || overall}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(health.at).toLocaleString()}
                </span>
              </CardContent>
            </Card>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {(health.components || []).map((c) => (
                <ComponentCard key={c.name} component={c} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ComponentCard({ component: c }) {
  const variant = STATUS_VARIANT[c.status] || "muted";
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs">{c.name}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
              variant === "success" && "bg-success/15 text-success",
              variant === "warning" && "bg-warning/15 text-warning",
              variant === "destructive" && "bg-destructive/15 text-destructive",
              variant === "muted" && "bg-muted text-muted-foreground",
            )}
          >
            <Dot variant={variant} />
            {STATUS_LABEL[c.status] || c.status}
          </span>
        </div>
        <ComponentMeta component={c} />
      </CardContent>
    </Card>
  );
}

function ComponentMeta({ component: c }) {
  const meta = [];
  if (c.state) meta.push(["state", c.state]);
  if (c.version) meta.push(["version", c.version]);
  if (c.ageMs != null) meta.push(["heartbeat", `${Math.round(c.ageMs / 1000)}s`]);
  if (c.counts) {
    for (const [k, v] of Object.entries(c.counts)) meta.push([k, String(v)]);
  }
  if (c.info) meta.push(["info", c.info]);
  if (c.error) meta.push(["error", c.error]);

  if (meta.length === 0) return null;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
      {meta.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="truncate text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
