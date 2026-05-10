import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

const VARIANTS = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-ring",
  outline:
    "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring",
  ghost:
    "bg-transparent hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40",
  success:
    "bg-success text-success-foreground hover:bg-success/90 focus-visible:ring-success/40",
};

const SIZES = {
  xs: "h-6 px-2 text-xs gap-1",
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
  icon: "h-8 w-8",
};

export const Button = forwardRef(function Button(
  { className, variant = "primary", size = "md", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-md font-medium transition-colors duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});
