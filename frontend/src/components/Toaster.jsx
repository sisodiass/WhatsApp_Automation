import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { dismissToast, useToasts } from "../stores/toastStore.js";
import { cn } from "../lib/cn.js";

// Fixed bottom-right viewport. Stacks up to ~5 toasts visually; older ones
// dismiss themselves via the timer in toastStore.

const VARIANT_STYLES = {
  success: {
    bg: "bg-success/10 border-success/30 text-foreground",
    iconCls: "text-success",
    Icon: CheckCircle2,
  },
  error: {
    bg: "bg-destructive/10 border-destructive/30 text-foreground",
    iconCls: "text-destructive",
    Icon: CircleAlert,
  },
  info: {
    bg: "bg-info/10 border-info/30 text-foreground",
    iconCls: "text-info",
    Icon: Info,
  },
};

export default function Toaster() {
  const items = useToasts();
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {items.map((t) => {
        const v = VARIANT_STYLES[t.variant] || VARIANT_STYLES.info;
        const Icon = v.Icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur",
              "animate-slide-up",
              v.bg,
            )}
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", v.iconCls)} />
            <div className="flex-1 text-sm">
              {t.title && <div className="font-semibold">{t.title}</div>}
              <div className={t.title ? "text-xs text-muted-foreground" : ""}>
                {t.message}
              </div>
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
