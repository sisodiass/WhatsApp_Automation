import { useEffect, useState } from "react";
import { CreditCard, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { useAuthStore } from "../stores/authStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { Select } from "../components/ui/Input.jsx";
import {
  PaymentLinkStatusPill,
  TxnStatusPill,
} from "../components/PaymentStatusPill.jsx";

const TABS = ["links", "transactions"];
const LINK_STATUSES = ["", "CREATED", "PENDING", "PAID", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"];

export default function Payments() {
  const [tab, setTab] = useState("links");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";

  async function load() {
    setLoading(true);
    try {
      if (tab === "links") {
        const { data } = await api.get("/payments/links", {
          params: { status: status || undefined, pageSize: 100 },
        });
        setItems(data.items || []);
      } else {
        const { data } = await api.get("/payments/transactions", {
          params: { pageSize: 100 },
        });
        setItems(data.items || []);
      }
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status]);

  async function cancel(id) {
    if (!(await confirm({ title: "Cancel link?", body: "Customer will no longer be able to pay." }))) return;
    try {
      await api.post(`/payments/links/${id}/cancel`);
      toast.success("Cancelled");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  async function refund(id) {
    if (!(await confirm({ title: "Refund payment?", body: "Full amount refund." }))) return;
    try {
      await api.post(`/payments/links/${id}/refund`, {});
      toast.success("Refund queued");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <PageHeader title="Payments" subtitle="Payment links + transactions" />

      <div className="flex items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${
              tab === t
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {t}
          </button>
        ))}
        {tab === "links" && (
          <Select className="ml-auto h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            {LINK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </Select>
        )}
      </div>

      <Card className="p-0">
        {loading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-muted-foreground">
            <CreditCard className="h-8 w-8" />
            <div className="text-sm">Nothing here yet.</div>
          </div>
        ) : tab === "links" ? (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Provider</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Link</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="px-3 py-2">{l.provider}</td>
                  <td className="px-3 py-2">
                    <PaymentLinkStatusPill status={l.status} />
                  </td>
                  <td className="px-3 py-2">
                    {[l.contact?.firstName, l.contact?.lastName].filter(Boolean).join(" ") ||
                      l.contact?.mobile}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.currency} {Number(l.amount).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-xs">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {l.shortUrl ? (
                      <a className="text-primary" href={l.shortUrl} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {l.status === "PAID" && isAdmin && (
                      <Button size="xs" variant="outline" onClick={() => refund(l.id)}>
                        <RefreshCw className="h-3 w-3" /> Refund
                      </Button>
                    )}
                    {(l.status === "CREATED" || l.status === "PENDING") && (
                      <Button size="xs" variant="ghost" onClick={() => cancel(l.id)}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Provider</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Payment ID</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Method</th>
                <th className="px-3 py-2">Captured</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="px-3 py-2">{t.provider}</td>
                  <td className="px-3 py-2">
                    <TxnStatusPill status={t.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{t.providerPaymentId}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.currency} {Number(t.amount).toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{t.method || "-"}</td>
                  <td className="px-3 py-2 text-xs">
                    {t.capturedAt ? new Date(t.capturedAt).toLocaleString() : "-"}
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
