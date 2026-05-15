import { useEffect, useState } from "react";
import { Package, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { useAuthStore } from "../stores/authStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";

const emptyForm = () => ({
  sku: "",
  name: "",
  description: "",
  basePrice: "0.00",
  currency: "INR",
  taxRatePct: "18",
  status: "ACTIVE",
});

export default function Products() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === "SUPER_ADMIN" || role === "ADMIN";

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/products", {
        params: { search: search || undefined, pageSize: 200 },
      });
      setItems(data.items || []);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function openCreate() {
    setEditing("new");
    setForm(emptyForm());
  }

  function openEdit(p) {
    setEditing(p.id);
    setForm({
      sku: p.sku,
      name: p.name,
      description: p.description || "",
      basePrice: String(p.basePrice),
      currency: p.currency,
      taxRatePct: String(p.taxRatePct),
      status: p.status,
    });
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        basePrice: Number(form.basePrice),
        taxRatePct: Number(form.taxRatePct),
      };
      if (editing === "new") {
        await api.post("/products", payload);
        toast.success("Product created");
      } else {
        await api.patch(`/products/${editing}`, payload);
        toast.success("Product updated");
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p) {
    if (!(await confirm({ title: "Archive product?", body: `${p.name} will be soft-deleted.` }))) return;
    try {
      await api.delete(`/products/${p.id}`);
      toast.success("Archived");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <PageHeader
        title="Products"
        subtitle="Catalog used to build quotations."
        actions={
          canEdit && (
            <Button onClick={openCreate} size="md">
              <Plus className="h-3.5 w-3.5" /> New product
            </Button>
          )
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b p-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, SKU, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 focus:ring-0"
          />
        </div>
        {loading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-muted-foreground">
            <Package className="h-8 w-8" />
            <div className="text-sm">No products yet.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Tax %</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b hover:bg-accent/30"
                  onClick={() => canEdit && openEdit(p)}
                >
                  <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-muted-foreground">{p.description}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.currency} {Number(p.basePrice).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(p.taxRatePct).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={p.status === "ACTIVE" ? "success" : "muted"}>
                      {p.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(p);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
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
            className="w-full max-w-lg space-y-3 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold">
              {editing === "new" ? "New product" : "Edit product"}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">SKU</label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <Select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="ARCHIVED">Archived</option>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Description</label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Base price</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.basePrice}
                  onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Currency</label>
                <Input
                  value={form.currency}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Tax %</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.taxRatePct}
                  onChange={(e) => setForm({ ...form, taxRatePct: e.target.value })}
                />
              </div>
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
