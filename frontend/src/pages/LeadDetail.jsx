import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Building,
  Calendar,
  CheckCircle2,
  CircleDashed,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Sparkles,
  StickyNote,
  User,
} from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { DateTimeInput } from "../components/ui/DateTimeInput.jsx";
import { cn } from "../lib/cn.js";

export default function LeadDetail() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState([]);
  const [note, setNote] = useState("");
  const [newTask, setNewTask] = useState({ title: "", dueAt: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/leads/${leadId}`);
      setLead(data);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to load lead");
    } finally {
      setLoading(false);
    }
  }

  async function loadPipelines() {
    const { data } = await api.get("/pipelines");
    setPipelines(data.items || []);
  }

  useEffect(() => {
    load();
    loadPipelines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function moveStage(stageId) {
    setBusy(true);
    try {
      await api.patch(`/leads/${leadId}/stage`, { stageId });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to move stage");
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/leads/${leadId}/notes`, { body: note.trim() });
      setNote("");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to add note");
    } finally {
      setBusy(false);
    }
  }

  async function addTask(e) {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    setBusy(true);
    try {
      const payload = { title: newTask.title.trim(), leadId };
      if (newTask.dueAt) payload.dueAt = new Date(newTask.dueAt).toISOString();
      await api.post(`/tasks`, payload);
      setNewTask({ title: "", dueAt: "" });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to create task");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task) {
    setBusy(true);
    try {
      await api.patch(`/tasks/${task.id}`, {
        status: task.status === "DONE" ? "OPEN" : "DONE",
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function scoreNow() {
    setBusy(true);
    try {
      const { data } = await api.post(`/leads/${leadId}/score`);
      toast.success(`Scored: ${data.score} (${(data.aiScore * 100).toFixed(0)}%)`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Scoring failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Loading…" />
        <div className="p-6">
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }
  if (!lead) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Lead not found" />
        <div className="p-6">
          <Button variant="ghost" onClick={() => navigate("/pipeline")}>
            Back to pipeline
          </Button>
        </div>
      </div>
    );
  }

  const c = lead.contact;
  const name = [c?.firstName, c?.lastName].filter(Boolean).join(" ") || c?.mobile || "(no name)";
  const stagesForPipeline = pipelines.find((p) => p.id === lead.pipelineId)?.stages || [];
  const chat = c?.id ? null : null; // chat link comes through lead.contact via the API

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={User}
        title={name}
        subtitle={`${lead.stage?.name || ""} · ${lead.pipeline?.name || ""}`}
        actions={
          <Button size="sm" variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* ─── Left column: contact + stage ─── */}
          <Card className="lg:col-span-1">
            <div className="p-5">
              <h3 className="mb-3 text-sm font-medium">Contact</h3>
              <div className="space-y-2 text-sm">
                <Row icon={User} label="Name">{name}</Row>
                <Row icon={Phone} label="Mobile">
                  <span className="font-mono">{c?.mobile}</span>
                </Row>
                {c?.email && <Row icon={Mail} label="Email">{c.email}</Row>}
                {c?.company && <Row icon={Building} label="Company">{c.company}</Row>}
              </div>

              <h3 className="mb-2 mt-5 text-sm font-medium">Stage</h3>
              <div className="space-y-1.5">
                {stagesForPipeline.map((s) => {
                  const active = s.id === lead.stageId;
                  return (
                    <button
                      key={s.id}
                      disabled={busy || active}
                      onClick={() => moveStage(s.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "hover:bg-accent",
                      )}
                    >
                      {s.color && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                      )}
                      <span className="flex-1">{s.name}</span>
                      {active && <CheckCircle2 className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>

              {lead.expectedValue && (
                <div className="mt-5 rounded-md border bg-muted/40 p-2 text-xs">
                  <div className="text-muted-foreground">Expected value</div>
                  <div className="mt-0.5 font-mono">
                    {lead.currency || ""} {Number(lead.expectedValue).toLocaleString()}
                  </div>
                </div>
              )}

              {/* Source + attribution. Source is always shown; UTM /
                  landing / referrer are only rendered when present so
                  manual / WhatsApp leads don't show empty rows. */}
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-medium">Source &amp; attribution</h3>
                <dl className="space-y-1 rounded-md border bg-muted/40 p-2 text-[11px]">
                  <Attr label="Source" value={lead.source || "—"} mono />
                  {lead.assignedTo?.name && (
                    <Attr label="Assigned" value={lead.assignedTo.name} />
                  )}
                  {lead.campaign?.name && (
                    <Attr label="Campaign" value={lead.campaign.name} />
                  )}
                  {(lead.utmSource || lead.utmMedium || lead.utmCampaign || lead.adId) && (
                    <>
                      {lead.utmSource && <Attr label="utm_source" value={lead.utmSource} mono />}
                      {lead.utmMedium && <Attr label="utm_medium" value={lead.utmMedium} mono />}
                      {lead.utmCampaign && <Attr label="utm_campaign" value={lead.utmCampaign} mono />}
                      {lead.adId && <Attr label="ad_id" value={lead.adId} mono />}
                    </>
                  )}
                  {lead.landingPage && (
                    <Attr label="Landing" value={lead.landingPage} truncate />
                  )}
                  {lead.referrer && (
                    <Attr label="Referrer" value={lead.referrer} truncate />
                  )}
                </dl>
              </div>

              {/* AI scoring + memory (M7) */}
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium">AI score</h3>
                  <Button size="xs" variant="outline" onClick={scoreNow} disabled={busy}>
                    <Sparkles className="h-3 w-3" /> Score now
                  </Button>
                </div>
                {lead.score || lead.aiScore != null ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                    {lead.score && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          lead.score === "HOT" && "bg-destructive/15 text-destructive",
                          lead.score === "WARM" && "bg-warning/15 text-warning",
                          lead.score === "COLD" && "bg-info/15 text-info",
                          lead.score === "UNQUALIFIED" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {lead.score}
                      </span>
                    )}
                    {lead.aiScore != null && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {(Number(lead.aiScore) * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Not scored yet. Click <em>Score now</em> to classify.
                  </p>
                )}

                {lead.memory?.memory && Object.keys(lead.memory.memory).length > 0 && (
                  <div className="mt-3">
                    <h3 className="mb-1 flex items-center gap-1 text-xs font-medium">
                      <Brain className="h-3 w-3" /> AI memory
                    </h3>
                    <dl className="space-y-0.5 rounded-md border bg-muted/40 p-2 text-[11px]">
                      {Object.entries(lead.memory.memory).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="min-w-[110px] truncate text-muted-foreground">{k}</dt>
                          <dd className="font-mono">{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>

              {c?.chats?.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-medium">Linked chats</h3>
                  <div className="space-y-1">
                    {c.chats.map((ch) => (
                      <a
                        key={ch.id}
                        href={`/chats/${ch.id}`}
                        className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                      >
                        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono">{ch.phone}</span>
                        <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* ─── Center: timeline ─── */}
          <Card className="lg:col-span-2">
            <div className="p-5">
              <h3 className="mb-3 text-sm font-medium">Activity</h3>
              <form onSubmit={addNote} className="mb-4 flex gap-2">
                <Input
                  placeholder="Add a note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={busy || !note.trim()}>
                  <StickyNote className="h-3.5 w-3.5" /> Add
                </Button>
              </form>

              <Timeline activities={lead.activities || []} />
            </div>
          </Card>
        </div>

        {/* ─── Tasks ─── */}
        <Card className="mt-4">
          <div className="p-5">
            <h3 className="mb-3 text-sm font-medium">Tasks</h3>
            <form onSubmit={addTask} className="mb-4 flex flex-wrap gap-2">
              <Input
                placeholder="Task title"
                className="min-w-[260px] flex-1"
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              />
              <DateTimeInput
                value={newTask.dueAt}
                onChange={(e) => setNewTask({ ...newTask, dueAt: e.target.value })}
                className="w-56 shrink-0"
              />
              <Button type="submit" size="sm" disabled={busy || !newTask.title.trim()}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </form>

            {(lead.tasks || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
            ) : (
              <ul className="divide-y">
                {lead.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <button
                      onClick={() => toggleTask(t)}
                      className="text-muted-foreground hover:text-foreground"
                      disabled={busy}
                    >
                      {t.status === "DONE" ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <CircleDashed className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "text-sm",
                          t.status === "DONE" && "text-muted-foreground line-through",
                        )}
                      >
                        {t.title}
                      </div>
                      {t.dueAt && (
                        <div className="text-[11px] text-muted-foreground">
                          <Calendar className="mr-1 inline h-3 w-3" />
                          due {new Date(t.dueAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {t.assignedTo?.name && (
                      <span className="text-[11px] text-muted-foreground">{t.assignedTo.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="truncate">{children}</div>
      </div>
    </div>
  );
}

// Compact key/value row for the attribution panel. Truncates long URLs
// with a title attribute so the operator can still hover-inspect them.
function Attr({ label, value, mono, truncate }) {
  return (
    <div className="flex gap-2">
      <dt className="min-w-[88px] shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 flex-1",
          mono && "font-mono",
          truncate && "truncate",
        )}
        title={truncate ? value : undefined}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

function Timeline({ activities }) {
  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {activities.map((a) => (
        <li key={a.id} className="flex gap-3">
          <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
          <div className="min-w-0 flex-1">
            <div className="text-xs">
              <ActivityLine a={a} />
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(a.createdAt).toLocaleString()}
              {a.actor?.name && <> · {a.actor.name}</>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityLine({ a }) {
  if (a.kind === "STAGE_CHANGE") {
    return (
      <span>
        Moved from <strong>{a.stageFrom?.name || "?"}</strong> to{" "}
        <strong>{a.stageTo?.name || "?"}</strong>
      </span>
    );
  }
  if (a.kind === "ASSIGNMENT") {
    if (a.data?.event === "lead_created") return <span>Lead created</span>;
    return <span>Reassigned</span>;
  }
  if (a.kind === "NOTE") {
    return <span>📝 {a.note?.body || a.data?.body || "(note)"}</span>;
  }
  if (a.kind === "TASK") {
    return (
      <span>
        {a.data?.event === "task_status_changed"
          ? `Task ${a.data.from} → ${a.data.to}`
          : a.data?.event === "task_created"
          ? `Task created: ${a.data.title}`
          : "Task"}
      </span>
    );
  }
  if (a.kind === "MESSAGE") return <span>Message exchanged</span>;
  if (a.kind === "AUTOMATION") return <span>Automation fired</span>;
  return <span>{a.kind}</span>;
}
