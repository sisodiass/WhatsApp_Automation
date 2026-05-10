import { cn } from "../../lib/cn.js";

const VARIANTS = {
  default: "bg-secondary text-secondary-foreground",
  outline: "border border-border text-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
  muted: "bg-muted text-muted-foreground",
};

export function Badge({ variant = "default", className, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Dot({ variant = "default", className }) {
  const dotColors = {
    default: "bg-foreground",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    info: "bg-info",
    muted: "bg-muted-foreground",
  };
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotColors[variant], className)} />;
}
