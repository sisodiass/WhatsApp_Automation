import { useEffect, useState } from "react";
import { Pencil, Tags, X } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";

// Sources master. Source values are free-form strings on both Contact
// and Lead — they get populated by every inbound path (webchat / api /
// whatsapp / instagram / etc.). This page surfaces every distinct value
// the tenant has accumulated, with counts + conversion, plus a rename
// action so two near-duplicates ("webchat" + "Web Chat") can be merged.

export default function Sources() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(null); // { from, to }
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/contacts/sources");
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openRename(row) {
    setRenaming({ from: row.source, to: row.source });
  }

  async function saveRename(e) {
    e.preventDefault();
    if (!renaming?.from || !renaming?.to?.trim()) return;
    if (renaming.from === renaming.to.trim()) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/contacts/sources/rename", {
        from: renaming.from,
        to: renaming.to.trim(),
      });
      toast.success(`Renamed: ${data.contacts} contacts + ${data.leads} leads updated`);
      setRenaming(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  const grandTotalContacts = items.reduce((sum, r) => sum + r.contactCount, 0);
  const grandTotalLeads = items.reduce((sum, r) => sum + r.leadCount, 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Tags}
        title="Sources"
        subtitle={
          loading
            ? "Loading…"
            : `${items.length} distinct source${items.length !== 1 ? "s" : ""} · ${grandTotalContacts} contacts · ${grandTotalLeads} leads`
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <Skeleton className="h-32" />
        ) : items.length === 0 ? (
          <Card className="border-dashed">
            <p className="p-12 text-center text-sm text-muted-foreground">
              No sources yet. They'll show up here as contacts arrive via the
              widget, public API, WhatsApp, or manual creation.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Source</th>
                  <th className="px-4 py-2 text-right font-medium">Contacts</th>
                  <th className="px-4 py-2 text-right font-medium">Leads</th>
                  <th className="px-4 py-2 text-right font-medium">Won</th>
                  <th className="px-4 py-2 text-right font-medium">Conversion</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((row) => (
                  <tr key={row.source} className="hover:bg-accent">
                    <td className="px-4 py-3 font-mono text-xs">{row.source}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {row.contactCount}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {row.leadCount}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {row.wonCount}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      {row.leadCount > 0 ? (
                        <span className="font-mono">{Math.round(row.conversion * 100)}%</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="xs" variant="outline" onClick={() => openRename(row)}>
                        <Pencil className="h-3 w-3" /> Rename
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <p className="mt-3 px-1 text-[11px] text-muted-foreground">
          Tip: rename two near-duplicates to the same value (e.g. <code className="rounded bg-muted px-1">Web Chat</code> → <code className="rounded bg-muted px-1">webchat</code>) and they'll merge in analytics. The rename updates every contact + lead with that source in a single transaction.
        </p>
      </div>

      {renaming && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
          <form onSubmit={saveRename} className="w-full max-w-md animate-slide-up">
            <Card>
              <div className="flex items-center justify-between border-b px-5 py-3">
                <h2 className="text-base font-semibold tracking-tight">Rename source</h2>
                <button type="button" onClick={() => setRenaming(null)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 p-5">
                <Field label="From">
                  <Input value={renaming.from} disabled className="font-mono" />
                </Field>
                <Field label="To">
                  <Input
                    required
                    autoFocus
                    value={renaming.to}
                    onChange={(e) => setRenaming({ ...renaming, to: e.target.value })}
                    className="font-mono"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    If "To" already exists as a source, the two will be merged.
                  </span>
                </Field>
              </div>
              <div className="flex justify-end gap-2 border-t px-5 py-3">
                <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                <Button type="submit" disabled={busy || !renaming.to.trim()}>
                  Rename
                </Button>
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
