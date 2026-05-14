import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  Megaphone,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { DateTimeInput } from "../components/ui/DateTimeInput.jsx";
import VariableTextarea from "../components/VariableTextarea.jsx";
import { cn } from "../lib/cn.js";

const STATUS_PRESET = {
  DRAFT:            { variant: "muted",       label: "Draft" },
  PENDING_APPROVAL: { variant: "warning",     label: "Pending approval" },
  SCHEDULED:        { variant: "info",        label: "Scheduled" },
  RUNNING:          { variant: "info",        label: "Running" },
  PAUSED:           { variant: "warning",     label: "Paused" },
  COMPLETED:        { variant: "success",     label: "Completed" },
  CANCELLED:        { variant: "muted",       label: "Cancelled" },
};

const EMPTY_FORM = {
  name: "",
  messageBody: "",
  scheduledAt: "",
  dailyLimit: 500,
  delayMin: 30,
  delayMax: 60,
  quietHoursStart: "",
  quietHoursEnd: "",
  skipRepliedHours: 0,
};

export default function BulkCampaigns() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function loadList() {
    setLoading(true);
    try {
      const { data } = await api.get("/bulk-campaigns");
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadList(); }, []);

  async function createBulk(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        messageBody: form.messageBody,
        dailyLimit: Number(form.dailyLimit) || 500,
        delayMin: Number(form.delayMin) || 30,
        delayMax: Number(form.delayMax) || 60,
        skipRepliedHours: Number(form.skipRepliedHours) || 0,
      };
      if (form.scheduledAt) payload.scheduledAt = new Date(form.scheduledAt).toISOString();
      if (form.quietHoursStart && form.quietHoursEnd) {
        payload.quietHoursStart = form.quietHoursStart;
        payload.quietHoursEnd = form.quietHoursEnd;
      }
      const { data } = await api.post("/bulk-campaigns", payload);
      toast.success(`Created "${data.name}"`);
      setCreating(false);
      setForm(EMPTY_FORM);
      await loadList();
      setSelectedId(data.id);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  if (selectedId) {
    return (
      <BulkCampaignDetail
        bulkId={selectedId}
        onBack={() => {
          setSelectedId(null);
          loadList();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Megaphone}
        title="Bulk Campaigns"
        subtitle={loading ? "Loading…" : `${items.length} campaign${items.length !== 1 ? "s" : ""}`}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New bulk
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : items.length === 0 ? (
          <Card className="border-dashed">
            <p className="p-12 text-center text-sm text-muted-foreground">
              No bulk campaigns yet. Create one to broadcast a WhatsApp message to your contacts.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Recipients</th>
                  <th className="px-4 py-2 text-right font-medium">Sent / Replied</th>
                  <th className="px-4 py-2 text-left font-medium">Scheduled</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((b) => {
                  const preset = STATUS_PRESET[b.status] || { variant: "muted", label: b.status };
                  return (
                    <tr
                      key={b.id}
                      className="cursor-pointer transition-colors hover:bg-accent"
                      onClick={() => setSelectedId(b.id)}
                    >
                      <td className="px-4 py-3 font-medium">{b.name}</td>
                      <td className="px-4 py-3">
                        <Badge variant={preset.variant}>{preset.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {b._count?.recipients ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {b.sentCount} / {b.repliedCount}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {creating && (
          <Modal title="New bulk campaign" onClose={() => setCreating(false)} wide>
            <form onSubmit={createBulk} className="space-y-3">
              <Field label="Name">
                <Input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Diwali Promo, Onboarding Wave 3, etc."
                />
              </Field>
              <Field label="Message (variables supported)">
                <VariableTextarea
                  rows={4}
                  value={form.messageBody}
                  onChange={(messageBody) => setForm({ ...form, messageBody })}
                />
              </Field>
              <BulkPreviewPane content={form.messageBody} />
              <SafetyKnobs form={form} setForm={setForm} />
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !form.name.trim() || !form.messageBody.trim()}>
                  Create draft
                </Button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}

function BulkCampaignDetail({ bulkId, onBack }) {
  const [bulk, setBulk] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  async function loadAll() {
    const [b, a, r] = await Promise.all([
      api.get(`/bulk-campaigns/${bulkId}`),
      api.get(`/bulk-campaigns/${bulkId}/analytics`),
      api.get(`/bulk-campaigns/${bulkId}/recipients?pageSize=100`),
    ]);
    setBulk(b.data);
    setAnalytics(a.data);
    setRecipients(r.data.items || []);
  }

  useEffect(() => {
    loadAll();
    // Poll analytics every 8s — bulk progress is request/response, not socket.
    const t = setInterval(() => {
      api.get(`/bulk-campaigns/${bulkId}/analytics`).then((r) => setAnalytics(r.data)).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkId]);

  async function transition(verb, body) {
    setBusy(true);
    try {
      await api.post(`/bulk-campaigns/${bulkId}/${verb}`, body || {});
      toast.success(verb.replace(/^./, (c) => c.toUpperCase()));
      await loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || `${verb} failed`);
    } finally {
      setBusy(false);
    }
  }

  async function removeRec(r) {
    if (r.status !== "PENDING") {
      toast.error("Only PENDING recipients can be removed");
      return;
    }
    setBusy(true);
    try {
      await api.delete(`/bulk-campaigns/${bulkId}/recipients/${r.id}`);
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  if (!bulk) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Loading…" />
        <div className="p-6">
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  const preset = STATUS_PRESET[bulk.status] || { variant: "muted", label: bulk.status };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Megaphone}
        title={bulk.name}
        subtitle={preset.label}
        actions={
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="p-5">
              <h3 className="mb-2 text-sm font-medium">Message</h3>
              <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
                {bulk.messageBody}
              </pre>
              <BulkPreviewPane content={bulk.messageBody} />
            </div>
          </Card>

          <Card>
            <div className="p-5">
              <h3 className="mb-3 text-sm font-medium">Status</h3>
              <Badge variant={preset.variant}>{preset.label}</Badge>
              {bulk.scheduledAt && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Scheduled: {new Date(bulk.scheduledAt).toLocaleString()}
                </p>
              )}
              {bulk.startedAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Started: {new Date(bulk.startedAt).toLocaleString()}
                </p>
              )}
              {bulk.completedAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Completed: {new Date(bulk.completedAt).toLocaleString()}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-1.5">
                <LifecycleButtons status={bulk.status} busy={busy} onTransition={transition} />
              </div>
            </div>
          </Card>

          <Card className="lg:col-span-3">
            <div className="p-5">
              <h3 className="mb-3 text-sm font-medium">Analytics</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <Metric label="Total" value={analytics?.total ?? 0} />
                <Metric label="Pending" value={analytics?.pending ?? 0} />
                <Metric label="Queued" value={analytics?.queued ?? 0} />
                <Metric label="Sent" value={analytics?.sent ?? 0} accent="info" />
                <Metric label="Delivered" value={analytics?.delivered ?? 0} accent="info" />
                <Metric label="Replied" value={analytics?.replied ?? 0} accent="success" />
                <Metric label="Failed" value={analytics?.failed ?? 0} accent="destructive" />
              </div>
            </div>
          </Card>

          <Card className="lg:col-span-3">
            <div className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium">Recipients</h3>
                {["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PAUSED"].includes(bulk.status) && (
                  <Button size="xs" variant="outline" onClick={() => setShowAdd(true)}>
                    <Plus className="h-3 w-3" /> Add by filter
                  </Button>
                )}
              </div>
              {recipients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recipients yet.</p>
              ) : (
                <table className="min-w-full text-xs">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Contact</th>
                      <th className="px-2 py-1 text-left font-medium">Mobile</th>
                      <th className="px-2 py-1 text-left font-medium">Status</th>
                      <th className="px-2 py-1 text-left font-medium">Sent at</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recipients.slice(0, 100).map((r) => {
                      const c = r.contact;
                      const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.mobile;
                      return (
                        <tr key={r.id}>
                          <td className="px-2 py-1.5">{name}</td>
                          <td className="px-2 py-1.5 font-mono">{c.mobile}</td>
                          <td className="px-2 py-1.5">
                            <span
                              className={cn(
                                "rounded-full px-1.5 text-[10px]",
                                r.status === "SENT" && "bg-info/15 text-info",
                                r.status === "DELIVERED" && "bg-info/15 text-info",
                                r.status === "READ" && "bg-success/15 text-success",
                                r.status === "REPLIED" && "bg-success/15 text-success",
                                r.status === "FAILED" && "bg-destructive/15 text-destructive",
                                r.status === "QUEUED" && "bg-warning/15 text-warning",
                                r.status === "PENDING" && "bg-muted text-muted-foreground",
                              )}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {r.status === "PENDING" && (
                              <button
                                onClick={() => removeRec(r)}
                                className="text-muted-foreground hover:text-destructive"
                                disabled={busy}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      </div>

      {showAdd && (
        <AddRecipientsModal
          bulkId={bulkId}
          onClose={() => setShowAdd(false)}
          onAdded={async () => {
            setShowAdd(false);
            await loadAll();
          }}
        />
      )}
    </div>
  );
}

function LifecycleButtons({ status, busy, onTransition }) {
  const sched = { variant: "default", icon: Send,         label: "Approve + schedule", verb: "approve", hint: null };
  const submit = { variant: "outline", icon: CheckCircle2, label: "Submit",             verb: "submit" };
  const pause = { variant: "outline", icon: Pause,         label: "Pause",              verb: "pause" };
  const resume = { variant: "outline", icon: Play,         label: "Resume",             verb: "resume" };
  const cancel = { variant: "ghost",   icon: X,            label: "Cancel",             verb: "cancel", destructive: true };

  const map = {
    DRAFT:            [submit, sched, cancel],
    PENDING_APPROVAL: [sched, cancel],
    SCHEDULED:        [pause, cancel],
    RUNNING:          [pause, cancel],
    PAUSED:           [resume, cancel],
    COMPLETED:        [],
    CANCELLED:        [],
  };
  const buttons = map[status] || [];

  return (
    <>
      {buttons.map((b) => {
        const Icon = b.icon;
        return (
          <Button
            key={b.verb}
            size="xs"
            variant={b.variant}
            className={b.destructive ? "text-destructive" : ""}
            disabled={busy}
            onClick={async () => {
              if (b.destructive) {
                const ok = await confirm({
                  title: `${b.label} this bulk?`,
                  description: "This cannot be undone.",
                  variant: "destructive",
                  confirmLabel: b.label,
                });
                if (!ok) return;
              }
              onTransition(b.verb);
            }}
          >
            <Icon className="h-3 w-3" /> {b.label}
          </Button>
        );
      })}
    </>
  );
}

function AddRecipientsModal({ bulkId, onClose, onAdded }) {
  const [filter, setFilter] = useState({ search: "", source: "" });
  const [previewIds, setPreviewIds] = useState(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true);
    try {
      const { data } = await api.post(`/bulk-campaigns/${bulkId}/audience/preview`, filter);
      setPreviewIds(data.contactIds);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!previewIds?.length) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/bulk-campaigns/${bulkId}/recipients`, {
        contactIds: previewIds,
      });
      toast.success(`Added ${data.added} recipient${data.added !== 1 ? "s" : ""} (${data.skipped} skipped)`);
      onAdded();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Add failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add recipients" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Search (name / mobile / email / company)">
          <Input
            value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            placeholder="optional substring"
          />
        </Field>
        <Field label="Source (exact match)">
          <Input
            value={filter.source}
            onChange={(e) => setFilter({ ...filter, source: e.target.value })}
            placeholder="optional, e.g. webform"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={runPreview} disabled={busy}>
            <Eye className="h-3 w-3" /> Preview
          </Button>
        </div>
        {previewIds !== null && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div className="font-medium">{previewIds.length} contact{previewIds.length !== 1 ? "s" : ""} match</div>
            <div className="mt-0.5 text-muted-foreground">
              Existing recipients are skipped automatically.
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={add} disabled={busy || !previewIds?.length}>
            Add to bulk
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SafetyKnobs({ form, setForm }) {
  return (
    <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">Safety + scheduling</summary>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Schedule at (optional)">
          <DateTimeInput
            value={form.scheduledAt}
            onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
          />
        </Field>
        <Field label="Daily limit">
          <Input
            type="number"
            value={form.dailyLimit}
            onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })}
          />
        </Field>
        <Field label="Delay min (seconds)">
          <Input
            type="number"
            value={form.delayMin}
            onChange={(e) => setForm({ ...form, delayMin: e.target.value })}
          />
        </Field>
        <Field label="Delay max (seconds)">
          <Input
            type="number"
            value={form.delayMax}
            onChange={(e) => setForm({ ...form, delayMax: e.target.value })}
          />
        </Field>
        <Field label="Quiet hours start (HH:MM, optional)">
          <Input
            value={form.quietHoursStart}
            onChange={(e) => setForm({ ...form, quietHoursStart: e.target.value })}
            placeholder="22:00"
          />
        </Field>
        <Field label="Quiet hours end (HH:MM, optional)">
          <Input
            value={form.quietHoursEnd}
            onChange={(e) => setForm({ ...form, quietHoursEnd: e.target.value })}
            placeholder="08:00"
          />
        </Field>
        <Field label="Skip if replied within (hours)">
          <Input
            type="number"
            value={form.skipRepliedHours}
            onChange={(e) => setForm({ ...form, skipRepliedHours: e.target.value })}
          />
        </Field>
      </div>
    </details>
  );
}

function BulkPreviewPane({ content }) {
  const [rendered, setRendered] = useState("");
  const timer = useRef(null);
  useEffect(() => {
    if (!content) {
      setRendered("");
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.post("/templates/preview", { content });
        setRendered(data.rendered || "");
      } catch {
        setRendered("");
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [content]);
  if (!rendered) return null;
  return (
    <div className="mt-3 rounded-md border bg-muted/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Eye className="h-3 w-3" /> Preview (sample data)
      </div>
      <div className="whitespace-pre-wrap text-sm">{rendered}</div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-center",
        accent === "info" && "border-info/30 bg-info/5",
        accent === "success" && "border-success/30 bg-success/5",
        accent === "destructive" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xl">{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, wide, children }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
      <div className={cn("w-full animate-slide-up", wide ? "max-w-2xl" : "max-w-md")}>
        <Card>
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5">{children}</div>
        </Card>
      </div>
    </div>
  );
}
