import { useEffect, useState } from "react";
import { Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { SkeletonTable } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

const COLOR_PALETTE = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];

export default function Tags() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", color: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/tags");
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing({});
    setForm({ name: "", color: "" });
    setError(null);
  }
  function openEdit(t) {
    setEditing(t);
    setForm({ name: t.name, color: t.color || "" });
    setError(null);
  }
  function close() { setEditing(null); }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { name: form.name.trim(), color: form.color || null };
      if (editing.id) await api.patch(`/tags/${editing.id}`, payload);
      else await api.post("/tags", payload);
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
      title: `Delete tag "${t.name}"?`,
      description: "Existing chat assignments will be removed.",
      variant: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/tags/${t.id}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={TagIcon}
        title="Tags"
        subtitle={loading ? "Loading…" : `${items.length} tag${items.length !== 1 ? "s" : ""}`}
        actions={
          <Button onClick={openNew} size="sm">
            <Plus className="h-3.5 w-3.5" />
            New tag
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <SkeletonTable rows={4} cols={4} />
        ) : items.length === 0 ? (
          <Card className="border-dashed">
            <p className="p-12 text-center text-sm text-muted-foreground">No tags yet.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">Color</th>
                  <th className="px-4 py-2 text-left font-medium">Chats</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-accent">
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs"
                        style={
                          t.color
                            ? { backgroundColor: t.color, color: "white" }
                            : undefined
                        }
                      >
                        {t.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {t.color || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t._count?.chats ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="xs" variant="outline" onClick={() => openEdit(t)}>Edit</Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => remove(t)}
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

        {editing && (
          <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
            <form onSubmit={save} className="w-full max-w-sm animate-slide-up">
              <Card>
                <div className="p-6">
                  <h2 className="text-lg font-semibold tracking-tight">
                    {editing.id ? "Edit tag" : "New tag"}
                  </h2>

                  <div className="mt-4 space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium">Name</span>
                      <Input
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium">Color (optional)</span>
                      <div className="flex flex-wrap gap-1.5">
                        {COLOR_PALETTE.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setForm({ ...form, color: c })}
                            className={cn(
                              "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                              form.color === c ? "border-foreground" : "border-transparent",
                            )}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, color: "" })}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full border-2 bg-background text-xs",
                            !form.color ? "border-foreground" : "border-border",
                          )}
                          title="No color"
                        >
                          ✕
                        </button>
                      </div>
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
