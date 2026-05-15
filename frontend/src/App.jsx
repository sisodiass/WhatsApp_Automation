import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Whatsapp from "./pages/Whatsapp.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import Automations from "./pages/Automations.jsx";
import BulkCampaigns from "./pages/BulkCampaigns.jsx";
import Channels from "./pages/Channels.jsx";
import Contacts from "./pages/Contacts.jsx";
import Followups from "./pages/Followups.jsx";
import Integrations from "./pages/Integrations.jsx";
import Sources from "./pages/Sources.jsx";
import Kb from "./pages/Kb.jsx";
import LeadDetail from "./pages/LeadDetail.jsx";
import Pipeline from "./pages/Pipeline.jsx";
import ManualQueue from "./pages/ManualQueue.jsx";
import Chat from "./pages/Chat.jsx";
import Inbox from "./pages/Inbox.jsx";
import Tags from "./pages/Tags.jsx";
import Templates from "./pages/Templates.jsx";
import Settings from "./pages/Settings.jsx";
import Health from "./pages/Health.jsx";
import Audit from "./pages/Audit.jsx";
import Analytics from "./pages/Analytics.jsx";
import Help from "./pages/Help.jsx";
import Products from "./pages/Products.jsx";
import Quotations from "./pages/Quotations.jsx";
import QuotationDetail from "./pages/QuotationDetail.jsx";
import QuotationEditor from "./pages/QuotationEditor.jsx";
import Payments from "./pages/Payments.jsx";
import Invoices from "./pages/Invoices.jsx";
import PricingRules from "./pages/PricingRules.jsx";
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
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/leads/:leadId" element={<LeadDetail />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/bulk" element={<BulkCampaigns />} />
        <Route path="/followups" element={<Followups />} />
        <Route
          path="/automations"
          element={
            <ProtectedRoute roles={["SUPER_ADMIN", "ADMIN"]}>
              <Automations />
            </ProtectedRoute>
          }
        />
        <Route
          path="/channels"
          element={
            <ProtectedRoute roles={["SUPER_ADMIN", "ADMIN"]}>
              <Channels />
            </ProtectedRoute>
          }
        />
        <Route
          path="/integrations"
          element={
            <ProtectedRoute roles={["SUPER_ADMIN", "ADMIN"]}>
              <Integrations />
            </ProtectedRoute>
          }
        />
        <Route path="/kb" element={<Kb />} />
        <Route path="/queue" element={<ManualQueue />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/tags" element={<Tags />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/health" element={<Health />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/chats/:chatId" element={<Chat />} />
        <Route path="/help" element={<Help />} />

        {/* M11 — Revenue */}
        <Route path="/products" element={<Products />} />
        <Route path="/quotations" element={<Quotations />} />
        <Route path="/quotations/new" element={<QuotationEditor />} />
        <Route path="/quotations/:id" element={<QuotationDetail />} />
        <Route path="/quotations/:id/edit" element={<QuotationEditor />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route
          path="/pricing-rules"
          element={
            <ProtectedRoute roles={["SUPER_ADMIN", "ADMIN"]}>
              <PricingRules />
            </ProtectedRoute>
          }
        />

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
