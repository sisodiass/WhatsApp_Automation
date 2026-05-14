import { useRef } from "react";
import { Calendar } from "lucide-react";
import { cn } from "../../lib/cn.js";

// Replacement for <input type="datetime-local"> that fixes the two
// recurring UX problems with the native control on Windows Chrome:
//
//   1. The clickable area for the popup is only the tiny calendar icon
//      on the far right — easy to miss. Here, clicking anywhere on the
//      input opens it (via the showPicker() API, supported in all
//      evergreen browsers).
//   2. The dark theme's color-scheme defaults to "light", which makes
//      the native popup hard to read on a dark page. We set color-scheme
//      explicitly so the popup matches our theme.
//
// The underlying input is still type="datetime-local" so value-binding
// works exactly like the native control (ISO-without-Z strings like
// "2026-05-14T13:30"). Callers receive the same `e.target.value`.

export function DateTimeInput({
  value,
  onChange,
  className,
  type = "datetime-local",
  ...rest
}) {
  const ref = useRef(null);

  function openPicker() {
    const el = ref.current;
    if (!el) return;
    // showPicker() throws if called from a non-trusted event in some
    // older versions of Chrome; fall back to focus() in that case so
    // the keyboard works at least.
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch {
      el.focus();
    }
  }

  return (
    <div
      onClick={openPicker}
      className={cn(
        "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border bg-background px-2 shadow-sm focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
      style={{ colorScheme: "dark light" }}
    >
      <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        type={type}
        value={value || ""}
        onChange={onChange}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        // The native control sometimes ignores click events that bubble
        // up through a wrapping label/div. Re-triggering showPicker from
        // its own click is harmless and makes the small icon work too.
        onClick={(e) => { e.stopPropagation(); openPicker(); }}
        {...rest}
      />
    </div>
  );
}
