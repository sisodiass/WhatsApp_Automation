import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { cn } from "../lib/cn.js";

// In-app notifications dropdown. Polls /api/notifications/unread-count
// every 30s for the badge; loads the panel contents on first open and
// refreshes on subsequent opens.
//
// Per project memory: NO Socket.io for notifications — polling only.

const POLL_MS = 30_000;

export default function NotificationsBell() {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef(null);

  async function pollUnread() {
    try {
      const { data } = await api.get("/notifications/unread-count");
      setUnread(data.count || 0);
    } catch {
      // soft-fail — badge stays stale
    }
  }

  async function loadItems() {
    setBusy(true);
    try {
      const { data } = await api.get("/notifications?limit=20");
      setItems(data.items || []);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    pollUnread();
    const t = setInterval(pollUnread, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await loadItems();
  }

  async function onItemClick(item) {
    if (!item.readAt) {
      try {
        await api.post(`/notifications/${item.id}/read`);
        setUnread((n) => Math.max(0, n - 1));
        setItems((arr) => arr.map((x) => (x.id === item.id ? { ...x, readAt: new Date().toISOString() } : x)));
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    if (item.url) navigate(item.url);
    else if (item.leadId) navigate(`/leads/${item.leadId}`);
    else if (item.chatId) navigate(`/chats/${item.chatId}`);
  }

  async function markAll() {
    try {
      await api.post("/notifications/read-all");
      setUnread(0);
      setItems((arr) => arr.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
    } catch {
      /* ignore */
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={toggle}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-md border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Notifications
            </span>
            {items.some((i) => !i.readAt) && (
              <button
                onClick={markAll}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <CheckCheck className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {busy ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nothing here yet.
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => onItemClick(n)}
                      className={cn(
                        "block w-full px-3 py-2 text-left transition-colors hover:bg-accent",
                        !n.readAt && "bg-accent/40",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.readAt && (
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{n.title}</div>
                          {n.body && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {n.body}
                            </div>
                          )}
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {new Date(n.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
