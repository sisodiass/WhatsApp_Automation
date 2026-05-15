import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";

// Shared editor used for both "new" and "edit DRAFT". For non-DRAFT
// quotations the route falls back to read-only via QuotationDetail.

function emptyLine(position) {
  return {
    productId: null,
    description: "",
    qty: "1",
    unitPrice: "0.00",
    discountPct: "0",
    taxRatePct: "18",
    position,
  };
}

export default function QuotationEditor() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const isNew = !id || id === "new";

  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    contactId: search.get("contactId") || "",
    leadId: search.get("leadId") || "",
    currency: "INR",
    validUntil: "",
    terms: "",
    notes: "",
  });
  const [lines, setLines] = useState([emptyLine(0)]);

  useEffect(() => {
    Promise.all([
      api.get("/contacts", { params: { pageSize: 200 } }).catch(() => ({ data: { items: [] } })),
      api.get("/products", { params: { pageSize: 200, status: "ACTIVE" } }).catch(() => ({
        data: { items: [] },
      })),
    ]).then(([c, p]) => {
      setContacts(c.data.items || []);
      setProducts(p.data.items || []);
    });
  }, []);

  // Load existing DRAFT when editing.
  useEffect(() => {
    if (isNew) return;
    api
      .get(`/quotations/${id}`)
      .then(({ data }) => {
        if (data.status !== "DRAFT") {
          navigate(`/quotations/${id}`, { replace: true });
          return;
        }
        setForm({
          contactId: data.contactId,
          leadId: data.leadId || "",
          currency: data.currency,
          validUntil: data.validUntil ? data.validUntil.slice(0, 10) : "",
          terms: data.terms || "",
          notes: data.notes || "",
        });
        setLines(
          (data.lineItems || []).map((li, i) => ({
            productId: li.productId,
            description: li.description,
            qty: String(li.qty),
            unitPrice: String(li.unitPrice),
            discountPct: String(li.discountPct),
            taxRatePct: String(li.taxRatePct),
            position: i,
          })),
        );
      })
      .catch(() => {
        toast.error("Quote not found");
        navigate("/quotations");
      });
  }, [id, isNew, navigate]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    let total = 0;
    for (const l of lines) {
      const qty = Number(l.qty) || 0;
      const unit = Number(l.unitPrice) || 0;
      const dPct = Number(l.discountPct) || 0;
      const tPct = Number(l.taxRatePct) || 0;
      const gross = qty * unit;
      const afterDiscount = gross * (1 - dPct / 100);
      const lineTax = afterDiscount * (tPct / 100);
      subtotal += gross;
      discount += gross - afterDiscount;
      tax += lineTax;
      total += afterDiscount + lineTax;
    }
    return { subtotal, discount, tax, total };
  }, [lines]);

  function addLine() {
    setLines((s) => [...s, emptyLine(s.length)]);
  }
  function removeLine(i) {
    setLines((s) => s.filter((_, idx) => idx !== i).map((l, idx) => ({ ...l, position: idx })));
  }
  function patchLine(i, patch) {
    setLines((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function pickProduct(i, productId) {
    const p = products.find((p) => p.id === productId);
    if (!p) {
      patchLine(i, { productId: null });
      return;
    }
    patchLine(i, {
      productId: p.id,
      description: p.name,
      unitPrice: String(p.basePrice),
      taxRatePct: String(p.taxRatePct),
    });
  }

  async function save({ andSend = false } = {}) {
    if (!form.contactId) {
      toast.error("Pick a contact");
      return;
    }
    if (lines.length === 0) {
      toast.error("Add at least one line item");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        contactId: form.contactId,
        leadId: form.leadId || null,
        currency: form.currency,
        terms: form.terms,
        notes: form.notes,
        validUntil: form.validUntil
          ? new Date(form.validUntil + "T23:59:59Z").toISOString()
          : undefined,
        lineItems: lines.map((l) => ({
          productId: l.productId || null,
          description: l.description,
          qty: Number(l.qty),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct),
          taxRatePct: Number(l.taxRatePct),
        })),
      };
      let saved;
      if (isNew) {
        const { data } = await api.post("/quotations", payload);
        saved = data;
      } else {
        const { data } = await api.patch(`/quotations/${id}`, payload);
        saved = data;
      }
      if (andSend) {
        await api.post(`/quotations/${saved.id}/send`);
      }
      toast.success(andSend ? "Quotation sent" : "Saved");
      navigate(`/quotations/${saved.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader
        title={isNew ? "New quotation" : "Edit quotation"}
        actions={
          <Button variant="outline" onClick={() => navigate("/quotations")}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        }
      />

      <Card className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Contact</label>
            <Select
              value={form.contactId}
              onChange={(e) => setForm({ ...form, contactId: e.target.value })}
              disabled={!isNew}
            >
              <option value="">-- pick a contact --</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.mobile}
                  {c.company ? ` — ${c.company}` : ""}
                </option>
              ))}
            </Select>
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
            <label className="text-xs text-muted-foreground">Valid until</label>
            <Input
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
            />
          </div>
        </div>
      </Card>

      <Card className="p-0">
        <div className="border-b p-3 text-sm font-medium">Line items</div>
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-44 px-2 py-2 text-left">Product</th>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="w-20 px-2 py-2 text-right">Qty</th>
              <th className="w-28 px-2 py-2 text-right">Unit</th>
              <th className="w-20 px-2 py-2 text-right">Disc %</th>
              <th className="w-20 px-2 py-2 text-right">Tax %</th>
              <th className="w-28 px-2 py-2 text-right">Total</th>
              <th className="w-8 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const qty = Number(l.qty) || 0;
              const unit = Number(l.unitPrice) || 0;
              const dPct = Number(l.discountPct) || 0;
              const tPct = Number(l.taxRatePct) || 0;
              const gross = qty * unit;
              const afterDiscount = gross * (1 - dPct / 100);
              const total = afterDiscount * (1 + tPct / 100);
              return (
                <tr key={i} className="border-b">
                  <td className="px-2 py-1.5">
                    <Select
                      className="h-8"
                      value={l.productId || ""}
                      onChange={(e) => pickProduct(i, e.target.value)}
                    >
                      <option value="">— ad-hoc —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      className="h-8"
                      value={l.description}
                      onChange={(e) => patchLine(i, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      className="h-8 text-right tabular-nums"
                      type="number"
                      step="0.01"
                      value={l.qty}
                      onChange={(e) => patchLine(i, { qty: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      className="h-8 text-right tabular-nums"
                      type="number"
                      step="0.01"
                      value={l.unitPrice}
                      onChange={(e) => patchLine(i, { unitPrice: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      className="h-8 text-right tabular-nums"
                      type="number"
                      step="0.01"
                      value={l.discountPct}
                      onChange={(e) => patchLine(i, { discountPct: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      className="h-8 text-right tabular-nums"
                      type="number"
                      step="0.01"
                      value={l.taxRatePct}
                      onChange={(e) => patchLine(i, { taxRatePct: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {form.currency} {total.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Button variant="ghost" size="icon" onClick={() => removeLine(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t p-3">
          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </Button>
          <div className="space-y-0.5 text-right text-sm tabular-nums">
            <div>
              Subtotal:{" "}
              <span className="font-medium">
                {form.currency} {totals.subtotal.toFixed(2)}
              </span>
            </div>
            <div>
              Discount:{" "}
              <span className="font-medium text-warning">
                -{form.currency} {totals.discount.toFixed(2)}
              </span>
            </div>
            <div>
              Tax:{" "}
              <span className="font-medium">
                {form.currency} {totals.tax.toFixed(2)}
              </span>
            </div>
            <div className="border-t pt-1 text-base font-semibold">
              Total: {form.currency} {totals.total.toFixed(2)}
            </div>
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <label className="text-xs text-muted-foreground">Terms</label>
          <Textarea
            rows={3}
            value={form.terms}
            onChange={(e) => setForm({ ...form, terms: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Internal notes</label>
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate("/quotations")}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={() => save({ andSend: false })} disabled={busy}>
          Save draft
        </Button>
        <Button onClick={() => save({ andSend: true })} disabled={busy}>
          Save & send
        </Button>
      </div>
    </div>
  );
}
