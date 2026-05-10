import { useEffect, useState } from "react";
import { Plus, StickyNote, Tag as TagIcon, X } from "lucide-react";
import { api } from "../lib/api.js";
import { confirm } from "../stores/confirmStore.js";
import { Textarea } from "./ui/Input.jsx";
import { Button } from "./ui/Button.jsx";
import { cn } from "../lib/cn.js";

export default function CustomerPanel({ chatId }) {
  const [allTags, setAllTags] = useState([]);
  const [chatTags, setChatTags] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);

  async function load() {
    const [tagList, chatList, noteList] = await Promise.all([
      api.get("/tags"),
      api.get(`/chats/${chatId}/sessions`),
      api.get(`/chats/${chatId}/notes`),
    ]);
    setAllTags(tagList.data.items || []);
    setChatTags(chatList.data.chat?.tags || []);
    setNotes(noteList.data.items || []);
  }

  useEffect(() => {
    if (chatId) load();
  }, [chatId]);

  async function addTag(tagId) {
    setBusy(true);
    try {
      await api.post(`/chats/${chatId}/tags/${tagId}`);
      await load();
      setTagPickerOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tagId) {
    setBusy(true);
    try {
      await api.delete(`/chats/${chatId}/tags/${tagId}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e) {
    e?.preventDefault?.();
    if (!noteDraft.trim()) return;
    setBusy(true);
    try {
      await api.post(`/chats/${chatId}/notes`, { body: noteDraft.trim() });
      setNoteDraft("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(id) {
    const ok = await confirm({
      title: "Delete this note?",
      variant: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/notes/${id}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const assigned = new Set(chatTags.map((ct) => ct.tagId || ct.tag?.id));
  const available = allTags.filter((t) => !assigned.has(t.id));

  return (
    <aside className="scrollbar-thin w-72 shrink-0 overflow-y-auto border-l bg-card p-4">
      {/* Tags */}
      <section className="mb-6">
        <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <TagIcon className="h-3 w-3" />
          Tags
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {chatTags.length === 0 && (
            <span className="text-xs text-muted-foreground">No tags assigned</span>
          )}
          {chatTags.map((ct) => {
            const tag = ct.tag;
            if (!tag) return null;
            return (
              <button
                key={tag.id}
                onClick={() => removeTag(tag.id)}
                disabled={busy}
                title="Click to remove"
                className="group inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                style={tag.color ? { backgroundColor: tag.color, color: "white" } : undefined}
              >
                {tag.name}
                <X className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100" />
              </button>
            );
          })}
          {available.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setTagPickerOpen((o) => !o)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                add
              </button>
              {tagPickerOpen && (
                <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-popover py-1 shadow-md animate-fade-in">
                  {available.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => addTag(t.id)}
                      className="block w-full px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Notes */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <StickyNote className="h-3 w-3" />
          Internal notes
        </h3>
        <form onSubmit={addNote} className="mb-3">
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Add a note (internal — never sent to customer)…"
            rows={2}
            className="text-xs"
          />
          <Button
            type="submit"
            disabled={busy || !noteDraft.trim()}
            size="sm"
            variant="secondary"
            className="mt-1.5 w-full"
          >
            Add note
          </Button>
        </form>
        <ul className="space-y-2">
          {notes.length === 0 && (
            <li className="text-xs text-muted-foreground">No notes yet.</li>
          )}
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border-l-2 border-warning bg-warning/5 p-2 text-xs">
              <div className="whitespace-pre-wrap text-foreground">{n.body}</div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {n.author?.email || "system"} · {new Date(n.createdAt).toLocaleString()}
                </span>
                <button
                  onClick={() => deleteNote(n.id)}
                  className="text-destructive hover:underline"
                >
                  delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
