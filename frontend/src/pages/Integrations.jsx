import { useEffect, useState } from "react";
import { Copy, Globe, KeyRound, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";

const EMPTY = {
  name: "",
  allowedDomains: "",       // textarea, newline-separated
  rateLimitPerMinute: 60,
  widgetEnabled: true,
  isActive: true,
  widgetConfig: {
    primaryColor: "#2563eb",
    welcomeText: "Hi 👋 — how can we help?",
    position: "bottom-right",
    whatsappNumber: "",
  },
};

export default function Integrations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [fullKey, setFullKey] = useState(null); // shown after create / fetch

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/integrations");
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing({});
    setForm(EMPTY);
    setFullKey(null);
  }

  async function openEdit(row) {
    // Fetch the full integration (cleartext key) for the edit form.
    setEditing(row);
    setFullKey(null);
    try {
      const { data } = await api.get(`/integrations/${row.id}`);
      setFullKey(data.apiKey);
      setForm({
        name: data.name,
        allowedDomains: (data.allowedDomains || []).join("\n"),
        rateLimitPerMinute: data.rateLimitPerMinute,
        widgetEnabled: data.widgetEnabled,
        isActive: data.isActive,
        widgetConfig: {
          primaryColor: data.widgetConfig?.primaryColor || "#2563eb",
          welcomeText: data.widgetConfig?.welcomeText || "Hi 👋 — how can we help?",
          position: data.widgetConfig?.position || "bottom-right",
          whatsappNumber: data.widgetConfig?.whatsappNumber || "",
        },
      });
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to load");
    }
  }

  function close() { setEditing(null); }

  async function save(e) {
    e.preventDefault();
    try {
      const payload = {
        name: form.name.trim(),
        allowedDomains: form.allowedDomains.split(/\s+/).filter(Boolean),
        rateLimitPerMinute: Number(form.rateLimitPerMinute) || 60,
        widgetEnabled: !!form.widgetEnabled,
        isActive: !!form.isActive,
        widgetConfig: form.widgetConfig,
      };
      if (editing.id) {
        await api.patch(`/integrations/${editing.id}`, payload);
        toast.success("Saved");
      } else {
        const { data } = await api.post("/integrations", payload);
        // Show the freshly-minted key inline so the operator can copy it.
        setFullKey(data.apiKey);
        setEditing(data); // keep modal open in edit mode
        toast.success("API key generated — copy it now");
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Save failed");
    }
  }

  async function rotate(row) {
    const ok = await confirm({
      title: `Rotate API key for "${row.name}"?`,
      description: "The old key stops working immediately. Update every site / API consumer that uses it.",
      variant: "destructive",
      confirmLabel: "Rotate",
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/integrations/${row.id}/rotate-key`);
      setFullKey(data.apiKey);
      setEditing(data);
      toast.success("New key generated — copy it now");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Rotate failed");
    }
  }

  async function remove(row) {
    const ok = await confirm({
      title: `Delete "${row.name}"?`,
      description: "All sites using this key will immediately get 401s. This cannot be undone.",
      variant: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.delete(`/integrations/${row.id}`);
      toast.success("Deleted");
      if (editing?.id === row.id) close();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Delete failed");
    }
  }

  function copy(text) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn't copy — select manually"),
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={KeyRound}
        title="Website Integrations"
        subtitle="API keys + widget config for any website to talk to your CRM"
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> New integration
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <Skeleton className="h-32" />
        ) : items.length === 0 ? (
          <Card className="border-dashed">
            <p className="p-12 text-center text-sm text-muted-foreground">
              No integrations yet. Create one to get an API key your website can use.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">API key</th>
                  <th className="px-4 py-2 text-left font-medium">Allowed domains</th>
                  <th className="px-4 py-2 text-right font-medium">Rate / min</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((row) => (
                  <tr key={row.id} className="hover:bg-accent">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="mt-0.5 flex gap-1.5">
                        {!row.isActive && <Badge variant="muted">inactive</Badge>}
                        {!row.widgetEnabled && <Badge variant="muted">widget off</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {row.apiKey}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {(row.allowedDomains || []).length === 0 ? (
                        <span className="text-warning">* (any)</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {row.allowedDomains.slice(0, 3).join(", ")}
                          {row.allowedDomains.length > 3 ? ` +${row.allowedDomains.length - 3}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {row.rateLimitPerMinute}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="xs" variant="outline" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Button size="xs" variant="outline" onClick={() => rotate(row)}>
                          <RefreshCw className="h-3 w-3" /> Rotate
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => remove(row)}
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
      </div>

      {editing && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
          <form onSubmit={save} className="w-full max-w-2xl animate-slide-up">
            <Card>
              <div className="flex items-center justify-between border-b px-5 py-3">
                <h2 className="text-base font-semibold tracking-tight">
                  {editing.id ? `Edit "${editing.name}"` : "New integration"}
                </h2>
                <button type="button" onClick={close} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 p-5">
                <Field label="Name">
                  <Input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Acme Website"
                  />
                </Field>

                {fullKey && (
                  <div className="rounded-md border bg-success/5 p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      API key
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">
                        {fullKey}
                      </code>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => copy(fullKey)}
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </Button>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Paste this into your widget snippet or send it in <code className="rounded bg-background px-1">X-Api-Key</code>.
                    </p>
                  </div>
                )}

                <Field label="Allowed domains (one per line, e.g. www.acme.com)">
                  <textarea
                    rows={3}
                    className="block w-full rounded-md border bg-background px-3 py-2 font-mono text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder={"www.acme.com\nacme.com"}
                    value={form.allowedDomains}
                    onChange={(e) => setForm({ ...form, allowedDomains: e.target.value })}
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Empty = any origin (only acceptable for local testing).
                  </span>
                </Field>

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Rate limit / minute">
                    <Input
                      type="number"
                      value={form.rateLimitPerMinute}
                      onChange={(e) => setForm({ ...form, rateLimitPerMinute: e.target.value })}
                    />
                  </Field>
                  <Field label="Active">
                    <label className="inline-flex h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      />
                      <span>API key works</span>
                    </label>
                  </Field>
                  <Field label="Widget enabled">
                    <label className="inline-flex h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.widgetEnabled}
                        onChange={(e) => setForm({ ...form, widgetEnabled: e.target.checked })}
                      />
                      <span>Chat bubble shown</span>
                    </label>
                  </Field>
                </div>

                <div className="rounded-md border bg-muted/40 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Globe className="h-3 w-3" /> Widget appearance
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Primary color">
                      <Input
                        value={form.widgetConfig.primaryColor}
                        onChange={(e) => setForm({
                          ...form,
                          widgetConfig: { ...form.widgetConfig, primaryColor: e.target.value },
                        })}
                      />
                    </Field>
                    <Field label="Position">
                      <select
                        value={form.widgetConfig.position}
                        onChange={(e) => setForm({
                          ...form,
                          widgetConfig: { ...form.widgetConfig, position: e.target.value },
                        })}
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="bottom-right">Bottom right</option>
                        <option value="bottom-left">Bottom left</option>
                      </select>
                    </Field>
                    <div className="col-span-2">
                      <Field label="Welcome text">
                        <Input
                          value={form.widgetConfig.welcomeText}
                          onChange={(e) => setForm({
                            ...form,
                            widgetConfig: { ...form.widgetConfig, welcomeText: e.target.value },
                          })}
                        />
                      </Field>
                    </div>
                    <Field label="WhatsApp CTA number (optional)">
                      <Input
                        value={form.widgetConfig.whatsappNumber}
                        placeholder="919999999999"
                        onChange={(e) => setForm({
                          ...form,
                          widgetConfig: { ...form.widgetConfig, whatsappNumber: e.target.value },
                        })}
                      />
                    </Field>
                  </div>
                </div>

                {editing.id && (
                  <SnippetPanel apiKey={fullKey} integrationName={editing.name} />
                )}
              </div>
              <div className="flex justify-end gap-2 border-t px-5 py-3">
                <Button type="button" variant="ghost" onClick={close}>Close</Button>
                <Button type="submit">{editing.id ? "Save" : "Create"}</Button>
              </div>
            </Card>
          </form>
        </div>
      )}
    </div>
  );
}

function SnippetPanel({ apiKey, integrationName }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = apiKey
    ? `<script src="${origin}/widget.js" data-api-key="${apiKey}" async></script>`
    : `<script src="${origin}/widget.js" data-api-key="YOUR_KEY" async></script>`;
  return (
    <details className="rounded-md border bg-muted/40 p-3">
      <summary className="cursor-pointer text-xs font-medium">
        Embed snippet for {integrationName}
      </summary>
      <pre className="mt-2 overflow-x-auto rounded bg-background px-2 py-1 text-[11px]">
{snippet}
      </pre>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Drop this just before <code className="rounded bg-background px-1">{"</body>"}</code> on every page where the widget should appear.
      </p>
    </details>
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
