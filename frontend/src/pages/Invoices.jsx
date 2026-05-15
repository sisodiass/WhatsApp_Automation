import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";

export default function Invoices() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/invoices", { params: { pageSize: 100 } });
      setItems(data.items || []);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader title="Invoices" subtitle="Generated after a payment is captured" />
      <Card className="p-0">
        {loading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-muted-foreground">
            <Receipt className="h-8 w-8" />
            <div className="text-sm">No invoices yet.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Number</th>
                <th className="px-3 py-2 text-left">Quotation</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b">
                  <td className="px-3 py-2 font-mono text-xs">{i.number}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {i.quotation?.number || "-"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {i.currency} {Number(i.amount).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-xs">{new Date(i.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
