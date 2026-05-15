import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, Send, X, RefreshCw, Check } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import {
  PaymentLinkStatusPill,
  QuotationStatusPill,
} from "../components/PaymentStatusPill.jsx";

export default function QuotationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get(`/quotations/${id}`);
      setQ(data);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed to load");
      navigate("/quotations");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send() {
    if (!(await confirm({ title: "Send quotation?", body: "Customer will receive the PDF + chat message." })))
      return;
    setBusy(true);
    try {
      await api.post(`/quotations/${id}/send`);
      toast.success("Sent");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setBusy(true);
    try {
      await api.post(`/quotations/${id}/accept`);
      toast.success("Marked accepted");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await api.post(`/quotations/${id}/reject`);
      toast.success("Marked rejected");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function revise() {
    setBusy(true);
    try {
      const { data } = await api.post(`/quotations/${id}/revise`);
      toast.success("New revision created");
      navigate(`/quotations/${data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createPaymentLink() {
    setBusy(true);
    try {
      const { data } = await api.post("/payments/links", {
        quotationId: q.id,
        amount: Number(q.grandTotal),
        currency: q.currency,
        description: `Quotation ${q.number}`,
      });
      toast.success(`Link created: ${data.shortUrl || data.id}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!q) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-6">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const canEdit = q.status === "DRAFT";
  const canSend = q.status === "DRAFT";
  const canDecide = q.status === "SENT";
  const canRevise = q.status === "SENT" || q.status === "ACCEPTED";

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader
        title={`Quotation ${q.number}`}
        subtitle={
          <span className="flex items-center gap-2">
            <QuotationStatusPill status={q.status} />
            <span>v{q.version}</span>
            {q.draftedByAi && <span className="text-info">drafted by AI</span>}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/quotations")}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            {canEdit && (
              <Button variant="outline" onClick={() => navigate(`/quotations/${id}/edit`)}>
                Edit
              </Button>
            )}
          </>
        }
      />

      <Card className="grid grid-cols-3 gap-4 p-4">
        <div>
          <div className="text-xs text-muted-foreground">Customer</div>
          <div className="mt-1 text-sm font-medium">
            {[q.contact?.firstName, q.contact?.lastName].filter(Boolean).join(" ") ||
              q.contact?.mobile}
          </div>
          {q.contact?.company && (
            <div className="text-xs text-muted-foreground">{q.contact.company}</div>
          )}
          {q.contact?.email && <div className="text-xs">{q.contact.email}</div>}
          <div className="text-xs">{q.contact?.mobile}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Lead</div>
          {q.lead ? (
            <Link className="mt-1 block text-sm text-primary" to={`/leads/${q.lead.id}`}>
              View lead → {q.lead.stage?.name}
            </Link>
          ) : (
            <div className="text-sm text-muted-foreground">No lead linked</div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Valid until</div>
          <div className="text-sm">{new Date(q.validUntil).toISOString().slice(0, 10)}</div>
          <div className="mt-2 text-xs text-muted-foreground">Created</div>
          <div className="text-sm">{new Date(q.createdAt).toLocaleString()}</div>
        </div>
      </Card>

      <Card className="p-0">
        <div className="border-b p-3 text-sm font-medium">Line items</div>
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="w-16 px-3 py-2 text-right">Qty</th>
              <th className="w-24 px-3 py-2 text-right">Unit</th>
              <th className="w-20 px-3 py-2 text-right">Disc %</th>
              <th className="w-20 px-3 py-2 text-right">Tax %</th>
              <th className="w-28 px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.lineItems.map((li, i) => (
              <tr key={li.id} className="border-b">
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2">{li.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(li.qty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {q.currency} {Number(li.unitPrice).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(li.discountPct).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(li.taxRatePct).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {q.currency} {Number(li.lineTotal).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-b">
              <td colSpan={6} className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                Subtotal
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {q.currency} {Number(q.subtotal).toFixed(2)}
              </td>
            </tr>
            <tr className="border-b">
              <td colSpan={6} className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                Discount
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-warning">
                -{q.currency} {Number(q.discountTotal).toFixed(2)}
              </td>
            </tr>
            <tr className="border-b">
              <td colSpan={6} className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                Tax
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {q.currency} {Number(q.taxTotal).toFixed(2)}
              </td>
            </tr>
            <tr>
              <td colSpan={6} className="px-3 py-2 text-right text-sm font-semibold">
                Grand total
              </td>
              <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
                {q.currency} {Number(q.grandTotal).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {(q.terms || q.notes) && (
        <Card className="space-y-3 p-4 text-sm">
          {q.terms && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Terms</div>
              <div className="whitespace-pre-wrap">{q.terms}</div>
            </div>
          )}
          {q.notes && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
              <div className="whitespace-pre-wrap">{q.notes}</div>
            </div>
          )}
        </Card>
      )}

      {q.paymentLinks?.length > 0 && (
        <Card className="p-0">
          <div className="border-b p-3 text-sm font-medium">Payment links</div>
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Provider</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Link</th>
              </tr>
            </thead>
            <tbody>
              {q.paymentLinks.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="px-3 py-2">{l.provider}</td>
                  <td className="px-3 py-2">
                    <PaymentLinkStatusPill status={l.status} />
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
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-card p-3">
        <a className="text-sm text-primary" href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer">
          <Download className="mr-1 inline h-3.5 w-3.5" /> Download PDF
        </a>
        {canSend && (
          <Button onClick={send} disabled={busy}>
            <Send className="h-3.5 w-3.5" /> Send to customer
          </Button>
        )}
        {canDecide && (
          <>
            <Button variant="success" onClick={accept} disabled={busy}>
              <Check className="h-3.5 w-3.5" /> Mark accepted
            </Button>
            <Button variant="destructive" onClick={reject} disabled={busy}>
              <X className="h-3.5 w-3.5" /> Mark rejected
            </Button>
          </>
        )}
        {(q.status === "SENT" || q.status === "ACCEPTED") && (
          <Button variant="outline" onClick={createPaymentLink} disabled={busy}>
            Generate payment link
          </Button>
        )}
        {canRevise && (
          <Button variant="outline" onClick={revise} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" /> Revise
          </Button>
        )}
      </div>
    </div>
  );
}
