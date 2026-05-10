import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useConfirmActive, useConfirmResolve } from "../stores/confirmStore.js";
import { Button } from "./ui/Button.jsx";
import { Card } from "./ui/Card.jsx";
import { cn } from "../lib/cn.js";

// Single global modal driven by confirmStore. Mounted once in AppShell.

export default function ConfirmDialog() {
  const active = useConfirmActive();
  const resolve = useConfirmResolve();

  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === "Escape") resolve(false);
      if (e.key === "Enter") resolve(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, resolve]);

  if (!active) return null;

  const isDestructive = active.variant === "destructive";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/30 p-4 animate-fade-in"
      onClick={() => resolve(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <Card>
          <div className="p-5">
            <div className="flex items-start gap-3">
              {isDestructive && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold tracking-tight">{active.title}</h2>
                {active.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{active.description}</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => resolve(false)}>
                {active.cancelLabel}
              </Button>
              <Button
                size="sm"
                variant={isDestructive ? "destructive" : "primary"}
                onClick={() => resolve(true)}
                autoFocus
              >
                {active.confirmLabel}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
