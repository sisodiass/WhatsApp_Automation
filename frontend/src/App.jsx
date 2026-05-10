import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Whatsapp from "./pages/Whatsapp.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import Kb from "./pages/Kb.jsx";
import ManualQueue from "./pages/ManualQueue.jsx";
import Chat from "./pages/Chat.jsx";
import Inbox from "./pages/Inbox.jsx";
import Tags from "./pages/Tags.jsx";
import Templates from "./pages/Templates.jsx";
import Settings from "./pages/Settings.jsx";
import Health from "./pages/Health.jsx";
import Audit from "./pages/Audit.jsx";
import Analytics from "./pages/Analytics.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AppShell from "./components/AppShell.jsx";
import { useThemeStore } from "./stores/themeStore.js";

export default function App() {
  // Hydrate the theme on first mount — the store's persist hook applies
  // it after rehydration but does nothing for SSR / fast-refresh edge
  // cases. Calling it explicitly is cheap and idempotent.
  const hydrate = useThemeStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* All protected pages share the persistent AppShell (sidebar). */}
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/whatsapp" element={<Whatsapp />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/kb" element={<Kb />} />
        <Route path="/queue" element={<ManualQueue />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/tags" element={<Tags />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/health" element={<Health />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/chats/:chatId" element={<Chat />} />

        {/* Admin-only routes use ProtectedRoute again to gate by role. */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute roles={["SUPER_ADMIN", "ADMIN"]}>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute roles={["SUPER_ADMIN", "ADMIN"]}>
              <Audit />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );
}
