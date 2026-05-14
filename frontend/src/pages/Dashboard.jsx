import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  CircleCheck,
  CircleAlert,
  HelpCircle,
  Inbox as InboxIcon,
  ListTodo,
  MessageCircle,
  TrendingUp,
} from "lucide-react";
import { api } from "../lib/api.js";
import { getSocket } from "../lib/socket.js";
import { Card, CardContent } from "../components/ui/Card.jsx";
import { Badge, Dot } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { Button } from "../components/ui/Button.jsx";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import AiCoverageBanner from "../components/AiCoverageBanner.jsx";
import GlobalAiSwitch from "../components/GlobalAiSwitch.jsx";
import { cn } from "../lib/cn.js";

// Quick-glance dashboard. Pulls live stats from /api/whatsapp/status,
// /api/manual-queue, /api/analytics/overview. Polled lightly + a few
// socket triggers for faster refresh on important changes.

const WA_VARIANT = {
  READY: "success",
  AUTHENTICATING: "warning",
  AWAITING_QR: "warning",
  BOOTING: "warning",
  DISCONNECTED: "destructive",
  AUTH_FAILURE: "destructive",
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [waStatus, setWaStatus] = useState(null);
  const [queueCount, setQueueCount] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    try {
      const [wa, q, ov] = await Promise.all([
        api.get("/whatsapp/status").catch(() => ({ data: null })),
        api.get("/manual-queue").catch(() => ({ data: { items: [] } })),
        api.get("/analytics/overview", { params: { period: "7d" } }).catch(() => ({ data: null })),
      ]);
      setWaStatus(wa.data);
      setQueueCount((q.data?.items || []).length);
      setOverview(ov.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 30_000);

    const socket = getSocket();
    const onWa = () => loadAll();
    const onQueue = () => loadAll();
    socket.on("wa:status", onWa);
    socket.on("manual_queue:new", onQueue);
    return () => {
      clearInterval(t);
      socket.off("wa:status", onWa);
      socket.off("manual_queue:new", onQueue);
    };
  }, []);

  const waState = waStatus?.status?.state || (loading ? null : "DISCONNECTED");
  // `me` is the linked WhatsApp number, set by the wa-worker on the "ready"
  // event (see backend/.../whatsapp.bus.js → wa:me). Format: usually an
  // E.164-style string without the leading "+" (e.g. "919812345678"), and
  // occasionally a raw JID like "919812345678@c.us" — strip the suffix and
  // add a leading "+" for display.
  const connectedNumber = (() => {
    const raw = waStatus?.me;
    if (!raw) return null;
    const stripped = String(raw).replace(/@.*$/, "");
    if (!stripped) return null;
    return stripped.startsWith("+") ? stripped : `+${stripped}`;
  })();
  const ov = overview?.overview;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Overview"
        subtitle="WhatsApp · Last 7 days"
        actions={
          <div className="flex items-center gap-2">
            <GlobalAiSwitch />
            <Button
              variant="outline"
              size="md"
              onClick={() => navigate("/help")}
              title="Open the in-app user guide"
            >
              <HelpCircle className="h-4 w-4" />
              Help Guide
            </Button>
          </div>
        }
      />

      <div className="flex-1 space-y-6 p-6">
        <AiCoverageBanner />

        {/* Top status row */}
        <div className="grid gap-3 md:grid-cols-3">
          <StatusCard
            icon={MessageCircle}
            label="WhatsApp"
            value={waState || "—"}
            sublabel={waState === "READY" ? connectedNumber : null}
            variant={waState ? WA_VARIANT[waState] || "muted" : "muted"}
            href="/whatsapp"
            loading={loading}
          />
          <StatusCard
            icon={ListTodo}
            label="Manual Queue"
            value={queueCount != null ? `${queueCount} unresolved` : "—"}
            variant={queueCount > 0 ? "warning" : "success"}
            href="/queue"
            loading={loading}
          />
          <StatusCard
            icon={Bot}
            label="AI Provider"
            value={overview ? "Healthy" : "—"}
            variant="success"
            href="/health"
            loading={loading}
          />
        </div>

        {/* Activity stats */}
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Last 7 days
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Sessions started" value={ov?.sessions_started} loading={loading} />
            <StatCard label="AI replies" value={ov?.ai_replies} loading={loading} />
            <StatCard
              label="Avg confidence"
              value={ov?.avg_confidence != null ? ov.avg_confidence.toFixed(2) : "—"}
              loading={loading}
            />
            <StatCard label="Demo bookings" value={ov?.demo_bookings} loading={loading} />
          </div>
        </section>

        {/* Quick links */}
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Quick links
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <QuickLink to="/inbox" icon={InboxIcon} label="Inbox" desc="All campaign chats" />
            <QuickLink to="/queue" icon={ListTodo} label="Manual Queue" desc="Awaiting agents" />
            <QuickLink to="/analytics" icon={TrendingUp} label="Analytics" desc="Per-campaign rollups" />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value, sublabel, variant, href, loading }) {
  return (
    <Link to={href} className="block">
      <Card className="transition-colors hover:border-foreground/20">
        <CardContent className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-5 w-24" />
            ) : (
              <>
                <div className="mt-1.5 flex items-center gap-2">
                  <Dot variant={variant} />
                  <span className="truncate text-sm font-semibold">{value}</span>
                </div>
                {sublabel && (
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {sublabel}
                  </div>
                )}
              </>
            )}
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        </CardContent>
      </Card>
    </Link>
  );
}

function StatCard({ label, value, loading }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-16" />
        ) : (
          <div className="mt-1 text-2xl font-semibold tracking-tight">
            {value ?? "—"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickLink({ to, icon: Icon, label, desc }) {
  return (
    <Link to={to}>
      <Card className="group h-full transition-all hover:border-foreground/30 hover:shadow-md">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{label}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </CardContent>
      </Card>
    </Link>
  );
}
