import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileText, Plus, Search } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { QuotationStatusPill } from "../components/PaymentStatusPill.jsx";

const STATUSES = ["", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "REVISED"];

export default function Quotations() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/quotations", {
        params: { search: search || undefined, status: status || undefined, pageSize: 100 },
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <PageHeader
        title="Quotations"
        subtitle={`${total} total`}
        actions={
          <Button onClick={() => navigate("/quotations/new")}>
            <Plus className="h-3.5 w-3.5" /> New quotation
          </Button>
        }
      />

      <Card>
        <div className="flex items-center gap-2 border-b p-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by quote number, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 focus:ring-0"
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-8 w-40"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </Select>
        </div>

        {loading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-muted-foreground">
            <FileText className="h-8 w-8" />
            <div className="text-sm">No quotations yet.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Valid until</th>
                <th className="px-3 py-2">Lines</th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr
                  key={q.id}
                  className="cursor-pointer border-b hover:bg-accent/30"
                  onClick={() => navigate(`/quotations/${q.id}`)}
                >
                  <td className="px-3 py-2 font-mono text-xs">{q.number}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {[q.contact?.firstName, q.contact?.lastName].filter(Boolean).join(" ") ||
                        q.contact?.mobile}
                    </div>
                    {q.contact?.company && (
                      <div className="text-xs text-muted-foreground">{q.contact.company}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <QuotationStatusPill status={q.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {q.currency} {Number(q.grandTotal).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(q.validUntil).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {q._count?.lineItems ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
