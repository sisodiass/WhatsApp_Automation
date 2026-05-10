import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ListTodo } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { getSocket } from "../lib/socket.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { SkeletonTable } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

const REASON_LABEL = {
  AI_REPLY_LIMIT: "10-reply cap",
  LOW_CONFIDENCE: "Low confidence",
  KEYWORD_TRIGGER: "Keyword trigger",
  ADMIN_FORCED: "Admin forced",
  GLOBAL_AI_OFF: "Global AI off",
  NEGATIVE_SENTIMENT: "Negative sentiment",
};

function ageMinutes(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

export default function ManualQueue() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const sla = 10;

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/manual-queue");
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onNew = () => load();
    socket.on("manual_queue:new", onNew);
    return () => socket.off("manual_queue:new", onNew);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  async function claimAndOpen(item) {
    setBusy(true);
    try {
      await api.post(`/manual-queue/${item.id}/claim`);
      navigate(`/chats/${item.chat.id}`);
    } catch (err) {
      toast.fromError(err, "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  async function resolveItem(item) {
    const ok = await confirm({
      title: "Mark resolved?",
      description: "The item disappears from the manual queue. The chat itself stays open and can still be replied to.",
      confirmLabel: "Resolve",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/manual-queue/${item.id}/resolve`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={ListTodo}
        title="Manual Queue"
        subtitle={loading ? "Loading…" : `${items.length} unresolved`}
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <SkeletonTable rows={4} cols={5} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-left font-medium">Reason</th>
                  <th className="px-4 py-2 text-left font-medium">Age</th>
                  <th className="px-4 py-2 text-left font-medium">Claimed</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => {
                  const mins = ageMinutes(item.createdAt);
                  const breached = mins >= sla;
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "transition-colors hover:bg-accent",
                        breached && "bg-destructive/5",
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {item.chat.displayName || item.chat.phone}
                        </div>
                        <div className="text-xs text-muted-foreground">{item.chat.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="muted">
                          {REASON_LABEL[item.reason] || item.reason}
                        </Badge>
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-xs",
                          breached ? "font-medium text-destructive" : "text-muted-foreground",
                        )}
                        data-tick={tick}
                      >
                        {mins < 1 ? "<1 min" : `${mins} min`}
                        {breached && (
                          <Badge variant="destructive" className="ml-1.5">SLA</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {item.claimedBy?.email || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="xs"
                            onClick={() => claimAndOpen(item)}
                            disabled={busy}
                          >
                            {item.claimedBy ? "Open" : "Claim & open"}
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => resolveItem(item)}
                            disabled={busy}
                          >
                            Resolve
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card py-16 text-center animate-fade-in">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
        <CheckCircle2 className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">All clear</h3>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Items appear here when AI confidence is low, the 10-reply cap is hit,
        or an admin forces MANUAL mode.
      </p>
    </div>
  );
}
