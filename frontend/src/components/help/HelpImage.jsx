import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { cn } from "../../lib/cn.js";

// Captioned image slot for the help guide.
//
// While we're still drafting content, no real screenshots exist yet — so
// HelpImage renders a dashed-border placeholder box with the caption and
// the expected `src` path. Drop a PNG at `frontend/public/help-images/<name>`
// (or any URL) and the component automatically switches to the real <img>.
//
// Props:
//   src       — path to the screenshot (e.g. "/help-images/dashboard.png")
//   alt       — alt text for the rendered image
//   caption   — short caption shown below (also shown in placeholder mode)
//   width     — optional max width (defaults to full)
export default function HelpImage({ src, alt, caption, width }) {
  // We treat any failed image load as "still a placeholder" so the page
  // never shows a broken-image icon during the screenshotting phase.
  const [failed, setFailed] = useState(false);
  const showReal = src && !failed;

  return (
    <figure
      className={cn(
        "my-4",
        width ? "" : "w-full",
      )}
      style={width ? { maxWidth: width } : undefined}
    >
      {showReal ? (
        <img
          src={src}
          alt={alt || caption || ""}
          onError={() => setFailed(true)}
          className="block w-full rounded-md border border-border shadow-sm"
        />
      ) : (
        <div
          className={cn(
            "flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 p-6 text-center",
            "help-placeholder",
          )}
        >
          <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Screenshot placeholder
          </div>
          <div className="text-sm text-foreground">{caption || alt}</div>
          {src && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              Drop image at <code className="rounded bg-background px-1 py-0.5">{src}</code>
            </div>
          )}
        </div>
      )}
      {caption && (
        <figcaption className="mt-2 text-xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
