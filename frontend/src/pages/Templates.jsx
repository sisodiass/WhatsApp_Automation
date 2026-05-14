import { useEffect, useRef, useState } from "react";
import { Eye, FileText, Plus } from "lucide-react";
import { api } from "../lib/api.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import VariableTextarea from "../components/VariableTextarea.jsx";

const TYPES = [
  { value: "ONBOARDING_DEFAULT", label: "Onboarding (default)", help: "Sent when a new session starts and the campaign has no custom onboarding." },
  { value: "MANUAL_HANDOFF", label: "Manual handoff", help: "Sent when AI escalates to a human (10-cap or admin-forced)." },
  { value: "FALLBACK", label: "Fallback", help: "Sent when KB confidence is below threshold or generation fails. Counts toward the 10-cap." },
  { value: "SESSION_RESUME", label: "Session resume", help: "Sent when a returning customer messages after the configured idle threshold (24h default) — but before reset." },
  { value: "DEMO_CONFIRMATION", label: "Demo confirmation", help: "Sent after a demo is booked." },
];

const empty = {
  name: "",
  type: "ONBOARDING_DEFAULT",
  content: "",
  variables: [],
  isActive: true,
};

export default function Templates() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState("");
  const previewTimer = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/templates");
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Live preview — debounce + send the current content to the backend
  // renderer so the operator sees exactly what customers will see.
  useEffect(() => {
    if (!editing || !form.content) {
      setPreview("");
      return;
    }
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.post("/templates/preview", { content: form.content });
        setPreview(data.rendered || "");
      } catch {
        setPreview("");
      }
    }, 250);
    return () => clearTimeout(previewTimer.current);
  }, [editing, form.content]);

  function openNew() { setEditing({}); setForm(empty); setError(null); setPreview(""); }
  function openEdit(t) {
    setEditing(t);
    setForm({
      name: t.name,
      type: t.type,
      content: t.content,
      variables: t.variables || [],
      isActive: t.isActive,
    });
    setError(null);
  }
  function close() { setEditing(null); }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        content: form.content,
        variables: form.variables.filter(Boolean),
        isActive: form.isActive,
      };
      if (editing.id) await api.patch(`/templates/${editing.id}`, payload);
      else await api.post("/templates", payload);
      await load();
      close();
    } catch (err) {
      setError(err.response?.data?.error?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t) {
    const ok = await confirm({
      title: `Delete template "${t.name}"?`,
      description: "If this is the only active template of its type, the system will fall back to a hardcoded string.",
      variant: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/templates/${t.id}`);
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={FileText}
        title="Message Templates"
        subtitle={loading ? "Loading…" : `${items.length} template${items.length !== 1 ? "s" : ""}`}
        actions={
          <Button onClick={openNew} size="sm">
            <Plus className="h-3.5 w-3.5" />
            New template
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : items.length === 0 ? (
          <Card className="border-dashed">
            <p className="p-12 text-center text-sm text-muted-foreground">
              No templates yet — run the seed.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((t) => (
              <Card key={t.id} className={!t.isActive ? "opacity-60" : ""}>
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{t.name}</span>
                      <Badge variant="muted">{t.type}</Badge>
                      {!t.isActive && <Badge variant="warning">inactive</Badge>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{t.content}</p>
                    {t.variables?.length > 0 && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Variables:{" "}
                        {t.variables.map((v) => (
                          <code key={v} className="ml-1 rounded bg-muted px-1 font-mono">{`{{${v}}}`}</code>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => openEdit(t)}>Edit</Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(t)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {editing && (
          <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
            <form onSubmit={save} className="w-full max-w-2xl animate-slide-up">
              <Card>
                <div className="p-6">
                  <h2 className="text-lg font-semibold tracking-tight">
                    {editing.id ? "Edit template" : "New template"}
                  </h2>

                  <div className="mt-4 space-y-3">
                    <Field label="Name (lowercase, underscores)">
                      <Input
                        required
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value.toLowerCase().replace(/\s+/g, "_") })
                        }
                        placeholder="manual_handoff"
                        className="font-mono"
                      />
                    </Field>

                    <Field label="Type">
                      <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                        {TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </Select>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {TYPES.find((x) => x.value === form.type)?.help}
                      </span>
                    </Field>

                    <Field label="Content (use {{var}} or {{var|format}})">
                      <VariableTextarea
                        rows={5}
                        value={form.content}
                        onChange={(content) => setForm({ ...form, content })}
                      />
                    </Field>

                    {preview && (
                      <div className="rounded-md border bg-muted/40 p-3">
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <Eye className="h-3 w-3" /> Live preview (sample data)
                        </div>
                        <div className="whitespace-pre-wrap text-sm">{preview}</div>
                      </div>
                    )}

                    <Field label="Variables (comma-separated)">
                      <Input
                        value={(form.variables || []).join(", ")}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            variables: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="customer_name, scheduled_at"
                      />
                    </Field>

                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      />
                      <span>Active</span>
                    </label>
                  </div>

                  {error && (
                    <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {error}
                    </div>
                  )}

                  <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
                    <Button type="submit" disabled={busy}>Save</Button>
                  </div>
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
