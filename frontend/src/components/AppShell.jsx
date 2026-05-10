import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Toaster from "./Toaster.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
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
    <div className="flex h-full bg-background text-foreground">
      <Sidebar badges={badges} />
      <main className="scrollbar-thin flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <Toaster />
      <ConfirmDialog />
    </div>
  );
}
