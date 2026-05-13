import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Toaster from "./Toaster.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import NotificationsBell from "./NotificationsBell.jsx";
import { api } from "../lib/api.js";
import { getSocket } from "../lib/socket.js";

// Wraps every protected route. Persistent sidebar on the left, page
// content on the right. Polls the manual queue count + listens for
// `manual_queue:new` socket events so the sidebar badge stays current.

export default function AppShell() {
  const [badges, setBadges] = useState({ queue: 0 });

  async function loadQueueCount() {
    try {
      const { data } = await api.get("/manual-queue");
      setBadges((b) => ({ ...b, queue: (data.items || []).length }));
    } catch {
      /* ignore — sidebar badge is best-effort */
    }
  }

  useEffect(() => {
    loadQueueCount();
    const t = setInterval(loadQueueCount, 30_000);

    let socket;
    try {
      socket = getSocket();
      socket.on("manual_queue:new", loadQueueCount);
    } catch {
      // socket may not be ready on first render
    }
    return () => {
      clearInterval(t);
      if (socket) socket.off("manual_queue:new", loadQueueCount);
    };
  }, []);

  return (
    <div className="app-shell-root flex h-full bg-background text-foreground">
      <Sidebar badges={badges} />
      <div className="app-shell-col flex flex-1 flex-col overflow-hidden">
        {/* Top utility bar — currently just the notifications bell. */}
        <div
          data-print="hide"
          className="flex h-10 shrink-0 items-center justify-end gap-2 border-b bg-card px-3"
        >
          <NotificationsBell />
        </div>
        <main className="scrollbar-thin flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <Toaster />
      <ConfirmDialog />
    </div>
  );
}
