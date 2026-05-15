import { useEffect, useState } from "react";
import { Plus, Trash2, Tag } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";

const KINDS = ["VOLUME_TIER", "SEGMENT", "TIME_BOUND"];

const KIND_HINTS = {
  VOLUME_TIER: `{"minQty": 5, "maxQty": 50, "discountPct": 10}`,
  SEGMENT: `{"tagId": "tag_...", "discountPct": 15}`,
  TIME_BOUND: `{"startsAt": "2026-05-01T00:00:00Z", "endsAt": "2026-05-31T23:59:59Z", "discountPct": 20}`,
};

const emptyForm = () => ({
  name: "",
  kind: "VOLUME_TIER",
  productId: "",
  config: KIND_HINTS.VOLUME_TIER,
  priority: 100,
  active: true,
});

export default function PricingRules() {
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([
        api.get("/pricing-rules"),
        api.get("/products", { params: { pageSize: 200, status: "ACTIVE" } }),
      ]);
      setItems(r.data.items || []);
      setProducts(p.data.items || []);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing("new");
    setForm(emptyForm());
  }

  function openEdit(r) {
    setEditing(r.id);
    setForm({
      name: r.name,
      kind: r.kind,
      productId: r.productId || "",
      config: JSON.stringify(r.config, null, 2),
      priority: r.priority,
      active: r.active,
    });
  }

  async function save() {
    setBusy(true);
    try {
      let config;
      try {
        config = JSON.parse(form.config);
      } catch {
        toast.error("Config must be valid JSON");
        setBusy(false);
        return;
      }
      const payload = {
        name: form.name,
        kind: form.kind,
        productId: form.productId || null,
        config,
        priority: Number(form.priority),
        active: form.active,
      };
      if (editing === "new") {
        await api.post("/pricing-rules", payload);
      } else {
        await api.patch(`/pricing-rules/${editing}`, payload);
      }
      toast.success("Saved");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r) {
    if (!(await confirm({ title: "Delete rule?", body: r.name }))) return;
    try {
      await api.delete(`/pricing-rules/${r.id}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader
        title="Pricing rules"
        subtitle="Volume tiers, segment discounts, time-bound promotions"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> New rule
          </Button>
        }
      />

      <Card className="p-0">
        {loading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-muted-foreground">
            <Tag className="h-8 w-8" />
            <div className="text-sm">No pricing rules.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Scope</th>
                <th className="px-3 py-2 text-right">Priority</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b hover:bg-accent/30"
                  onClick={() => openEdit(r)}
                >
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-xs">{r.kind}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.productId
                      ? products.find((p) => p.id === r.productId)?.name || "—"
                      : "All products"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.priority}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.active ? "success" : "muted"}>
                      {r.active ? "ON" : "OFF"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(r);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setEditing(null)}
        >
          <Card
            className="w-full max-w-xl space-y-3 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold">
              {editing === "new" ? "New pricing rule" : "Edit rule"}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Kind</label>
                <Select
                  value={form.kind}
                  onChange={(e) => {
                    const kind = e.target.value;
                    setForm({ ...form, kind, config: KIND_HINTS[kind] });
                  }}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Priority</label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Product (optional)</label>
                <Select
                  value={form.productId}
                  onChange={(e) => setForm({ ...form, productId: e.target.value })}
                >
                  <option value="">— All products —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Config JSON</label>
                <Textarea
                  rows={5}
                  className="font-mono text-xs"
                  value={form.config}
                  onChange={(e) => setForm({ ...form, config: e.target.value })}
                />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
