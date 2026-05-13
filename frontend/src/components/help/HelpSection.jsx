import { Badge } from "../ui/Badge.jsx";
import { cn } from "../../lib/cn.js";

// One numbered section in the help guide.
//
// Each section renders an anchor target (`id`), a heading with the section
// number and role badges, and its body content. The role badges are
// purely informational — the help page itself is visible to everyone.
//
// Props:
//   id      — anchor id, used for the ToC link (e.g. "setup")
//   number  — section number shown as a prefix in the heading
//   title   — section title
//   roles   — array of role labels ("Admin", "Manager", "Agent", "All")
//   children — section body
const ROLE_VARIANT = {
  Admin: "info",
  Manager: "success",
  Agent: "warning",
  All: "muted",
};

export default function HelpSection({ id, number, title, roles = ["All"], children }) {
  return (
    <section
      id={id}
      className={cn(
        "help-section scroll-mt-24 border-t border-border pt-8 first:border-t-0 first:pt-0",
      )}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          {number != null && (
            <span className="mr-2 text-muted-foreground">{number}.</span>
          )}
          {title}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {roles.map((r) => (
            <Badge key={r} variant={ROLE_VARIANT[r] || "default"}>
              {r}
            </Badge>
          ))}
        </div>
      </header>
      <div className="help-prose space-y-4 text-sm leading-relaxed text-foreground">
        {children}
      </div>
    </section>
  );
}
