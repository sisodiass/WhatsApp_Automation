import { useEffect, useState } from "react";
import { Bell, Plus, Trash2, X } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

const EMPTY = {
  name: "",
  templateName: "",
  pipelineId: "",
  stageId: "",
  hoursSinceLastInbound: 24,
  maxReminders: 1,
  quietHoursStart: "",
  quietHoursEnd: "",
  isActive: true,
};

export default function Followups() {
  const [rules, setRules] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r, p, t, l] = await Promise.all([
        api.get("/followups"),
        api.get("/pipelines"),
        api.get("/templates"),
        api.get("/followups/logs?limit=30"),
      ]);
      setRules(r.data.items || []);
      setPipelines(p.data.items || []);
      setTemplates(t.data.items || []);
      setLogs(l.data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setEditing({});
    setForm(EMPTY);
  }
  function openEdit(r) {
    setEditing(r);
    setForm({
      name: r.name,
      templateName: r.templateName,
      pipelineId: r.pipelineId || "",
      stageId: r.stageId || "",
      hoursSinceLastInbound: r.hoursSinceLastInbound,
      maxReminders: r.maxReminders,
      quietHoursStart: r.quietHoursStart || "",
      quietHoursEnd: r.quietHoursEnd || "",
      isActive: r.isActive,
    });
  }
  function close() {
    setEditing(null);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        templateName: form.templateName.trim(),
        hoursSinceLastInbound: Number(form.hoursSinceLastInbound),
        maxReminders: Number(form.maxReminders),
        isActive: form.isActive,
        pipelineId: form.pipelineId || null,
        stageId: form.stageId || null,
      };
      if (form.quietHoursStart && form.quietHoursEnd) {
        payload.quietHoursStart = form.quietHoursStart;
        payload.quietHoursEnd = form.quietHoursEnd;
      } else {
        payload.quietHoursStart = null;
        payload.quietHoursEnd = null;
      }
      if (editing.id) await api.patch(`/followups/${editing.id}`, payload);
      else await api.post("/followups", payload);
      toast.success("Saved");
      close();
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r) {
    const ok = await confirm({
      title: `Delete rule "${r.name}"?`,
      description: "Sent reminders stay in the log; future fires stop.",
      variant: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/followups/${r.id}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r) {
    setBusy(true);
    try {
      await api.patch(`/followups/${r.id}`, { isActive: !r.isActive });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const stagesForPipeline =
    pipelines.find((p) => p.id === form.pipelineId)?.stages || [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Bell}
        title="Auto Follow-ups"
        subtitle={loading ? "Loading…" : `${rules.length} rule${rules.length !== 1 ? "s" : ""}`}
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> New rule
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : rules.length === 0 ? (
          <Card className="border-dashed">
            <p className="p-12 text-center text-sm text-muted-foreground">
              No follow-up rules yet. Create one to send reminders when leads go quiet.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Rule</th>
                  <th className="px-4 py-2 text-left font-medium">Scope</th>
                  <th className="px-4 py-2 text-left font-medium">Trigger</th>
                  <th className="px-4 py-2 text-left font-medium">Template</th>
                  <th className="px-4 py-2 text-right font-medium">Reminders sent</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rules.map((r) => {
                  const pip = pipelines.find((p) => p.id === r.pipelineId);
                  const stg = pip?.stages?.find((s) => s.id === r.stageId);
                  const scope = pip
                    ? `${pip.name}${stg ? ` / ${stg.name}` : ""}`
                    : "All pipelines";
                  return (
                    <tr key={r.id} className="hover:bg-accent">
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.name}</div>
                        {!r.isActive && <Badge variant="muted">inactive</Badge>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{scope}</td>
                      <td className="px-4 py-3 text-xs">
                        After {r.hoursSinceLastInbound}h idle · max {r.maxReminders}×
                        {r.quietHoursStart && r.quietHoursEnd && (
                          <div className="text-[10px] text-muted-foreground">
                            Quiet {r.quietHoursStart}–{r.quietHoursEnd}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.templateName}</td>
                      <td className="px-4 py-3 text-right text-xs">{r._count?.logs ?? 0}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="xs" variant="outline" onClick={() => toggleActive(r)} disabled={busy}>
                            {r.isActive ? "Pause" : "Resume"}
                          </Button>
                          <Button size="xs" variant="outline" onClick={() => openEdit(r)}>
                            Edit
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => remove(r)}
                          >
                            <Trash2 className="h-3 w-3" />
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

        {logs.length > 0 && (
          <Card className="mt-4 overflow-hidden">
            <div className="border-b px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
              Recent fires
            </div>
            <table className="min-w-full text-xs">
              <tbody className="divide-y">
                {logs.slice(0, 20).map((l) => {
                  const c = l.lead?.contact;
                  const name = c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.mobile : "(unknown)";
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(l.sentAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">{l.rule?.name}</td>
                      <td className="px-4 py-2">{name}</td>
                      <td className="px-4 py-2">
                        {l.error ? (
                          <span className="text-destructive">{l.error}</span>
                        ) : (
                          <span className="text-success">sent</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {editing && (
          <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
            <form onSubmit={save} className="w-full max-w-lg animate-slide-up">
              <Card>
                <div className="flex items-center justify-between border-b px-5 py-3">
                  <h2 className="text-base font-semibold tracking-tight">
                    {editing.id ? "Edit follow-up rule" : "New follow-up rule"}
                  </h2>
                  <button
                    type="button"
                    onClick={close}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-3 p-5">
                  <Field label="Name">
                    <Input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="24h reminder for Qualified leads"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Pipeline (optional)">
                      <Select
                        value={form.pipelineId}
                        onChange={(e) => setForm({ ...form, pipelineId: e.target.value, stageId: "" })}
                      >
                        <option value="">Any pipeline</option>
                        {pipelines.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Stage (optional)">
                      <Select
                        value={form.stageId}
                        onChange={(e) => setForm({ ...form, stageId: e.target.value })}
                        disabled={!form.pipelineId}
                      >
                        <option value="">Any stage</option>
                        {stagesForPipeline.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  <Field label="Template (by name)">
                    <Select
                      required
                      value={form.templateName}
                      onChange={(e) => setForm({ ...form, templateName: e.target.value })}
                    >
                      <option value="">— select a template —</option>
                      {templates
                        .filter((t) => t.isActive)
                        .map((t) => (
                          <option key={t.id} value={t.name}>
                            {t.name} ({t.type})
                          </option>
                        ))}
                    </Select>
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Idle threshold (hours)">
                      <Input
                        type="number"
                        min={1}
                        max={8760}
                        value={form.hoursSinceLastInbound}
                        onChange={(e) => setForm({ ...form, hoursSinceLastInbound: e.target.value })}
                      />
                    </Field>
                    <Field label="Max reminders per lead">
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={form.maxReminders}
                        onChange={(e) => setForm({ ...form, maxReminders: e.target.value })}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
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
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    />
                    <span>Active</span>
                  </label>
                </div>
                <div className="flex justify-end gap-2 border-t px-5 py-3">
                  <Button type="button" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy || !form.name.trim() || !form.templateName.trim()}>
                    Save
                  </Button>
                </div>
              </Card>
            </form>
          </div>
        )}
      </div>
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
