import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { cn } from "../lib/cn.js";

// Textarea with `@`-trigger autocomplete for template variables.
//
// Type `@` anywhere in the textarea to open the dropdown. Continue typing
// to filter; arrow keys / enter to insert. The inserted snippet is the
// full `{{var}}` placeholder, with a sensible default format pipe for date
// variables (e.g. `{{current_date|DD/MM/YYYY}}`).
//
// Variables come from the server registry (cached after the first load
// per page) and a `customGroups` prop for editor-specific extras.

let cachedSpec = null;
let cachedAt = 0;
const SPEC_TTL_MS = 5 * 60 * 1000;

async function fetchSpec() {
  if (cachedSpec && Date.now() - cachedAt < SPEC_TTL_MS) return cachedSpec;
  const { data } = await api.get("/templates/variables");
  cachedSpec = data;
  cachedAt = Date.now();
  return data;
}

function flatten(spec) {
  const out = [];
  for (const group of spec.groups || []) {
    for (const v of group.variables || []) {
      out.push({ ...v, group: group.name });
    }
  }
  return out;
}

// Suggest a default format for date variables so the inserted placeholder
// renders nicely without further editing.
const DEFAULT_INSERT_FORMAT = {
  current_date: "D MMM YYYY",
  current_time: "hh:mm A",
  current_datetime: "D MMM YYYY hh:mm A",
  meeting_date: "D MMM YYYY",
  meeting_time: "hh:mm A",
  followup_date: "D MMM YYYY",
};

function insertSnippet(v) {
  const fmt = DEFAULT_INSERT_FORMAT[v.name];
  return fmt ? `{{${v.name}|${fmt}}}` : `{{${v.name}}}`;
}

export default function VariableTextarea({
  value,
  onChange,
  placeholder,
  rows = 5,
  className,
  customGroups = [],
  ...rest
}) {
  const ref = useRef(null);
  const [spec, setSpec] = useState(null);
  const [popup, setPopup] = useState(null); // { triggerIdx, query }
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    fetchSpec().then((s) => {
      // Merge in any caller-provided groups so the editor can add page-
      // specific vars (e.g. campaign/automation fields).
      if (customGroups.length) {
        setSpec({ groups: [...s.groups, ...customGroups] });
      } else {
        setSpec(s);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flat = useMemo(() => (spec ? flatten(spec) : []), [spec]);

  const filtered = useMemo(() => {
    if (!popup) return [];
    const q = popup.query.toLowerCase();
    return flat.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q),
    );
  }, [flat, popup]);

  useEffect(() => {
    setHighlight(0);
  }, [popup?.query]);

  function onTextChange(e) {
    const text = e.target.value;
    onChange?.(text);

    // Track the popup state. Open when the user types `@` immediately
    // after whitespace or at the start of the textarea; close on space
    // or escape.
    const caret = e.target.selectionStart;
    const before = text.slice(0, caret);
    // Look backwards for the most recent `@` that starts an open trigger.
    const at = before.lastIndexOf("@");
    if (at === -1) {
      setPopup(null);
      return;
    }
    const seg = before.slice(at + 1);
    if (/\s/.test(seg)) {
      setPopup(null);
      return;
    }
    // Allow the trigger only when the char before `@` is whitespace or
    // start-of-input — otherwise emails / @mentions in body text would
    // erroneously open the picker.
    const prev = at > 0 ? before[at - 1] : "";
    if (prev && !/\s/.test(prev)) {
      setPopup(null);
      return;
    }
    setPopup({ triggerIdx: at, query: seg });
  }

  function applyInsert(variable) {
    if (!popup || !ref.current) return;
    const el = ref.current;
    const snippet = insertSnippet(variable);
    const head = (value || "").slice(0, popup.triggerIdx);
    const tail = (value || "").slice(el.selectionStart);
    const next = head + snippet + tail;
    onChange?.(next);
    setPopup(null);
    // Restore caret position right after the inserted snippet.
    requestAnimationFrame(() => {
      const pos = (head + snippet).length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e) {
    if (!popup || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyInsert(filtered[highlight]);
    } else if (e.key === "Escape") {
      setPopup(null);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={onTextChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={rows}
        className={cn(
          "block w-full rounded-md border bg-background px-3 py-2 text-sm font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
          className,
        )}
        {...rest}
      />
      {popup && filtered.length > 0 && (
        <VariablePopup
          items={filtered}
          highlight={highlight}
          onPick={applyInsert}
        />
      )}
      <div className="mt-1 text-[11px] text-muted-foreground">
        Type <code className="rounded bg-muted px-1">@</code> to insert a variable.
        Format dates with <code className="rounded bg-muted px-1">{`{{var|DD/MM/YYYY}}`}</code>.
      </div>
    </div>
  );
}

function VariablePopup({ items, highlight, onPick }) {
  // Group items back by their group field for visual grouping.
  const groups = useMemo(() => {
    const out = new Map();
    for (const it of items) {
      if (!out.has(it.group)) out.set(it.group, []);
      out.get(it.group).push(it);
    }
    return Array.from(out.entries());
  }, [items]);

  // Build a flat index → element map so we can highlight across groups.
  let idx = 0;
  return (
    <div className="absolute left-0 z-30 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border bg-popover text-sm shadow-lg">
      {groups.map(([group, vars]) => (
        <div key={group}>
          <div className="border-b bg-muted/40 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {group}
          </div>
          {vars.map((v) => {
            const myIdx = idx++;
            const active = myIdx === highlight;
            return (
              <button
                key={v.name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(v);
                }}
                className={cn(
                  "block w-full px-3 py-1.5 text-left transition-colors",
                  active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-xs">{`{{${v.name}}}`}</code>
                  {v.sample && (
                    <span className="truncate text-[10px] text-muted-foreground">
                      {v.sample}
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {v.description}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
