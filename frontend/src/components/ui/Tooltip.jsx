import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";

// Lightweight CSS-only-ish tooltip. Trigger is whatever child you wrap;
// tooltip appears on hover/focus, positioned by Tailwind.
//
// Usage:
//   <Tooltip content="Help text">
//     <button>Trigger</button>
//   </Tooltip>

export function Tooltip({ content, children, side = "top", className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on Esc + outside-click for accessibility.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onClickOut = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClickOut);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClickOut);
    };
  }, [open]);

  if (!content) return children;

  const sideStyles = {
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
    left: "right-full top-1/2 mr-2 -translate-y-1/2",
    right: "left-full top-1/2 ml-2 -translate-y-1/2",
  };

  return (
    <span
      ref={ref}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 max-w-xs whitespace-normal rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md",
            "animate-fade-in",
            sideStyles[side],
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
