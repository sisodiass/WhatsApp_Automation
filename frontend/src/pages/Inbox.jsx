import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Inbox as InboxIcon, Search, X } from "lucide-react";
import { api } from "../lib/api.js";
import { getSocket } from "../lib/socket.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { SkeletonList } from "../components/ui/Skeleton.jsx";

const STATE_VARIANT = {
  NEW: "muted",
  ACTIVE: "info",
  PAUSED: "warning",
  DEMO_PENDING: "info",
  FOLLOWUP: "info",
  MANUAL: "warning",
  CLOSED: "muted",
};

const MODE_VARIANT = {
  AI: "success",
  MANUAL: "warning",
};

export default function Inbox() {
  const [items, setItems] = useState([]);
  const [tags, setTags] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (q.trim()) params.q = q.trim();
      if (stateFilter) params.state = stateFilter;
      if (modeFilter) params.mode = modeFilter;
      if (tagFilter) params.tag = tagFilter;
      if (campaignFilter) params.campaignId = campaignFilter;
      const [chats, tagList, campaignList] = await Promise.all([
        api.get("/chats", { params }),
        api.get("/tags"),
        api.get("/campaigns"),
      ]);
      setItems(chats.data.items || []);
      setTags(tagList.data.items || []);
      setCampaigns(campaignList.data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    let timer = null;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 1000);
    };
    socket.on("chat:message", onChange);
    socket.on("session:update", onChange);
    socket.on("manual_queue:new", onChange);
    return () => {
      socket.off("chat:message", onChange);
      socket.off("session:update", onChange);
      socket.off("manual_queue:new", onChange);
      clearTimeout(timer);
    };
  }, [q, stateFilter, modeFilter, tagFilter, campaignFilter]);

  const tagsById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags]);

  function applyFilters(e) {
    e?.preventDefault?.();
    load();
  }

  function clearFilters() {
    setQ("");
    setStateFilter("");
    setModeFilter("");
    setTagFilter("");
    setCampaignFilter("");
    setTimeout(load, 0);
  }

  const hasFilters = q || stateFilter || modeFilter || tagFilter || campaignFilter;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={InboxIcon}
        title="Inbox"
        subtitle={loading ? "Loading…" : `${items.length} chat${items.length !== 1 ? "s" : ""}`}
      />

      {/* Filter bar */}
      <form
        onSubmit={applyFilters}
        className="flex flex-wrap items-center gap-2 border-b bg-background/80 px-6 py-3 backdrop-blur"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search phone or name…"
            className="w-64 pl-8"
          />
        </div>
        <Select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="w-auto min-w-[8rem]"
        >
          <option value="">All states</option>
          {Object.keys(STATE_VARIANT).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value)}
          className="w-auto min-w-[7rem]"
        >
          <option value="">All modes</option>
          <option value="AI">AI</option>
          <option value="MANUAL">MANUAL</option>
        </Select>
        <Select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="w-auto min-w-[7rem]"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        <Select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="w-auto min-w-[9rem]"
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Button type="submit" size="sm">
          <Filter className="h-3.5 w-3.5" />
          Apply
        </Button>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </form>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <SkeletonList rows={6} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <Card>
            <ul className="divide-y">
              {items.map((c) => {
                const session = c.sessions?.[0];
                const queueCount = c._count?.manualQueueItems ?? 0;
                return (
                  <li key={c.id}>
                    <Link
                      to={`/chats/${c.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {c.displayName || c.phone}
                          </span>
                          <span className="text-xs text-muted-foreground">{c.phone}</span>
                          {queueCount > 0 && (
                            <Badge variant="warning">{queueCount} unresolved</Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {session?.campaign && (
                            <span
                              title={`Campaign tag: ${session.campaign.tag}`}
                              className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                            >
                              {session.campaign.name}
                            </span>
                          )}
                          {(c.tags || []).map((ct) => {
                            const tag = ct.tag || tagsById[ct.tagId];
                            if (!tag) return null;
                            return (
                              <span
                                key={tag.id}
                                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                                style={tag.color ? { backgroundColor: tag.color, color: "white" } : undefined}
                              >
                                {tag.name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {session && (
                          <>
                            <Badge variant={STATE_VARIANT[session.state] || "muted"}>
                              {session.state}
                            </Badge>
                            <Badge variant={MODE_VARIANT[session.mode] || "muted"}>
                              {session.mode}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {session.aiReplyCount}/10
                            </span>
                          </>
                        )}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {c.lastMessageAt
                            ? new Date(c.lastMessageAt).toLocaleDateString()
                            : "—"}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card py-16 text-center animate-fade-in">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <InboxIcon className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">No chats yet</h3>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Customers reach you via{" "}
        <code className="rounded bg-muted px-1 font-mono">wa.me/&lt;number&gt;?text=&lt;TAG&gt;</code>.
        New conversations will appear here once they arrive.
      </p>
    </div>
  );
}
