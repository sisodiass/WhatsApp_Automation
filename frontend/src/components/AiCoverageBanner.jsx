import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { confirm } from "../stores/confirmStore.js";
import { Button } from "./ui/Button.jsx";

// Surfaces a warning when KB chunks aren't fully embedded under the
// currently-active AI provider+model — usually after a provider switch
// or an embedding-model upgrade.

export default function AiCoverageBanner() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get("/ai/status");
      setState(data);
    } catch {
      setState(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function reembedAll() {
    const ok = await confirm({
      title: "Re-embed all documents?",
      description:
        "Every active KB document will be re-processed for the current AI provider. This may take several minutes.",
      confirmLabel: "Re-embed",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.post("/kb/reembed");
      toast.success(`Enqueued ${data.enqueued} document(s) for re-embedding`);
      await load();
    } catch (err) {
      toast.fromError(err, "Re-embed failed");
    } finally {
      setBusy(false);
    }
  }

  if (!state || !state.coverage) return null;
  const { coverage, active } = state;
  if (!coverage.needs_reembed) return null;

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 animate-fade-in">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          KB embeddings are out of sync with the active AI provider
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Active provider: <code className="rounded bg-muted px-1 font-mono">{active}</code>
          {" · "}
          {coverage.docs_stale} of {coverage.docs_total} documents need re-embedding
          {" · "}
          {coverage.stale_chunks} chunks ignored by retrieval until reprocessed.
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link to="/kb">
          <Button variant="outline" size="sm">Open KB</Button>
        </Link>
        <Button onClick={reembedAll} disabled={busy} size="sm">
          {busy ? "Enqueuing…" : "Re-embed all"}
        </Button>
      </div>
    </div>
  );
}
