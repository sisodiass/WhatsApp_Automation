import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HelpCircle, Settings as SettingsIcon } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { Tooltip } from "../components/ui/Tooltip.jsx";
import { cn } from "../lib/cn.js";

const GROUPS = [
  { id: "ai", label: "AI", help: "Provider, models, confidence threshold, generation timeout." },
  { id: "session", label: "Session", help: "Reset window, resume window." },
  { id: "wa", label: "WhatsApp", help: "Send delays, outbound rate limit, warmup mode." },
  { id: "manual_queue", label: "Manual Queue", help: "SLA threshold for queue UI highlighting." },
  {
    id: "handover",
    label: "Confidence-driven handover",
    help: "Keyword-driven auto-flip to MANUAL. Human-request defaults ON; negative-sentiment is opt-in.",
  },
  {
    id: "email",
    label: "Email notifications",
    help: "Transactional email provider + which notification kinds also email admin users.",
  },
  { id: "microsoft", label: "Microsoft Teams", help: "Graph API credentials for demo booking." },
  {
    id: "payments",
    label: "Payments",
    help: "Default provider + Razorpay/Stripe credentials. Webhook secrets are encrypted at rest.",
  },
  {
    id: "quotations",
    label: "Quotations",
    help: "Numbering, default validity, tax, approval threshold, default terms.",
  },
  { id: "invoices", label: "Invoices", help: "Invoice numbering." },
  {
    id: "tenant",
    label: "Tenant",
    help: "Workspace-level toggles, including public-signup gating.",
  },
];

// Friendly labels + tooltip help text per key.
const META = {
  "ai.global_enabled": {
    label: "Global AI enabled",
    help: "Master kill-switch. When OFF, every customer message gets the MANUAL_HANDOFF template instead of going through the AI pipeline. Useful during incidents or planned maintenance.",
  },
  "ai.provider": {
    label: "Active provider",
    help: "Which AI vendor handles embeddings + chat completions. Switching requires re-embedding all KB documents (the dashboard banner will prompt you).",
  },
  "ai.confidence_threshold": {
    label: "Confidence threshold (0–1)",
    help: "Minimum hybrid-search top score required to send an AI reply. Below this, the FALLBACK template is sent (mode stays AI; counts toward the 10-cap). 0.7–0.85 is the production sweet spot.",
  },
  "ai.max_replies_per_session": {
    label: "Max AI replies per session",
    help: "How many AI replies (and fallback messages) can fire before the session auto-flips to MANUAL and goes into the manual queue. Default 10.",
  },
  "ai.concurrent_retrieval_limit": {
    label: "Concurrent KB retrieval limit",
    help: "Max parallel kb-search jobs the worker process will run. Tune up for higher concurrency (uses more CPU + API quota).",
  },
  "ai.generation_timeout_seconds": {
    label: "Generation timeout (seconds)",
    help: "Hard timeout on the LLM call. Exceeding this triggers the fallback path. 15s default; raise to 30s if you've hit Gemini free-tier rate limits.",
  },
  "ai.openai.api_key": {
    label: "OpenAI API key",
    help: "Encrypted at rest. Overrides OPENAI_API_KEY from .env when set. Get one at platform.openai.com/api-keys.",
  },
  "ai.openai.chat_model": {
    label: "OpenAI chat model",
    help: "Model used for generating customer replies. gpt-4o-mini is the cost/quality sweet spot.",
  },
  "ai.openai.embedding_model": {
    label: "OpenAI embedding model",
    help: "Model used for KB chunk embeddings. text-embedding-3-small produces 1536-dim vectors that match the kb_chunks.embedding column.",
  },
  "ai.gemini.api_key": {
    label: "Gemini API key",
    help: "Encrypted at rest. Get one at aistudio.google.com/app/apikey.",
  },
  "ai.gemini.chat_model": {
    label: "Gemini chat model",
    help: "Model used for generating customer replies. gemini-2.5-flash-lite is the recommended sweet spot.",
  },
  "ai.gemini.embedding_model": {
    label: "Gemini embedding model",
    help: "Model used for KB chunk embeddings. Configured to output 1536-dim vectors (Matryoshka projection).",
  },
  "ai.claude.api_key": {
    label: "Anthropic Claude API key",
    help: "Encrypted at rest. Get one at console.anthropic.com. Claude is chat-only — set ai.embedding_provider to openai or gemini for KB.",
  },
  "ai.claude.chat_model": {
    label: "Claude chat model",
    help: "Model used for generating customer replies when ai.provider is claude. claude-3-5-sonnet-latest is the default.",
  },
  "ai.embedding_provider": {
    label: "Embedding provider (when chat = Claude)",
    help: "Which provider supplies KB embeddings. Only consulted when ai.provider is claude (Claude has no native embeddings). Must be openai or gemini.",
  },
  "session.inactivity_reset_days": {
    label: "Inactivity reset (days)",
    help: "Customer must be idle longer than this AND re-enter via campaign tag to start a fresh session. Plain inactivity below this never resets.",
  },
  "session.resume_after_hours": {
    label: "Session resume threshold (hours)",
    help: "If a customer is idle longer than this (but less than the reset window), their next message triggers a SESSION_RESUME template before AI handles it.",
  },
  "wa.delay_min_seconds": {
    label: "Reply delay min (seconds)",
    help: "Minimum random typing-simulation delay before AI replies are actually sent. Prevents bot-like instant replies.",
  },
  "wa.delay_max_seconds": {
    label: "Reply delay max (seconds)",
    help: "Maximum random delay before sending. Each reply picks a random value in [min, max].",
  },
  "wa.outbound_per_minute_max": {
    label: "Outbound rate (msgs/min)",
    help: "Per-WhatsApp-number cap on outbound messages. Above this, BullMQ queues briefly. Protects against WhatsApp anti-spam detection.",
  },
  "wa.warmup_mode": {
    label: "Warmup mode",
    help: "When ON, uses the warmup-rate + warmup-delay limits instead of the normal ones. Recommended for fresh numbers during the first 1–2 weeks.",
  },
  "wa.warmup_outbound_per_minute_max": {
    label: "Warmup outbound rate (msgs/min)",
    help: "Slower send rate used while warmup mode is ON. Default 10. Raise to 15–20 after the first week.",
  },
  "wa.warmup_delay_min_seconds": {
    label: "Warmup delay min (seconds)",
    help: "Larger random typing delay used while warmup mode is ON. Makes the number look less bot-like.",
  },
  "wa.warmup_delay_max_seconds": {
    label: "Warmup delay max (seconds)",
    help: "Upper bound for warmup-mode delay.",
  },
  "manual_queue.sla_minutes": {
    label: "Manual queue SLA (minutes)",
    help: "Items older than this get a red SLA badge in the queue UI. Operational signal — agents should target picking up before this.",
  },
  "handover.human_request_enabled": {
    label: "Handover on human-request keyword",
    help: "When ON, an inbound message containing any of the human-request keywords below auto-flips the session to MANUAL with reason KEYWORD_TRIGGER. Default ON — unambiguous customer signal.",
  },
  "handover.human_request_keywords": {
    label: "Human-request keywords (CSV)",
    help: "Comma-separated phrases. Word-boundary matched (so 'human' doesn't match 'humanitarian'). Multi-word phrases match as substring. Edit to add domain-specific phrases.",
  },
  "handover.negative_sentiment_enabled": {
    label: "Handover on negative sentiment",
    help: "When ON, an inbound message containing frustration/anger cues auto-flips the session to MANUAL with reason NEGATIVE_SENTIMENT. Default OFF — false positives (e.g. 'refund' in a routine query) can over-route.",
  },
  "handover.negative_sentiment_keywords": {
    label: "Negative-sentiment keywords (CSV)",
    help: "Comma-separated phrases. Only consulted when the toggle above is ON. Tune for your customer base — e.g. industries with high refund volume should remove 'refund'.",
  },
  "email.enabled": {
    label: "Email notifications",
    help: "Master switch. When OFF, no notification ever triggers an email regardless of email.notify_kinds. Default ON.",
  },
  "email.provider": {
    label: "Email provider",
    help: "Which transactional email service to use. 'stub' is a safe no-op that records sends in memory — fine for dev. Switch to resend or postmark in production after pasting credentials below.",
  },
  "email.from_address": {
    label: "From address",
    help: "The 'From:' email address used on every outbound email. Must be a verified sender in your provider's dashboard (Resend: domain verification; Postmark: sender signature).",
  },
  "email.from_name": {
    label: "From name",
    help: "Display name shown in the recipient's inbox. Defaults to 'SalesAutomation'.",
  },
  "email.notify_kinds": {
    label: "Notification kinds that also email (CSV)",
    help: "Which notification kinds trigger an email alongside the in-app bell. Default: JOB_FAILED,WEBHOOK_FAILED,AI_QUOTATION_REVIEW. Routine kinds like LEAD_ASSIGNED stay in-app only by design.",
  },
  "email.resend.api_key": {
    label: "Resend API key",
    help: "Encrypted at rest. Get one at resend.com/api-keys. Only used when email.provider is 'resend'.",
  },
  "email.postmark.server_token": {
    label: "Postmark server token",
    help: "Encrypted at rest. Get one from your Postmark server's API tokens page. Only used when email.provider is 'postmark'.",
  },
  "tenant.signup_enabled": {
    label: "Allow public signup (SaaS mode)",
    help: "When ON, anyone can create a new organization via /signup and become its SUPER_ADMIN. Default OFF — existing single-tenant deploys stay safe. Flip ON only when you're running this as a multi-tenant SaaS and want to accept self-service signups.",
  },
  "microsoft.tenant_id": {
    label: "Microsoft tenant ID",
    help: "Azure AD tenant GUID for the app registration used by the Teams demo-booking flow.",
  },
  "microsoft.client_id": {
    label: "Microsoft client ID",
    help: "Azure AD app registration client ID.",
  },
  "microsoft.client_secret": {
    label: "Microsoft client secret",
    help: "Encrypted at rest. Generated in the Azure AD app registration's Certificates & secrets section.",
  },
  "microsoft.organizer_user_id": {
    label: "Microsoft organizer user ID",
    help: "GUID of the Microsoft user who hosts the Teams meetings created by demo-booking. Must have OnlineMeetings.ReadWrite.All app permission.",
  },
  // M11 — Payments
  "payments.default_provider": {
    label: "Default payment provider",
    help: "Which gateway createPaymentLink uses by default. STUB is the dev provider — flip to RAZORPAY or STRIPE once credentials are saved below.",
  },
  "payments.currency_default": {
    label: "Default currency",
    help: "ISO 4217 code used when a quotation or payment link doesn't specify one (e.g. INR, USD).",
  },
  "payments.link_expiry_hours": {
    label: "Link expiry (hours)",
    help: "Default validity for new payment links. 0 disables expiry.",
  },
  "payments.razorpay.key_id": {
    label: "Razorpay key ID",
    help: "Encrypted at rest. From Razorpay dashboard → Settings → API Keys.",
  },
  "payments.razorpay.key_secret": {
    label: "Razorpay key secret",
    help: "Encrypted at rest. Pair with the key ID above.",
  },
  "payments.razorpay.webhook_secret": {
    label: "Razorpay webhook secret",
    help: "Encrypted. Set on the Razorpay webhook configured to POST /api/webhooks/payments/razorpay.",
  },
  "payments.stripe.publishable_key": {
    label: "Stripe publishable key",
    help: "From Stripe dashboard. Although public, we store it encrypted to keep secrets handling uniform.",
  },
  "payments.stripe.secret_key": {
    label: "Stripe secret key",
    help: "Encrypted at rest. From Stripe dashboard → Developers → API Keys.",
  },
  "payments.stripe.webhook_secret": {
    label: "Stripe webhook secret",
    help: "Encrypted. Set on the Stripe webhook endpoint configured for POST /api/webhooks/payments/stripe.",
  },
  // M11 — Quotations
  "quotations.number_prefix": {
    label: "Quote number prefix",
    help: "Used in number_format. Default 'QTN'.",
  },
  "quotations.number_format": {
    label: "Quote number format",
    help: "Placeholders: {prefix}, {yyyy}, {seq:N}. Example: 'QTN-{yyyy}-{seq:06}'.",
  },
  "quotations.default_validity_days": {
    label: "Default validity (days)",
    help: "New quotes default to today + this many days as valid_until.",
  },
  "quotations.tax_rate_default": {
    label: "Default tax rate %",
    help: "Suggested tax rate when a line item has no rate from the linked Product.",
  },
  "quotations.approval_threshold_amount": {
    label: "Approval threshold",
    help: "Quotations with grandTotal at or above this amount require an APPROVED QuotationApproval row before /send.",
  },
  "quotations.terms_default": {
    label: "Default terms",
    help: "Pre-fills the Terms field on new quotes; operators can override per quote.",
  },
  "invoices.number_prefix": {
    label: "Invoice number prefix",
    help: "Used in number_format. Default 'INV'.",
  },
  "invoices.number_format": {
    label: "Invoice number format",
    help: "Placeholders: {prefix}, {yyyy}, {seq:N}.",
  },
};

const ENUMS = {
  "ai.provider": ["openai", "gemini", "claude"],
  "ai.embedding_provider": ["openai", "gemini"],
  "payments.default_provider": ["STUB", "RAZORPAY", "STRIPE"],
  "email.provider": ["stub", "resend", "postmark"],
};

export default function Settings() {
  const [items, setItems] = useState([]);
  const [writable, setWritable] = useState(new Set());
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/settings");
      setItems(data.items || []);
      setWritable(new Set(data.writable || []));
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(GROUPS.map((g) => [g.id, []]));
    for (const it of items) {
      const prefix = it.key.split(".")[0];
      if (map[prefix]) map[prefix].push(it);
    }
    return map;
  }, [items]);

  async function save(key, value) {
    setSavingKey(key);
    setError(null);
    try {
      await api.put(`/settings/${encodeURIComponent(key)}`, { value });
      await load();
    } catch (err) {
      setError(`${key}: ${err.response?.data?.error?.message || "save failed"}`);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        subtitle="Runtime configuration · changes apply immediately (workers may need ~30s)"
        actions={
          <Link to="/audit">
            <Button variant="outline" size="sm">Audit log</Button>
          </Link>
        }
      />

      {error && (
        <div className="border-b bg-destructive/10 px-6 py-2 text-sm text-destructive animate-fade-in">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {loading ? (
            <>
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </>
          ) : (
            GROUPS.map((g) => {
              const list = grouped[g.id] || [];
              if (list.length === 0) return null;
              return (
                <section
                  key={g.id}
                  className="overflow-hidden rounded-lg border bg-card animate-fade-in"
                >
                  <div className="border-b bg-muted/40 px-4 py-3">
                    <h2 className="text-sm font-semibold tracking-tight">{g.label}</h2>
                    <p className="text-xs text-muted-foreground">{g.help}</p>
                  </div>
                  <ul className="divide-y">
                    {list.map((it) => (
                      <SettingRow
                        key={it.key}
                        item={it}
                        writable={writable.has(it.key)}
                        saving={savingKey === it.key}
                        draft={drafts[it.key]}
                        setDraft={(v) => setDrafts({ ...drafts, [it.key]: v })}
                        onSave={(value) => save(it.key, value)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function SettingRow({ item, writable, saving, draft, setDraft, onSave }) {
  const meta = META[item.key] || {};
  const label = meta.label || item.key;
  const help = meta.help;
  const enumOptions = ENUMS[item.key];
  const inputType = item.encrypted
    ? "secret"
    : typeof item.value === "boolean"
      ? "boolean"
      : typeof item.value === "number"
        ? "number"
        : enumOptions
          ? "enum"
          : "string";

  const draftValue = draft !== undefined ? draft : item.value;
  const dirty = draft !== undefined && draft !== item.value;

  function commit() {
    if (!dirty) return;
    onSave(coerce(inputType, draft));
  }

  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{label}</span>
          {help && (
            <Tooltip content={help} side="right">
              <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
            </Tooltip>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{item.key}</div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!writable && <Badge variant="muted">read-only</Badge>}

        {inputType === "boolean" && (
          <button
            disabled={!writable || saving}
            onClick={() => onSave(!item.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
              item.value
                ? "border-success/30 bg-success/10 text-success"
                : "border-border text-muted-foreground",
            )}
          >
            <span
              className={cn("inline-block h-1.5 w-1.5 rounded-full", item.value ? "bg-success" : "bg-muted-foreground")}
            />
            {item.value ? "On" : "Off"}
          </button>
        )}

        {inputType === "number" && (
          <Input
            type="number"
            step="any"
            disabled={!writable || saving}
            value={draftValue ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="h-8 w-28 text-right text-sm"
          />
        )}

        {inputType === "enum" && (
          <Select
            disabled={!writable || saving}
            value={draftValue ?? ""}
            onChange={(e) => onSave(e.target.value)}
            className="h-8 w-auto min-w-[7rem]"
          >
            {enumOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
        )}

        {inputType === "string" && (
          <Input
            type="text"
            disabled={!writable || saving}
            value={draftValue ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="h-8 w-64 text-sm"
          />
        )}

        {inputType === "secret" && (
          <SecretInput
            hasValue={item.hasValue}
            disabled={!writable || saving}
            onSave={(v) => onSave(v)}
          />
        )}

        {dirty && writable && (
          <Button onClick={commit} disabled={saving} size="xs">Save</Button>
        )}
      </div>
    </li>
  );
}

function coerce(inputType, raw) {
  if (inputType === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (inputType === "boolean") return Boolean(raw);
  return raw;
}

function SecretInput({ hasValue, disabled, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-muted-foreground">
          {hasValue ? "••••••••" : <span className="italic">not set</span>}
        </span>
        <Button size="xs" variant="outline" disabled={disabled} onClick={() => setEditing(true)}>
          {hasValue ? "Replace" : "Set"}
        </Button>
      </div>
    );
  }

  function commit() {
    if (value.trim()) onSave(value);
    setEditing(false);
    setValue("");
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setEditing(false); setValue(""); }
        }}
        placeholder="paste value…"
        className="h-8 w-56 font-mono text-sm"
      />
      <Button size="xs" onClick={commit} disabled={!value.trim()}>Save</Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => { setEditing(false); setValue(""); }}
      >
        Cancel
      </Button>
    </div>
  );
}
