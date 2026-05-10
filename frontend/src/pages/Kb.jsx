import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  CircleDashed,
  CircleX,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

const STATUS_PRESET = {
  PENDING:    { variant: "muted",       Icon: CircleDashed },
  PROCESSING: { variant: "info",        Icon: Loader2 },
  READY:      { variant: "success",     Icon: CheckCircle2 },
  FAILED:     { variant: "destructive", Icon: CircleX },
};

export default function Kb() {
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [docs, setDocs] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [editing, setEditing] = useState(null);
  const [groupForm, setGroupForm] = useState({ name: "", description: "", confidenceThreshold: 0.82 });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function loadGroups() {
    setLoadingGroups(true);
    try {
      const { data } = await api.get("/kb/groups");
      setGroups(data.items || []);
    } finally {
      setLoadingGroups(false);
    }
  }

  async function loadDocs(groupId) {
    setLoadingDocs(true);
    try {
      const { data } = await api.get(`/kb/groups/${groupId}/documents`);
      setDocs(data.items || []);
    } finally {
      setLoadingDocs(false);
    }
  }

  useEffect(() => { loadGroups(); }, []);
  useEffect(() => { if (selected) loadDocs(selected.id); }, [selected]);

  // Auto-poll while any doc is processing.
  useEffect(() => {
    if (!selected) return;
    const pending = docs.some((d) => d.status === "PENDING" || d.status === "PROCESSING");
    if (!pending) return;
    const t = setInterval(() => loadDocs(selected.id), 2000);
    return () => clearInterval(t);
  }, [docs, selected]);

  function openNewGroup() {
    setEditing({});
    setGroupForm({ name: "", description: "", confidenceThreshold: 0.82 });
    setError(null);
  }

  function openEditGroup(g) {
    setEditing(g);
    setGroupForm({
      name: g.name,
      description: g.description || "",
      confidenceThreshold: g.confidenceThreshold,
    });
    setError(null);
  }

  function close() {
    setEditing(null);
    setError(null);
  }

  async function saveGroup(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: groupForm.name.trim(),
        description: groupForm.description || null,
        confidenceThreshold: Number(groupForm.confidenceThreshold),
      };
      if (editing.id) await api.patch(`/kb/groups/${editing.id}`, payload);
      else await api.post("/kb/groups", payload);
      await loadGroups();
      close();
    } catch (err) {
      setError(err.response?.data?.error?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup(g) {
    const ok = await confirm({
      title: `Delete KB group "${g.name}"?`,
      description: "All documents in this group and their embedded chunks will be removed. Campaigns referencing this group will lose their KB context.",
      variant: "destructive",
      confirmLabel: "Delete group",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/kb/groups/${g.id}`);
      if (selected?.id === g.id) setSelected(null);
      await loadGroups();
    } finally { setBusy(false); }
  }

  async function uploadFile(e) {
    const f = e.target.files?.[0];
    if (!f || !selected) return;
    const fd = new FormData();
    fd.append("file", f);
    setBusy(true);
    try {
      await api.post(`/kb/groups/${selected.id}/documents`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await loadDocs(selected.id);
      toast.success(`Uploaded ${f.name} — processing in background`);
    } catch (err) {
      toast.fromError(err, "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function reprocess(d) {
    setBusy(true);
    try {
      await api.post(`/kb/documents/${d.id}/reprocess`);
      await loadDocs(selected.id);
    } finally { setBusy(false); }
  }

  async function reembedGroup() {
    if (!selected) return;
    const ok = await confirm({
      title: `Re-embed all documents in "${selected.name}"?`,
      description: "Each document will be re-processed under the active AI provider. Existing chunks remain but become inactive once new ones land.",
      confirmLabel: "Re-embed",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/kb/groups/${selected.id}/reembed`);
      toast.success(`Enqueued ${data.enqueued} document(s) for re-embedding`);
      await loadDocs(selected.id);
    } catch (err) {
      toast.fromError(err, "Re-embed failed");
    } finally { setBusy(false); }
  }

  async function removeDoc(d) {
    const ok = await confirm({
      title: `Delete "${d.filename}" v${d.version}?`,
      description: "Embedded chunks will be removed and the document is no longer available to retrieval.",
      variant: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/kb/documents/${d.id}`);
      await loadDocs(selected.id);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={BookOpen}
        title="Knowledge Base"
        subtitle={loadingGroups ? "Loading…" : `${groups.length} group${groups.length !== 1 ? "s" : ""}`}
        actions={
          <Button onClick={openNewGroup} size="sm">
            <Plus className="h-3.5 w-3.5" />
            New group
          </Button>
        }
      />

      <main className="flex flex-1 overflow-hidden">
        {/* Groups list */}
        <aside className="scrollbar-thin w-60 shrink-0 overflow-y-auto border-r bg-card p-3">
          {loadingGroups ? (
            <div className="space-y-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : groups.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">
              No groups yet. Create one (e.g. "Sales", "Support").
            </p>
          ) : (
            <ul className="space-y-0.5">
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    onClick={() => setSelected(g)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                      selected?.id === g.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{g.name}</span>
                    <span className="text-xs">{g._count?.documents ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Documents */}
        <section className="scrollbar-thin flex-1 overflow-y-auto p-6">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a group on the left.</p>
          ) : (
            <>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">{selected.name}</h2>
                  {selected.description && (
                    <p className="text-sm text-muted-foreground">{selected.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Confidence threshold: {selected.confidenceThreshold}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button onClick={reembedGroup} disabled={busy} size="sm" variant="outline">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-embed group
                  </Button>
                  <Button onClick={() => openEditGroup(selected)} size="sm" variant="outline">
                    Edit
                  </Button>
                  <Button onClick={() => removeGroup(selected)} size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <Card className="mb-4 border-dashed">
                <label className="flex cursor-pointer items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Upload PDF</div>
                      <div className="text-xs text-muted-foreground">
                        Re-uploading the same filename auto-bumps the version.
                      </div>
                    </div>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf"
                    onChange={uploadFile}
                    disabled={busy}
                    className="text-xs file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
                  />
                </label>
              </Card>

              {loadingDocs ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : docs.length === 0 ? (
                <Card className="border-dashed">
                  <p className="p-8 text-center text-sm text-muted-foreground">No documents yet.</p>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Filename</th>
                        <th className="px-4 py-2 text-left font-medium">Version</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                        <th className="px-4 py-2 text-left font-medium">Chunks</th>
                        <th className="px-4 py-2 text-left font-medium">Active</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {docs.map((d) => {
                        const preset = STATUS_PRESET[d.status] || STATUS_PRESET.PENDING;
                        const Icon = preset.Icon;
                        return (
                          <tr key={d.id} className="transition-colors hover:bg-accent">
                            <td className="px-4 py-3 font-medium">{d.filename}</td>
                            <td className="px-4 py-3 text-muted-foreground">v{d.version}</td>
                            <td className="px-4 py-3">
                              <Badge variant={preset.variant}>
                                <Icon
                                  className={cn(
                                    "h-3 w-3",
                                    d.status === "PROCESSING" && "animate-spin",
                                  )}
                                />
                                {d.status}
                              </Badge>
                              {d.status === "FAILED" && d.errorMessage && (
                                <div
                                  className="mt-1 max-w-xs truncate text-xs text-destructive"
                                  title={d.errorMessage}
                                >
                                  {d.errorMessage}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{d._count?.chunks ?? 0}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {d.isActive ? "active" : "superseded"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-1">
                                {d.status === "FAILED" && (
                                  <Button size="xs" variant="outline" onClick={() => reprocess(d)}>
                                    Retry
                                  </Button>
                                )}
                                <Button size="xs" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeDoc(d)}>
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
            </>
          )}
        </section>
      </main>

      {editing && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
          <form onSubmit={saveGroup} className="w-full max-w-md animate-slide-up">
            <Card>
              <div className="p-6">
                <h2 className="text-lg font-semibold tracking-tight">
                  {editing.id ? "Edit group" : "New group"}
                </h2>

                <div className="mt-4 space-y-3">
                  <Field label="Name">
                    <Input
                      required
                      value={groupForm.name}
                      onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                      placeholder="Sales / Support / Pricing"
                    />
                  </Field>
                  <Field label="Description (optional)">
                    <Input
                      value={groupForm.description}
                      onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                    />
                  </Field>
                  <Field label="Confidence threshold (0–1)">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={groupForm.confidenceThreshold}
                      onChange={(e) => setGroupForm({ ...groupForm, confidenceThreshold: e.target.value })}
                    />
                  </Field>
                </div>

                {error && (
                  <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
                  <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
                </div>
              </div>
            </Card>
          </form>
        </div>
      )}
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
