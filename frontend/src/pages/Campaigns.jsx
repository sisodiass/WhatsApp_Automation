import { useEffect, useState } from "react";
import {
  Copy,
  ExternalLink,
  Megaphone,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Textarea } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { SkeletonTable } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

const empty = {
  name: "",
  tag: "",
  isActive: true,
  expiresAt: "",
  onboardingMessage: "",
  entryMessage: "",
  formLink: "",
  businessType: "",
  kbGroupIds: [],
};

function buildWaMeUrl(waNumber, tag, entryMessage) {
  if (!waNumber || !tag) return null;
  const text = entryMessage ? `${tag} ${entryMessage}` : tag;
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`;
}

export default function Campaigns() {
  const [items, setItems] = useState([]);
  const [kbGroups, setKbGroups] = useState([]);
  const [waNumber, setWaNumber] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [c, k, wa] = await Promise.all([
        api.get("/campaigns"),
        api.get("/kb/groups"),
        api.get("/whatsapp/status").catch(() => ({ data: {} })),
      ]);
      setItems(c.data.items || []);
      setKbGroups(k.data.items || []);
      setWaNumber(wa.data?.me || null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() { setEditing({}); setForm(empty); setError(null); }
  function openEdit(c) {
    setEditing(c);
    setForm({
      name: c.name,
      tag: c.tag,
      isActive: c.isActive,
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 16) : "",
      onboardingMessage: c.onboardingMessage,
      entryMessage: c.entryMessage || "",
      formLink: c.formLink || "",
      businessType: c.businessType || "",
      kbGroupIds: (c.kbGroups || []).map((kg) => kg.kbGroup?.id || kg.kbGroupId).filter(Boolean),
    });
    setError(null);
  }
  function close() { setEditing(null); setForm(empty); setError(null); }

  async function save(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        tag: form.tag.trim().toUpperCase(),
        isActive: form.isActive,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        onboardingMessage: form.onboardingMessage,
        entryMessage: form.entryMessage?.trim() || null,
        formLink: form.formLink || null,
        businessType: form.businessType || null,
        kbGroupIds: form.kbGroupIds || [],
      };
      if (editing && editing.id) await api.patch(`/campaigns/${editing.id}`, payload);
      else await api.post("/campaigns", payload);
      await load();
      close();
    } catch (err) {
      setError(err.response?.data?.error?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c) {
    const ok = await confirm({
      title: `Delete campaign "${c.name}"?`,
      description: `Tag ${c.tag}. Existing chats and sessions remain, but no new ones can start. This cannot be undone.`,
      variant: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/campaigns/${c.id}`);
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Megaphone}
        title="Campaigns"
        subtitle={loading ? "Loading…" : `${items.length} campaign${items.length !== 1 ? "s" : ""}`}
        actions={
          <Button onClick={openNew} size="sm">
            <Plus className="h-3.5 w-3.5" />
            New campaign
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <SkeletonTable rows={4} cols={6} />
        ) : items.length === 0 ? (
          <Card className="border-dashed">
            <div className="p-12 text-center text-sm text-muted-foreground">
              <p>No campaigns yet.</p>
              <p className="mt-1 text-xs">
                Customers reach you via{" "}
                <code className="rounded bg-muted px-1 font-mono">wa.me/&lt;number&gt;?text=&lt;TAG&gt;</code>.
              </p>
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">Tag</th>
                  <th className="px-4 py-2 text-left font-medium">wa.me link</th>
                  <th className="px-4 py-2 text-left font-medium">Active</th>
                  <th className="px-4 py-2 text-left font-medium">Sessions</th>
                  <th className="px-4 py-2 text-left font-medium">Expires</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((c) => (
                  <tr key={c.id} className={cn("transition-colors hover:bg-accent", c.isSystem && "bg-muted/30")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        {c.isSystem && <Badge variant="muted">system</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{c.tag}</td>
                    <td className="px-4 py-3">
                      <WaMeCell url={buildWaMeUrl(waNumber, c.tag, c.entryMessage)} waNumber={waNumber} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={c.isActive ? "success" : "muted"}>
                        {c.isActive ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c._count?.chatSessions ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="xs" variant="outline" onClick={() => openEdit(c)}>Edit</Button>
                        {c.isSystem ? (
                          <Button size="xs" variant="ghost" disabled>—</Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => remove(c)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
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
            <form onSubmit={save} className="w-full max-w-lg animate-slide-up">
              <Card>
                <div className="max-h-[85vh] overflow-y-auto p-6">
                  <h2 className="text-lg font-semibold tracking-tight">
                    {editing.id ? "Edit campaign" : "New campaign"}
                  </h2>

                  <div className="mt-4 grid gap-3">
                    {editing.isSystem && (
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">System test campaign.</span>{" "}
                        Tag and name are locked. You can edit onboarding, KB groups, expiry, and active state.
                      </div>
                    )}

                    <Field label="Name">
                      <Input
                        required
                        value={form.name}
                        disabled={editing.isSystem}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </Field>

                    <Field label="Tag (used in wa.me link)">
                      <Input
                        required
                        value={form.tag}
                        disabled={editing.isSystem}
                        onChange={(e) => setForm({ ...form, tag: e.target.value.toUpperCase() })}
                        placeholder="CAMPAIGN_X92P"
                        className="font-mono"
                      />
                    </Field>

                    <Field label="Onboarding message (sent after customer triggers the campaign)">
                      <Textarea
                        required
                        rows={3}
                        value={form.onboardingMessage}
                        onChange={(e) => setForm({ ...form, onboardingMessage: e.target.value })}
                      />
                    </Field>

                    <Field label="wa.me prefill text (shown to the customer in WhatsApp)">
                      <Input
                        value={form.entryMessage}
                        onChange={(e) => setForm({ ...form, entryMessage: e.target.value })}
                        placeholder="Hi, I want to know about your services"
                        maxLength={500}
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Customer will see{" "}
                        <code className="rounded bg-muted px-1 font-mono">
                          {form.tag || "TAG"}{form.entryMessage ? ` ${form.entryMessage}` : ""}
                        </code>{" "}
                        prefilled.
                      </span>
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Form link (optional)">
                        <Input
                          type="url"
                          value={form.formLink}
                          onChange={(e) => setForm({ ...form, formLink: e.target.value })}
                        />
                      </Field>
                      <Field label="Business type (optional)">
                        <Input
                          value={form.businessType}
                          onChange={(e) => setForm({ ...form, businessType: e.target.value })}
                        />
                      </Field>
                    </div>

                    <Field label="KB groups (used for AI retrieval)">
                      {kbGroups.length === 0 ? (
                        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                          No KB groups yet. Create one in the Knowledge Base page first.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {kbGroups.map((g) => {
                            const checked = form.kbGroupIds.includes(g.id);
                            return (
                              <label
                                key={g.id}
                                className={cn(
                                  "cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors",
                                  checked
                                    ? "border-foreground bg-foreground/10 text-foreground"
                                    : "border-border text-muted-foreground hover:bg-accent",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(form.kbGroupIds);
                                    if (e.target.checked) next.add(g.id);
                                    else next.delete(g.id);
                                    setForm({ ...form, kbGroupIds: [...next] });
                                  }}
                                />
                                {g.name}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Expires (optional)">
                        <Input
                          type="datetime-local"
                          value={form.expiresAt}
                          onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                        />
                      </Field>
                      <Field label="Active">
                        <label className="mt-2 inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.isActive}
                            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                          />
                          <span>{form.isActive ? "active" : "inactive"}</span>
                        </label>
                      </Field>
                    </div>
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

function WaMeCell({ url, waNumber }) {
  const [copied, setCopied] = useState(false);

  if (!waNumber) return <span className="text-xs italic text-muted-foreground">WhatsApp not connected</span>;
  if (!url) return <span className="text-xs text-muted-foreground">—</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {/* ignore */}
  }

  return (
    <div className="flex items-center gap-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={url}
        className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
        Open
      </a>
      <button
        onClick={copy}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
          copied
            ? "border-success/30 bg-success/10 text-success"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Copy className="h-3 w-3" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
