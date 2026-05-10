import { cn } from "../../lib/cn.js";

export function Skeleton({ className, ...props }) {
  return <div className={cn("skeleton", className)} {...props} />;
}

// Common preset skeletons used across pages.
export function SkeletonRow({ cols = 4 }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === 0 ? "w-1/4" : i === cols - 1 ? "w-16" : "w-1/6")}
        />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/50">
        <SkeletonRow cols={cols} />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} cols={cols} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 4 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}
