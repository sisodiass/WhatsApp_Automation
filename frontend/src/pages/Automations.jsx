import { useEffect, useState } from "react";
import { Bot, Plus, Trash2, X, Zap } from "lucide-react";
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

const TRIGGERS = [
  { value: "NEW_LEAD",         label: "New lead created" },
  { value: "STAGE_CHANGED",    label: "Lead stage changed" },
  { value: "LEAD_ASSIGNED",    label: "Lead assignment changed" },
  { value: "NO_REPLY",         label: "Follow-up reminder fired (no reply)" },
];

const STARTER_EXAMPLE = {
  steps: [
    { type: "WAIT", minutes: 30 },
    { type: "SEND_MESSAGE", templateName: "onboarding_default" },
    { type: "IF", condition: "no_reply:24" },
    { type: "CREATE_TASK", title: "Follow up with lead", daysOut: 1 },
  ],
};

const EMPTY = {
  name: "",
  trigger: "NEW_LEAD",
  isActive: true,
  triggerConfig: "",
  definition: JSON.stringify(STARTER_EXAMPLE, null, 2),
};

const STATUS_PRESET = {
  PENDING:   { variant: "muted",       label: "Pending" },
  RUNNING:   { variant: "info",        label: "Running" },
  WAITING:   { variant: "warning",     label: "Waiting" },
  DONE:      { variant: "success",     label: "Done" },
  FAILED:    { variant: "destructive", label: "Failed" },
  CANCELLED: { variant: "muted",       label: "Cancelled" },
};

export default function Automations() {
  const [items, setItems] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        api.get("/automations"),
        api.get("/automations/runs?limit=30"),
      ]);
      setItems(a.data.items || []);
      setRuns(r.data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() { setEditing({}); setForm(EMPTY); }
  function openEdit(a) {
    setEditing(a);
    setForm({
      name: a.name,
      trigger: a.trigger,
      isActive: a.isActive,
      triggerConfig: a.triggerConfig ? JSON.stringify(a.triggerConfig, null, 2) : "",
      definition: JSON.stringify(a.definition, null, 2),
    });
  }
  function close() { setEditing(null); }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      let definition;
      try {
        definition = JSON.parse(form.definition);
      } catch (err) {
        toast.error("Definition must be valid JSON");
        return;
      }
      let triggerConfig = null;
      if (form.triggerConfig?.trim()) {
        try {
          triggerConfig = JSON.parse(form.triggerConfig);
        } catch {
          toast.error("Trigger config must be valid JSON (or empty)");
          return;
        }
      }
      const payload = {
        name: form.name.trim(),
        trigger: form.trigger,
        isActive: form.isActive,
        triggerConfig,
        definition,
      };
      if (editing.id) await api.patch(`/automations/${editing.id}`, payload);
      else await api.post("/automations", payload);
      toast.success("Saved");
      close();
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a) {
    setBusy(true);
    try {
      await api.patch(`/automations/${a.id}`, { isActive: !a.isActive });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(a) {
    const ok = await confirm({
      title: `Delete automation "${a.name}"?`,
      description: "Past run history is also removed.",
      variant: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/automations/${a.id}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Bot}
        title="Automations"
        subtitle={loading ? "Loading…" : `${items.length} automation${items.length !== 1 ? "s" : ""}`}
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> New automation
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : items.length === 0 ? (
          <Card className="border-dashed">
            <p className="p-12 text-center text-sm text-muted-foreground">
              No automations yet. Define workflows that fire when leads change state.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">Trigger</th>
                  <th className="px-4 py-2 text-left font-medium">Steps</th>
                  <th className="px-4 py-2 text-right font-medium">Runs</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((a) => (
                  <tr key={a.id} className="hover:bg-accent">
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.name}</div>
                      {!a.isActive && <Badge variant="muted">inactive</Badge>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <code className="rounded bg-muted px-1.5 py-0.5">{a.trigger}</code>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-muted-foreground">
                        {(a.definition?.steps || []).length} step
                        {(a.definition?.steps || []).length !== 1 ? "s" : ""}
                      </span>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {(a.definition?.steps || []).map((s, i) => (
                          <span key={i} className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                            {s.type}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs">{a._count?.runs ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="xs" variant="outline" onClick={() => toggleActive(a)}>
                          {a.isActive ? "Pause" : "Resume"}
                        </Button>
                        <Button size="xs" variant="outline" onClick={() => openEdit(a)}>
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => remove(a)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {runs.length > 0 && (
          <Card className="mt-4 overflow-hidden">
            <div className="border-b px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
              Recent runs
            </div>
            <table className="min-w-full text-xs">
              <tbody className="divide-y">
                {runs.slice(0, 20).map((r) => {
                  const preset = STATUS_PRESET[r.status] || { variant: "muted", label: r.status };
                  const c = r.lead?.contact;
                  const name = c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.mobile : "(unknown)";
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(r.startedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">{r.automation?.name}</td>
                      <td className="px-4 py-2">{name}</td>
                      <td className="px-4 py-2">
                        <Badge variant={preset.variant}>{preset.label}</Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">step {r.currentStep}</td>
                      {r.error && <td className="px-4 py-2 text-destructive">{r.error}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {editing && <EditorModal form={form} setForm={setForm} onClose={close} onSave={save} busy={busy} editing={editing} />}
      </div>
    </div>
  );
}

function EditorModal({ form, setForm, onClose, onSave, busy, editing }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
      <form onSubmit={onSave} className="w-full max-w-4xl animate-slide-up">
        <Card>
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-base font-semibold tracking-tight">
              {editing.id ? "Edit automation" : "New automation"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">
              <Field label="Name">
                <Input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Welcome new leads"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Trigger">
                  <Select
                    value={form.trigger}
                    onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                  >
                    {TRIGGERS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Active">
                  <label className="inline-flex h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    />
                    <span>Listening for events</span>
                  </label>
                </Field>
              </div>
              <Field label="Trigger filter (optional JSON)">
                <textarea
                  rows={2}
                  className="block w-full rounded-md border bg-background px-3 py-2 font-mono text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder='{"toStageId":"..."}  or leave blank'
                  value={form.triggerConfig}
                  onChange={(e) => setForm({ ...form, triggerConfig: e.target.value })}
                />
              </Field>
              <Field label="Definition (JSON)">
                <textarea
                  required
                  rows={14}
                  className="block w-full rounded-md border bg-background px-3 py-2 font-mono text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={form.definition}
                  onChange={(e) => setForm({ ...form, definition: e.target.value })}
                />
              </Field>
            </div>

            <div className="lg:col-span-1">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Step reference
              </h3>
              <StepReference />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              Save
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

function StepReference() {
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-[11px]">
      <StepDoc type="WAIT" example={`{ "type": "WAIT", "minutes": 30 }`}>
        Pause for N minutes before the next step.
      </StepDoc>
      <StepDoc type="SEND_MESSAGE" example={`{ "type": "SEND_MESSAGE", "templateName": "onboarding_default" }`}>
        Render the named template against the lead and send as SYSTEM.
      </StepDoc>
      <StepDoc type="ASSIGN" example={`{ "type": "ASSIGN", "userId": "..." }`}>
        Set the lead's assignedTo.
      </StepDoc>
      <StepDoc type="ADD_TAG" example={`{ "type": "ADD_TAG", "tagId": "..." }`}>
        Attach a tag to the contact's chats.
      </StepDoc>
      <StepDoc type="MOVE_STAGE" example={`{ "type": "MOVE_STAGE", "stageId": "..." }`}>
        Move the lead to a new stage. Emits STAGE_CHANGED.
      </StepDoc>
      <StepDoc type="CREATE_TASK" example={`{ "type": "CREATE_TASK", "title": "...", "daysOut": 1 }`}>
        Create a follow-up task on the lead.
      </StepDoc>
      <StepDoc type="IF" example={`{ "type": "IF", "condition": "no_reply:24" }`}>
        Guard. Continues only if the condition holds. Otherwise ends the run.
        <div className="mt-1 text-muted-foreground">
          Conditions: <code className="rounded bg-background px-1">no_reply:hours</code>,{" "}
          <code className="rounded bg-background px-1">has_tag:tagId</code>,{" "}
          <code className="rounded bg-background px-1">stage_is:stageId</code>
        </div>
      </StepDoc>
    </div>
  );
}

function StepDoc({ type, example, children }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center gap-1.5">
        <Zap className="h-3 w-3 text-primary" />
        <code className="font-mono text-[11px] font-semibold">{type}</code>
      </div>
      <div className="ml-4 mt-0.5 text-[11px] text-muted-foreground">{children}</div>
      <pre className="ml-4 mt-1 overflow-x-auto rounded bg-background px-2 py-1 text-[10px]">
        {example}
      </pre>
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
