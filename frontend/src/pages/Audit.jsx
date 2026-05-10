import { useEffect, useState } from "react";
import { Activity, Filter, X } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { SkeletonTable } from "../components/ui/Skeleton.jsx";

export default function Audit() {
  const [items, setItems] = useState([]);
  const [keyFilter, setKeyFilter] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/settings/audit", {
        params: keyFilter ? { key: keyFilter } : {},
      });
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function format(v) {
    if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Activity}
        title="Settings Audit Log"
        subtitle={loading ? "Loading…" : `${items.length} entries`}
      />

      <form
        onSubmit={(e) => { e.preventDefault(); load(); }}
        className="flex items-center gap-2 border-b bg-background/80 px-6 py-3 backdrop-blur"
      >
        <Input
          value={keyFilter}
          onChange={(e) => setKeyFilter(e.target.value)}
          placeholder="filter by key (e.g. ai.provider)"
          className="w-72"
        />
        <Button type="submit" size="sm">
          <Filter className="h-3.5 w-3.5" />
          Apply
        </Button>
        {keyFilter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setKeyFilter(""); setTimeout(load, 0); }}
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </form>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <SkeletonTable rows={6} cols={5} />
        ) : items.length === 0 ? (
          <Card className="border-dashed">
            <p className="p-12 text-center text-sm text-muted-foreground">No audit entries.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">When</th>
                  <th className="px-4 py-2 text-left font-medium">Key</th>
                  <th className="px-4 py-2 text-left font-medium">Old</th>
                  <th className="px-4 py-2 text-left font-medium">New</th>
                  <th className="px-4 py-2 text-left font-medium">Who</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it) => (
                  <tr key={it.id} className="transition-colors hover:bg-accent">
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(it.changedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{it.key}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {format(it.oldValue)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{format(it.newValue)}</td>
                    <td className="px-4 py-2 text-xs">
                      {it.changedBy?.email || <span className="text-muted-foreground">system</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
