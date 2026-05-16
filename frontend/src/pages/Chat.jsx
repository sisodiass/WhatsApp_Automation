import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  Calendar,
  CircleStop,
  FileText,
  PauseCircle,
  PlayCircle,
  Send,
  Sparkles,
  UserCog,
} from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { getSocket } from "../lib/socket.js";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Textarea } from "../components/ui/Input.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";
import CustomerPanel from "../components/CustomerPanel.jsx";
import DemoBookingModal from "../components/DemoBookingModal.jsx";

const SOURCE_STYLES = {
  CUSTOMER: "bg-card border text-card-foreground",
  AI: "bg-info/10 border-info/20 text-foreground",
  AGENT: "bg-success/10 border-success/20 text-foreground",
  SYSTEM: "bg-muted border text-muted-foreground italic",
};

const STATE_LABEL = {
  NEW: "New",
  ACTIVE: "Active",
  PAUSED: "Paused",
  DEMO_PENDING: "Demo pending",
  FOLLOWUP: "Follow-up",
  MANUAL: "Manual",
  CLOSED: "Closed",
};

export default function Chat() {
  const { chatId } = useParams();
  const [chat, setChat] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demoOpen, setDemoOpen] = useState(false);
  // M7: AI-suggested replies state.
  const [suggestTone, setSuggestTone] = useState("professional");
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  // M11.B4: context returned alongside the suggestions so the UI can
  // explain WHY they look like they do (objection-handling / upsell).
  const [suggestMeta, setSuggestMeta] = useState(null);
  const scrollRef = useRef(null);

  async function loadShell() {
    setLoading(true);
    try {
      const { data } = await api.get(`/chats/${chatId}/sessions`);
      setChat(data.chat);
      setSessions(data.items || []);
      const cur = (data.items || []).find((s) => !s.endedAt) || data.items?.[0] || null;
      setActiveSession(cur || null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(sessionId) {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    const { data } = await api.get(`/sessions/${sessionId}/messages`);
    setMessages(data.items || []);
  }

  useEffect(() => {
    loadShell();
  }, [chatId]);

  useEffect(() => {
    if (activeSession) loadMessages(activeSession.id);
  }, [activeSession?.id]);

  useEffect(() => {
    if (!activeSession) return;
    const socket = getSocket();
    const onMessage = (msg) => {
      if (msg.sessionId !== activeSession.id) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id);
        if (idx === -1) return [...prev, msg];
        const next = [...prev];
        next[idx] = { ...prev[idx], ...msg };
        return next;
      });
    };
    const onSession = (patch) => {
      if (patch.sessionId !== activeSession.id) return;
      setActiveSession((s) => (s ? { ...s, ...patch } : s));
    };
    socket.on("chat:message", onMessage);
    socket.on("session:update", onSession);
    return () => {
      socket.off("chat:message", onMessage);
      socket.off("session:update", onSession);
    };
  }, [activeSession?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function send(e) {
    e?.preventDefault?.();
    if (!reply.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/chats/${chatId}/messages`, { body: reply.trim() });
      setReply("");
      if (activeSession) loadMessages(activeSession.id);
    } catch (err) {
      toast.fromError(err, "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function flipMode(mode) {
    if (!activeSession) return;
    try {
      const { data } = await api.patch(`/sessions/${activeSession.id}/mode`, { mode });
      setActiveSession((s) => ({ ...s, ...data }));
      toast.success(mode === "AI" ? "Handed back to AI" : "Switched to manual");
    } catch (err) {
      toast.fromError(err, "Mode change failed");
    }
  }

  async function setState(state) {
    if (!activeSession) return;
    try {
      const { data } = await api.patch(`/sessions/${activeSession.id}/state`, { state });
      setActiveSession((s) => ({ ...s, ...data }));
      if (state === "CLOSED") {
        loadShell();
        toast.info("Session closed");
      }
    } catch (err) {
      toast.fromError(err, "State change failed");
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Compact header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-background/80 px-6 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/inbox"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            {loading || !chat ? (
              <>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1 h-3 w-24" />
              </>
            ) : (
              <>
                <div className="truncate text-sm font-semibold">
                  {chat.displayName ||
                    (chat.phone?.endsWith("@lid") ? "(WhatsApp private)" : chat.phone)}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {chat.phone?.endsWith("@lid") ? "(WhatsApp private)" : chat.phone}
                </div>
              </>
            )}
          </div>
        </div>

        {activeSession && !loading && (
          <div className="flex items-center gap-2">
            <Badge variant={activeSession.mode === "AI" ? "success" : "warning"}>
              {activeSession.mode}
            </Badge>
            <Badge variant="muted">{STATE_LABEL[activeSession.state] || activeSession.state}</Badge>
            <Badge variant="info">AI {activeSession.aiReplyCount}/10</Badge>
          </div>
        )}
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Sessions sidebar */}
        <aside className="scrollbar-thin w-52 shrink-0 overflow-y-auto border-r bg-card p-3">
          <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Sessions
          </div>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setActiveSession(s)}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      activeSession?.id === s.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <div className="font-medium">
                      {new Date(s.startedAt).toLocaleDateString()}
                    </div>
                    <div className="mt-0.5 text-[10px] opacity-80">
                      {s.state} · {s.aiReplyCount} AI · {s._count?.messages ?? 0} msg
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Messages + reply */}
        <section className="flex flex-1 flex-col">
          <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-2 overflow-y-auto bg-muted/30 p-6">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="ml-auto h-12 w-2/3 rounded-lg" />
                <Skeleton className="h-10 w-1/2 rounded-lg" />
                <Skeleton className="ml-auto h-14 w-3/4 rounded-lg" />
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex animate-fade-in",
                    m.direction === "OUT" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[70%] rounded-lg border px-3 py-2 text-sm shadow-sm",
                      SOURCE_STYLES[m.source] || SOURCE_STYLES.SYSTEM,
                    )}
                  >
                    <div className="whitespace-pre-wrap">{m.body}</div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span>{m.source}</span>
                      {m.confidence != null && <span>conf {m.confidence.toFixed(2)}</span>}
                      {m.direction === "OUT" && (
                        <span>{m.sentAt ? "sent" : "queued"}</span>
                      )}
                      {/* Outbound: prefer sentAt (actual delivery time) so the
                          delay/typing simulation isn't hidden by the createdAt
                          timestamp. Falls back to createdAt while still queued. */}
                      <span
                        title={
                          m.sentAt && m.sentAt !== m.createdAt
                            ? `Created ${new Date(m.createdAt).toLocaleTimeString()} · Sent ${new Date(m.sentAt).toLocaleTimeString()}`
                            : undefined
                        }
                      >
                        {new Date(m.sentAt || m.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Mode + state controls */}
          {activeSession && !activeSession.endedAt && !loading && (
            <div className="flex flex-wrap items-center gap-1.5 border-t bg-background px-4 py-2">
              {activeSession.mode === "AI" ? (
                <Button size="sm" variant="outline" onClick={() => flipMode("MANUAL")}>
                  <UserCog className="h-3.5 w-3.5" />
                  Take over
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => flipMode("AI")}>
                  <Bot className="h-3.5 w-3.5" />
                  Hand back to AI
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setState("PAUSED")}
                disabled={activeSession.state === "PAUSED"}
              >
                <PauseCircle className="h-3.5 w-3.5" />
                Pause
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setState("ACTIVE")}
                disabled={activeSession.state === "ACTIVE"}
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Active
              </Button>
              <div className="ml-auto" />
              {chat?.contactId && (
                <Link
                  to={`/quotations/new?contactId=${chat.contactId}`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title="Create a quotation pre-filled with this contact"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Send quote
                </Link>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDemoOpen(true)}
                title="Schedule a Teams demo and notify the customer"
              >
                <Calendar className="h-3.5 w-3.5" />
                Book demo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setState("CLOSED")}
              >
                <CircleStop className="h-3.5 w-3.5" />
                Close
              </Button>
            </div>
          )}

          {/* Reply box */}
          {activeSession && !activeSession.endedAt && !loading && (
            <div className="border-t bg-background">
              {/* M7: AI suggested replies. Above the input so it doesn't
                  steal vertical space when unused. */}
              <div className="flex items-center gap-2 px-4 pt-3">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={suggestBusy || messages.length === 0}
                  onClick={async () => {
                    setSuggestBusy(true);
                    try {
                      const { data } = await api.post(`/chats/${chatId}/suggest-replies`, {
                        tone: suggestTone,
                      });
                      setSuggestions(data.suggestions || []);
                      setSuggestMeta({
                        mode: data.mode || "default",
                        intent: data.intent || null,
                        score: data.score || null,
                        candidateProducts: data.candidateProducts || [],
                      });
                    } catch (err) {
                      toast.error(err.response?.data?.error?.message || "Suggest failed");
                    } finally {
                      setSuggestBusy(false);
                    }
                  }}
                >
                  <Sparkles className="h-3 w-3" />
                  {suggestBusy ? "Thinking…" : "Suggest replies"}
                </Button>
                <select
                  value={suggestTone}
                  onChange={(e) => setSuggestTone(e.target.value)}
                  className="h-7 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="brief">Brief</option>
                </select>
                {/* M11.B4: mode badge explains why the suggestions look
                    the way they do. Only renders for the two non-default
                    modes — default mode keeps the UI clean. */}
                {suggestMeta && suggestMeta.mode && suggestMeta.mode !== "default" && (
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-medium " +
                      (suggestMeta.mode === "objection-handling"
                        ? "bg-warning/15 text-warning"
                        : "bg-success/15 text-success")
                    }
                  >
                    {suggestMeta.mode === "objection-handling"
                      ? "Objection-handling"
                      : "Upsell-aware"}
                  </span>
                )}
                {suggestions && (
                  <button
                    type="button"
                    onClick={() => {
                      setSuggestions(null);
                      setSuggestMeta(null);
                    }}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                )}
              </div>
              {suggestions && suggestions.length > 0 && (
                <ul className="space-y-1.5 px-4 pt-2">
                  {suggestions.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => {
                          setReply(s);
                          setSuggestions(null);
                          setSuggestMeta(null);
                        }}
                        className="block w-full rounded-md border bg-info/5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-info/10"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                  {/* M11.B4: when upsell-aware mode fired, surface the
                      candidate products the AI was given as input. Lets
                      the operator quickly see what add-ons are on the
                      table without leaving the chat. */}
                  {suggestMeta?.mode === "upsell-aware" &&
                    suggestMeta.candidateProducts?.length > 0 && (
                      <li className="pt-1 text-[10px] text-muted-foreground">
                        Candidate add-ons:{" "}
                        {suggestMeta.candidateProducts
                          .slice(0, 5)
                          .map((p) => p.name)
                          .join(" · ")}
                      </li>
                    )}
                </ul>
              )}
              <form onSubmit={send} className="flex items-end gap-2 p-4">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
                  }}
                  placeholder={
                    activeSession.mode === "AI"
                      ? "Type a manual reply (sending will switch this session to MANUAL)…"
                      : "Type a reply to the customer…"
                  }
                  rows={2}
                  className="flex-1"
                />
                <Button type="submit" disabled={busy || !reply.trim()} size="lg">
                  <Send className="h-4 w-4" />
                  {busy ? "Sending…" : "Send"}
                </Button>
              </form>
            </div>
          )}
        </section>

        {chatId && <CustomerPanel chatId={chatId} />}
      </main>

      {demoOpen && (
        <DemoBookingModal
          chatId={chatId}
          onClose={() => setDemoOpen(false)}
          onBooked={(data) => {
            toast.success(
              data?.meeting?.joinUrl
                ? "Demo booked — Teams link sent to customer"
                : "Demo recorded (Teams not configured — placeholder link sent)",
            );
            if (activeSession) loadMessages(activeSession.id);
          }}
        />
      )}
    </div>
  );
}
