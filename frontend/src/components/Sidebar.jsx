import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Heart,
  HelpCircle,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  LogOut,
  MessageCircle,
  Megaphone,
  Moon,
  Send,
  Settings as SettingsIcon,
  Sun,
  Tags as TagsIcon,
  Users,
  Wrench,
  Monitor,
} from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/authStore.js";
import { useThemeStore } from "../stores/themeStore.js";

// Sections roughly mirror Linear: workspace (the things you live in
// daily), configuration, and ops.
const NAV_SECTIONS = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/inbox", label: "Inbox", icon: Inbox },
      { to: "/contacts", label: "Contacts", icon: Users },
      { to: "/sources", label: "Sources", icon: TagsIcon },
      { to: "/pipeline", label: "Pipeline", icon: LayoutGrid },
      { to: "/queue", label: "Manual Queue", icon: ListTodo, badgeKey: "queue" },
    ],
  },
  {
    label: "Configure",
    items: [
      { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { to: "/channels", label: "Channels", icon: MessageCircle, roles: ["SUPER_ADMIN", "ADMIN"] },
      { to: "/integrations", label: "Website Integrations", icon: KeyRound, roles: ["SUPER_ADMIN", "ADMIN"] },
      { to: "/campaigns", label: "Campaigns", icon: Megaphone },
      { to: "/bulk", label: "Bulk Broadcasts", icon: Send },
      { to: "/followups", label: "Follow-ups", icon: Bell },
      { to: "/automations", label: "Automations", icon: Bot, roles: ["SUPER_ADMIN", "ADMIN"] },
      { to: "/kb", label: "Knowledge Base", icon: BookOpen },
      { to: "/templates", label: "Templates", icon: FileText },
      { to: "/tags", label: "Tags", icon: TagsIcon },
    ],
  },
  {
    label: "System",
    roles: ["SUPER_ADMIN", "ADMIN"],
    items: [
      { to: "/settings", label: "Settings", icon: SettingsIcon, roles: ["SUPER_ADMIN", "ADMIN"] },
      { to: "/health", label: "Health", icon: Heart },
      { to: "/audit", label: "Audit Log", icon: Activity, roles: ["SUPER_ADMIN", "ADMIN"] },
      // Bull-Board needs the JWT in a query param because browser navigation
      // doesn't carry the Authorization header. The backend's /admin/queues
      // mount accepts ?token= and copies it into the Bearer header.
      // Prefix with VITE_SOCKET_URL (bare API origin) so it works when the
      // frontend lives on a different origin than the backend (prod). Empty
      // in dev — Vite proxy forwards /admin/queues to the backend.
      { external: true, label: "Bull-Board", icon: Wrench, hrefBuilder: (token) => `${import.meta.env.VITE_SOCKET_URL || ""}/admin/queues?token=${encodeURIComponent(token || "")}` },
    ],
  },
  {
    label: "Resources",
    items: [
      { to: "/help", label: "Help Guide", icon: HelpCircle },
    ],
  },
];

const COLLAPSED_KEY = "sa-sidebar-collapsed";

export default function Sidebar({ badges = {} }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const { user, accessToken, clear } = useAuthStore();
  const { theme, toggle } = useThemeStore();

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } finally {
      clear();
    }
  }

  const role = user?.role;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r bg-card text-card-foreground transition-[width] duration-150",
        collapsed ? "w-[60px]" : "w-[232px]",
      )}
    >
      {/* Brand */}
      <div className="flex h-12 items-center justify-between border-b px-3">
        {!collapsed && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-primary-foreground">
              SA
            </div>
            <span className="truncate text-sm font-semibold tracking-tight">
              SalesAutomation
            </span>
          </div>
        )}
        <button
          onClick={toggleCollapse}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3">
        {NAV_SECTIONS.map((section) => {
          if (section.roles && !section.roles.includes(role)) return null;
          return (
            <div key={section.label} className="mb-4">
              {!collapsed && (
                <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  if (item.roles && !item.roles.includes(role)) return null;
                  return (
                    <li key={item.to || item.label}>
                      <NavItem
                        item={item}
                        collapsed={collapsed}
                        badge={item.badgeKey ? badges[item.badgeKey] : null}
                        accessToken={accessToken}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Footer: theme toggle + user + sign out */}
      <div className="border-t px-2 py-2">
        <button
          onClick={toggle}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            collapsed && "justify-center px-0",
          )}
          title={`Theme: ${theme} (click to change)`}
        >
          <ThemeIcon theme={theme} />
          {!collapsed && <span className="capitalize">{theme}</span>}
        </button>

        <div
          className={cn(
            "mt-2 flex items-center gap-2 rounded-md px-2 py-1.5",
            collapsed && "justify-center px-0",
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase text-muted-foreground">
            {(user?.email || "?").slice(0, 1)}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{user?.email}</div>
              <div className="truncate text-[10px] text-muted-foreground">{user?.role}</div>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={logout}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function NavItem({ item, collapsed, badge, accessToken }) {
  const Icon = item.icon;
  const baseCls =
    "group flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors";
  const idle = "text-muted-foreground hover:bg-accent hover:text-accent-foreground";
  const active = "bg-accent text-foreground";

  // External link (e.g. Bull-Board) opens new tab. `hrefBuilder` lets us
  // inject the JWT into the URL since browser navigation can't carry
  // the Authorization header.
  if (item.external) {
    const href = item.hrefBuilder ? item.hrefBuilder(accessToken) : item.href;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(baseCls, idle, collapsed && "justify-center px-0")}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            <ExternalLink className="h-3 w-3 opacity-50" />
          </>
        )}
      </a>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(baseCls, isActive ? active : idle, collapsed && "justify-center px-0")
      }
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-warning/20 px-1.5 text-[10px] font-medium text-warning">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function ThemeIcon({ theme }) {
  if (theme === "dark") return <Moon className="h-4 w-4" />;
  if (theme === "light") return <Sun className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}
