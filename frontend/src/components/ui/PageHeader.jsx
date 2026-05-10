import { cn } from "../../lib/cn.js";

// Standard page header shown at the top of every page inside AppShell.
// Compact, info-dense — title, optional subtitle, optional right rail
// for actions.
export function PageHeader({ icon: Icon, title, subtitle, actions, className }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-3 border-b bg-background/80 px-6 py-4 backdrop-blur",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        </div>
        {subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
