import { cn } from "../../lib/cn.js";

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn("border-b px-4 py-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return (
    <h3
      className={cn("text-sm font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }) {
  return <p className={cn("mt-1 text-xs text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return (
    <div className={cn("flex items-center border-t px-4 py-3", className)} {...props} />
  );
}
