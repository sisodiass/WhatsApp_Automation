import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  ChevronDown,
  GripVertical,
  LayoutGrid,
  Plus,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

// Lead Kanban — drag a card to drop it onto another stage column.
// Optimistic update: card moves in the UI immediately; the API PATCH
// runs in the background; on failure we revert and toast the error.

export default function Pipeline() {
  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState(null);
  const [board, setBoard] = useState(null); // { pipeline, stages: [{...stage, leads: []}] }
  const [loading, setLoading] = useState(true);
  const [activeDrag, setActiveDrag] = useState(null); // { leadId, fromStageId }
  const [draggingLead, setDraggingLead] = useState(null);
  const [newOpen, setNewOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function loadPipelines() {
    const { data } = await api.get("/pipelines");
    const items = data.items || [];
    setPipelines(items);
    if (!pipelineId && items.length) {
      const def = items.find((p) => p.isDefault) || items[0];
      setPipelineId(def.id);
    }
  }

  async function loadBoard(pid) {
    if (!pid) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/leads/board/${pid}`);
      setBoard(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPipelines(); }, []);
  useEffect(() => { if (pipelineId) loadBoard(pipelineId); }, [pipelineId]);

  function onDragStart(e) {
    const id = e.active.id;
    // Find the lead + its current stage so we can revert on failure.
    let lead = null;
    let fromStageId = null;
    for (const s of board?.stages || []) {
      const l = s.leads.find((x) => x.id === id);
      if (l) {
        lead = l;
        fromStageId = s.id;
        break;
      }
    }
    setActiveDrag({ leadId: id, fromStageId });
    setDraggingLead(lead);
  }

  function onDragCancel() {
    setActiveDrag(null);
    setDraggingLead(null);
  }

  async function onDragEnd(e) {
    const drag = activeDrag;
    setActiveDrag(null);
    setDraggingLead(null);

    const toStageId = e.over?.id;
    if (!drag || !toStageId || toStageId === drag.fromStageId) return;

    // Optimistic move — splice the card between stages.
    const before = board;
    const moved = applyMove(board, drag.leadId, drag.fromStageId, toStageId);
    if (!moved) return;
    setBoard(moved);

    try {
      await api.patch(`/leads/${drag.leadId}/stage`, { stageId: toStageId });
    } catch (err) {
      // Revert.
      setBoard(before);
      toast.error(err.response?.data?.error?.message || "Failed to move lead");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={LayoutGrid}
        title="Pipeline"
        subtitle={loading ? "Loading…" : board?.pipeline?.name || ""}
        actions={
          <div className="flex items-center gap-2">
            <PipelinePicker value={pipelineId} options={pipelines} onChange={setPipelineId} />
            <Button size="sm" variant="outline" onClick={() => loadBoard(pipelineId)}>
              Refresh
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)} disabled={!pipelineId}>
              <Plus className="h-3.5 w-3.5" /> New lead
            </Button>
          </div>
        }
      />

      {newOpen && (
        <NewLeadModal
          pipelineId={pipelineId}
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            loadBoard(pipelineId);
          }}
        />
      )}

      <div className="flex-1 overflow-hidden">
        {loading || !board ? (
          <div className="flex h-full gap-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-full w-72 shrink-0" />
            ))}
          </div>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
            <div className="flex h-full gap-3 overflow-x-auto p-4">
              {board.stages.map((s) => (
                <Column key={s.id} stage={s} />
              ))}
            </div>
            <DragOverlay>
              {draggingLead ? (
                <div className="rotate-2 cursor-grabbing">
                  <LeadCard lead={draggingLead} dragging />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function applyMove(board, leadId, fromId, toId) {
  if (!board) return null;
  let lead = null;
  const stages = board.stages.map((s) => {
    if (s.id === fromId) {
      const idx = s.leads.findIndex((l) => l.id === leadId);
      if (idx === -1) return s;
      lead = s.leads[idx];
      return { ...s, leads: [...s.leads.slice(0, idx), ...s.leads.slice(idx + 1)] };
    }
    return s;
  });
  if (!lead) return null;
  const movedLead = {
    ...lead,
    stageId: toId,
    stage: { ...lead.stage, id: toId, name: stages.find((s) => s.id === toId)?.name ?? lead.stage?.name },
  };
  return {
    ...board,
    stages: stages.map((s) => (s.id === toId ? { ...s, leads: [movedLead, ...s.leads] } : s)),
  };
}

// ─── Stage column ────────────────────────────────────────────────

function Column({ stage }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const CategoryIcon = stage.category === "WON" ? Trophy : stage.category === "LOST" ? XCircle : null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-72 shrink-0 flex-col rounded-lg border bg-card transition-colors",
        isOver && "border-primary ring-1 ring-primary/30",
      )}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {stage.color && (
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: stage.color }}
            />
          )}
          <span className="text-sm font-medium">{stage.name}</span>
          {CategoryIcon && <CategoryIcon className="h-3 w-3 text-muted-foreground" />}
        </div>
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          {stage.leads.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {stage.leads.length === 0 ? (
          <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">
            No leads
          </p>
        ) : (
          stage.leads.map((l) => <DraggableCard key={l.id} lead={l} />)
        )}
      </div>
    </div>
  );
}

function DraggableCard({ lead }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("touch-none", isDragging && "opacity-30")}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

function LeadCard({ lead, dragging }) {
  const c = lead.contact || {};
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.mobile || "(no name)";
  return (
    <Link
      to={`/leads/${lead.id}`}
      onClick={(e) => dragging && e.preventDefault()}
      className={cn(
        "block rounded-md border bg-background p-2.5 text-xs shadow-sm transition-shadow hover:shadow",
        dragging && "shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{name}</div>
          {c.company && (
            <div className="truncate text-[11px] text-muted-foreground">{c.company}</div>
          )}
          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
            {lead.score && (
              <span
                className={cn(
                  "rounded-full px-1.5",
                  lead.score === "HOT" && "bg-destructive/15 text-destructive",
                  lead.score === "WARM" && "bg-warning/15 text-warning",
                  lead.score === "COLD" && "bg-info/15 text-info",
                  lead.score === "UNQUALIFIED" && "bg-muted text-muted-foreground",
                )}
              >
                {lead.score}
              </span>
            )}
            {lead.expectedValue && (
              <span>
                {lead.currency || ""} {Number(lead.expectedValue).toLocaleString()}
              </span>
            )}
            {lead.assignedTo?.name && (
              <span className="truncate">· {lead.assignedTo.name}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function PipelinePicker({ value, options, onChange }) {
  const current = useMemo(() => options.find((o) => o.id === value), [options, value]);
  const [open, setOpen] = useState(false);
  if (!options.length) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs"
      >
        {current?.name || "—"}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border bg-popover shadow">
            {options.map((o) => (
              <button
                key={o.id}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-xs hover:bg-accent",
                  o.id === value && "bg-accent",
                )}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                {o.name}
                {o.isDefault && (
                  <span className="ml-2 text-[10px] text-muted-foreground">default</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── New lead modal ──────────────────────────────────────────────────
// Two paths: pick an existing contact via search, OR create a new
// contact inline (name + mobile). The lead lands in the pipeline's
// first stage by default; expectedValue + source are optional.
function NewLeadModal({ pipelineId, onClose, onCreated }) {
  const [mode, setMode] = useState("existing"); // "existing" | "new"
  const [busy, setBusy] = useState(false);

  // Existing contact mode
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [contact, setContact] = useState(null);
  const searchTimer = useRef(null);

  // New contact mode
  const [newContact, setNewContact] = useState({
    firstName: "", lastName: "", mobile: "", email: "", company: "",
  });

  // Shared lead fields
  const [lead, setLead] = useState({
    source: "manual", expectedValue: "", currency: "INR",
  });

  // Debounced contact search.
  useEffect(() => {
    if (mode !== "existing") return;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (!search.trim()) { setResults([]); return; }
      try {
        const { data } = await api.get("/contacts", { params: { search, pageSize: 10 } });
        setResults(data.items || []);
      } catch { setResults([]); }
    }, 200);
    return () => clearTimeout(searchTimer.current);
  }, [search, mode]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      let contactId;
      if (mode === "existing") {
        if (!contact) { toast.error("Pick a contact first"); return; }
        contactId = contact.id;
      } else {
        if (!newContact.mobile.trim()) { toast.error("Mobile is required"); return; }
        const payload = {
          mobile: newContact.mobile.trim(),
          firstName: newContact.firstName.trim() || null,
          lastName: newContact.lastName.trim() || null,
          email: newContact.email.trim() || null,
          company: newContact.company.trim() || null,
        };
        const { data } = await api.post("/contacts", payload);
        contactId = data.id;
      }
      const leadPayload = { contactId, pipelineId };
      if (lead.source) leadPayload.source = lead.source;
      if (lead.expectedValue) {
        leadPayload.expectedValue = Number(lead.expectedValue);
        if (lead.currency) leadPayload.currency = lead.currency;
      }
      await api.post("/leads", leadPayload);
      toast.success("Lead created");
      onCreated();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
      <form onSubmit={save} className="w-full max-w-md animate-slide-up">
        <Card>
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-base font-semibold tracking-tight">New lead</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 p-5">
            <div className="inline-flex rounded-md border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode("existing")}
                className={cn(
                  "rounded px-3 py-1 transition-colors",
                  mode === "existing" ? "bg-foreground text-background" : "text-muted-foreground",
                )}
              >
                Existing contact
              </button>
              <button
                type="button"
                onClick={() => setMode("new")}
                className={cn(
                  "rounded px-3 py-1 transition-colors",
                  mode === "new" ? "bg-foreground text-background" : "text-muted-foreground",
                )}
              >
                New contact
              </button>
            </div>

            {mode === "existing" ? (
              <div className="space-y-2">
                {!contact ? (
                  <>
                    <Input
                      autoFocus
                      placeholder="Search name, mobile, email…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {results.length > 0 && (
                      <div className="max-h-48 overflow-y-auto rounded-md border">
                        {results.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => setContact(c)}
                          >
                            <div className="font-medium">
                              {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.mobile}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {c.mobile} {c.company ? `· ${c.company}` : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {search.trim() && results.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No matches. Switch to "New contact" to create one.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">
                        {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.mobile}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{contact.mobile}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setContact(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name">
                  <Input
                    autoFocus
                    value={newContact.firstName}
                    onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
                  />
                </Field>
                <Field label="Last name">
                  <Input
                    value={newContact.lastName}
                    onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
                  />
                </Field>
                <div className="col-span-2">
                  <Field label="Mobile (E.164, no +)">
                    <Input
                      required
                      placeholder="919999999999"
                      value={newContact.mobile}
                      onChange={(e) => setNewContact({ ...newContact, mobile: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Email">
                  <Input
                    type="email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  />
                </Field>
                <Field label="Company">
                  <Input
                    value={newContact.company}
                    onChange={(e) => setNewContact({ ...newContact, company: e.target.value })}
                  />
                </Field>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <Field label="Source">
                <Input
                  value={lead.source}
                  onChange={(e) => setLead({ ...lead, source: e.target.value })}
                  placeholder="manual"
                />
              </Field>
              <Field label="Expected value">
                {/* Tight flex layout: w-full on the underlying <Input>
                    plus the browser's intrinsic min-width on type=number
                    means the number field overflows without min-w-0.
                    shrink-0 on the currency keeps INR readable. */}
                <div className="flex gap-1.5">
                  <Input
                    className="w-20 shrink-0 uppercase"
                    maxLength={3}
                    value={lead.currency}
                    onChange={(e) => setLead({ ...lead, currency: e.target.value.toUpperCase() })}
                    placeholder="INR"
                  />
                  <Input
                    type="number"
                    className="min-w-0 flex-1"
                    value={lead.expectedValue}
                    onChange={(e) => setLead({ ...lead, expectedValue: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={busy || (mode === "existing" ? !contact : !newContact.mobile.trim())}
            >
              Create lead
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}
