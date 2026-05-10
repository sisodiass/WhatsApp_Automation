import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { Tooltip } from "./ui/Tooltip.jsx";
import { cn } from "../lib/cn.js";

// Header pill that toggles `ai.global_enabled`. Compact, dark-mode aware.

export default function GlobalAiSwitch() {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get("/settings/lookup", {
        params: { keys: "ai.global_enabled" },
      });
      setEnabled(data["ai.global_enabled"] !== false);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !enabled;
    setEnabled(next);
    try {
      await api.put("/settings/ai.global_enabled", { value: next });
      toast.success(next ? "AI enabled globally" : "AI disabled globally");
    } catch (err) {
      setEnabled(!next);
      toast.fromError(err, "Toggle failed");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <Tooltip
      side="bottom"
      content={
        enabled
          ? "AI is processing customer messages. Click to disable."
          : "All inbound messages are escalated to MANUAL. Click to re-enable."
      }
    >
      <button
        onClick={toggle}
        disabled={busy}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
          enabled
            ? "border-success/30 bg-success/10 text-success hover:bg-success/15"
            : "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15",
        )}
      >
        <Power className="h-3.5 w-3.5" />
        AI {enabled ? "ON" : "OFF"}
      </button>
    </Tooltip>
  );
}
