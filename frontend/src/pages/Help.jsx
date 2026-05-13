import { Download, HelpCircle, Printer } from "lucide-react";
import { Button } from "../components/ui/Button.jsx";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import HelpSection from "../components/help/HelpSection.jsx";
import HelpImage from "../components/help/HelpImage.jsx";
import "./Help.css";

// In-app user guide for SalesAutomation. Designed to be read on screen
// AND printed/saved as a PDF via the browser's built-in print-to-PDF
// (Ctrl/Cmd+P, destination: Save as PDF). Print styling lives in
// Help.css; everything tagged data-print="hide" disappears in print.

const SECTIONS = [
  { id: "overview", number: 1, title: "Overview", roles: ["All"] },
  { id: "setup", number: 2, title: "First-time setup", roles: ["Admin"] },
  { id: "whatsapp", number: 3, title: "Connect WhatsApp", roles: ["Admin"] },
  { id: "channels", number: 4, title: "Channels & multi-source messaging", roles: ["Admin"] },
  { id: "integrations", number: 5, title: "Website chat widget", roles: ["Admin"] },
  { id: "settings", number: 6, title: "Settings reference", roles: ["Admin"] },
  { id: "kb", number: 7, title: "Upload a knowledge base", roles: ["Admin", "Manager"] },
  { id: "templates", number: 8, title: "Create message templates", roles: ["Manager"] },
  { id: "contacts", number: 9, title: "Contacts", roles: ["Manager", "Agent"] },
  { id: "pipeline", number: 10, title: "Pipeline & leads", roles: ["Manager", "Agent"] },
  { id: "campaigns", number: 11, title: "Opt-in campaigns", roles: ["Manager"] },
  { id: "bulk", number: 12, title: "Bulk broadcasts", roles: ["Manager"] },
  { id: "followups", number: 13, title: "Auto follow-ups", roles: ["Manager"] },
  { id: "automations", number: 14, title: "Automations", roles: ["Admin"] },
  { id: "inbox", number: 15, title: "Day-to-day inbox", roles: ["Agent"] },
  { id: "queue", number: 16, title: "Manual queue", roles: ["Agent"] },
  { id: "tags-notes", number: 17, title: "Tags, notes & demo booking", roles: ["Agent"] },
  { id: "analytics", number: 18, title: "Analytics & audit", roles: ["Manager", "Admin"] },
  { id: "health", number: 19, title: "Health & system status", roles: ["Admin"] },
  { id: "troubleshooting", number: 20, title: "Troubleshooting", roles: ["All"] },
  { id: "glossary", number: 21, title: "Glossary", roles: ["All"] },
];

export default function Help() {
  // window.print() opens the native print dialog. With "Save as PDF" as
  // destination it produces a clean PDF using our @media print styles —
  // no extra dependencies, works in every modern browser.
  function handleDownload() {
    window.print();
  }

  const lastUpdated = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="help-root flex h-full flex-col">
      <div data-print="hide">
        <PageHeader
          icon={HelpCircle}
          title="Help guide"
          subtitle="Setup to daily use — every page, every role"
          actions={
            <Button variant="primary" size="md" onClick={handleDownload}>
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          }
        />
      </div>

      <div className="help-scroll flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-3xl px-6 py-8">
          {/* Title block (visible in print) */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">SalesAutomation — User Guide</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A complete walk-through from installation to running campaigns, working
              the pipeline, and handling chats day-to-day. Last updated {lastUpdated}.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Audience:</span>
              <Badge variant="info">Admin</Badge>
              <Badge variant="success">Manager</Badge>
              <Badge variant="warning">Agent</Badge>
              <span className="text-muted-foreground">
                — each section is tagged with the role(s) it's written for.
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2" data-print="hide">
              <Button variant="primary" size="sm" onClick={handleDownload}>
                <Printer className="h-4 w-4" />
                Save as PDF
              </Button>
              <span className="text-xs text-muted-foreground">
                Opens the browser print dialog — pick <em>Save as PDF</em> as the
                destination.
              </span>
            </div>
          </div>

          {/* Table of contents (hidden in print to save paper) */}
          <nav
            data-print="hide"
            className="mb-10 rounded-lg border border-border bg-card p-4"
            aria-label="Table of contents"
          >
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Contents
            </div>
            <ol className="grid gap-1 text-sm sm:grid-cols-2">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-foreground hover:underline">
                    {s.number}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* ============ 1. OVERVIEW ============ */}
          <HelpSection id="overview" number={1} title="Overview" roles={["All"]}>
            <p>
              SalesAutomation is a multi-channel CRM and conversational sales platform.
              It pairs a Kanban-style lead pipeline with WhatsApp, Web Chat, and Meta
              messaging channels — so every conversation feeds the same CRM, and AI
              grounded in your own knowledge base handles the routine replies until a
              human is needed.
            </p>

            <h3>Core concepts you'll see throughout this guide</h3>
            <ul>
              <li>
                <strong>Contact</strong> — a person with a phone/email/company. Source
                of truth for who you're talking to.
              </li>
              <li>
                <strong>Lead</strong> — a deal-shaped record that links a contact to a{" "}
                <strong>pipeline</strong> at a particular <strong>stage</strong>{" "}
                (Prospect → Negotiation → Won / Lost). Has an expected value and an AI
                lead score (HOT / WARM / COLD / UNQUALIFIED).
              </li>
              <li>
                <strong>Pipeline</strong> — a named series of stages that leads move
                through. You can have multiple pipelines (e.g. "Enterprise", "SMB").
              </li>
              <li>
                <strong>Channel</strong> — a messaging provider: WhatsApp, Web Chat,
                Instagram, Facebook Messenger.
              </li>
              <li>
                <strong>Session</strong> — one continuous conversation. Auto-resets
                after 7 days idle; auto-escalates to a human after 10 AI replies.
              </li>
              <li>
                <strong>Campaign</strong> — a topical entry point anchored by a short
                uppercase <strong>tag</strong> (e.g. <code>SPRING</code>) customers send
                to opt in.
              </li>
              <li>
                <strong>Knowledge Base (KB) group</strong> — PDFs the AI grounds its
                answers in. Linked to campaigns.
              </li>
              <li>
                <strong>Manual queue</strong> — agent worklist of conversations needing
                a human reply.
              </li>
              <li>
                <strong>Template</strong> — pre-written message used by the system
                (onboarding, fallback, handoff, …) and by manual sends.
              </li>
              <li>
                <strong>Automation</strong> — event-driven workflow (new lead, stage
                change, no reply) made of WAIT / SEND / ASSIGN / IF steps.
              </li>
            </ul>

            <HelpImage
              src="/help-images/overview-architecture.png"
              caption="High-level architecture: channels → API → CRM (contacts, leads, pipeline) + AI + queues"
            />
          </HelpSection>

          {/* ============ 2. SETUP ============ */}
          <HelpSection id="setup" number={2} title="First-time setup" roles={["Admin"]}>
            <p>
              Fastest path locally is the Docker compose flow. VPS / production install
              is covered in <code>SETUP.md</code>.
            </p>

            <h3>Prerequisites</h3>
            <ul>
              <li>Node.js 20 LTS or newer</li>
              <li>Docker Desktop (Postgres 16 + Redis)</li>
              <li>Chromium / Google Chrome (required by the WhatsApp worker)</li>
              <li>An OpenAI <em>or</em> Gemini API key</li>
            </ul>

            <h3>Boot the stack</h3>
            <ol>
              <li>
                Clone the repo. Copy <code>.env.example</code> → <code>.env</code> in
                the project root and in <code>backend/</code>.
              </li>
              <li>
                Start infra:
                <pre><code>docker compose up -d</code></pre>
              </li>
              <li>
                Install + migrate + seed:
                <pre><code>{`cd backend && npm install && npx prisma migrate deploy && npm run seed
cd ../frontend && npm install`}</code></pre>
              </li>
              <li>
                Open four terminals — the architecture deliberately isolates the
                WhatsApp engine from the API:
                <ul>
                  <li><code>backend</code>: <code>npm run dev</code> — Express API on :4000</li>
                  <li><code>backend</code>: <code>npm run wa</code> — WhatsApp worker</li>
                  <li><code>backend</code>: <code>npm run worker</code> — BullMQ queue workers</li>
                  <li><code>frontend</code>: <code>npm run dev</code> — Vite dev server on :5173</li>
                </ul>
              </li>
              <li>
                Browse to <a href="http://localhost:5173">http://localhost:5173</a> and
                sign in with the seeded admin (<code>admin@local.test</code> + the
                random password printed by the seed script).
              </li>
            </ol>

            <HelpImage
              src="/help-images/login-page.png"
              caption="Login page — use the seeded admin account on first run"
            />
          </HelpSection>

          {/* ============ 3. WHATSAPP ============ */}
          <HelpSection
            id="whatsapp"
            number={3}
            title="Connect WhatsApp"
            roles={["Admin"]}
          >
            <p>
              WhatsApp is connected by pairing your phone with the worker, exactly the
              way WhatsApp Web works — no business verification, no Meta Cloud API
              account required.
            </p>

            <ol>
              <li>Open <strong>WhatsApp</strong> in the sidebar (<code>/whatsapp</code>).</li>
              <li>
                Wait for status to move <code>BOOTING</code> → <code>AWAITING_QR</code>{" "}
                — a QR code appears.
              </li>
              <li>
                On your phone: WhatsApp →{" "}
                <strong>Settings → Linked Devices → Link a Device</strong>. Scan.
              </li>
              <li>
                Status progresses through <code>AUTHENTICATING</code> to{" "}
                <code>READY</code>. Dashboard's WhatsApp card turns green.
              </li>
            </ol>

            <HelpImage
              src="/help-images/whatsapp-qr.png"
              caption="WhatsApp page showing QR code while AWAITING_QR"
            />

            <h3>Stuck on AUTH_FAILURE?</h3>
            <ul>
              <li>Click <strong>Logout</strong> on the WhatsApp page to wipe the saved session.</li>
              <li>Restart the WhatsApp worker process.</li>
              <li>Scan the new QR.</li>
            </ul>
          </HelpSection>

          {/* ============ 4. CHANNELS ============ */}
          <HelpSection
            id="channels"
            number={4}
            title="Channels & multi-source messaging"
            roles={["Admin"]}
          >
            <p>
              Channels is where you turn on the providers customers can reach you
              through. Every chat — wherever it comes from — flows into the same Inbox
              and CRM.
            </p>

            <h3>Available channels</h3>
            <ul>
              <li><strong>WhatsApp</strong> — pre-configured. Just toggle on once you've paired the device (Section 3).</li>
              <li><strong>Web Chat</strong> — pre-configured. Surfaces via the widget you embed on your website (Section 5).</li>
              <li><strong>Instagram</strong> — requires Meta credentials.</li>
              <li><strong>Facebook Messenger</strong> — requires Meta credentials.</li>
            </ul>

            <h3>Connect a Meta channel (Instagram / Messenger)</h3>
            <ol>
              <li>Open <strong>Channels</strong> in the sidebar.</li>
              <li>
                Click <strong>Configure</strong> on the Instagram or Messenger card.
              </li>
              <li>
                Paste your Meta <strong>Page ID</strong>, <strong>Page Access Token</strong>,{" "}
                <strong>App Secret</strong>, and a <strong>Verify Token</strong> of your
                choice. (Secrets are encrypted at rest.)
              </li>
              <li>
                Copy the <strong>Webhook URL</strong> shown on the page (e.g.{" "}
                <code>https://your-host/api/webhooks/meta/messenger</code>) into Meta
                Business Settings → Webhooks for your app, using the same Verify Token.
              </li>
              <li>
                Toggle the channel <strong>Active</strong>. Incoming messages will
                start landing in the Inbox.
              </li>
            </ol>

            <HelpImage
              src="/help-images/channels.png"
              caption="Channels page — WhatsApp + Web Chat on, Meta channels configurable"
            />
          </HelpSection>

          {/* ============ 5. WEBSITE INTEGRATIONS ============ */}
          <HelpSection
            id="integrations"
            number={5}
            title="Website chat widget"
            roles={["Admin"]}
          >
            <p>
              Drop a chat bubble on your website that funnels visitors straight into
              your CRM. Each integration has its own API key, allowed origins, and
              widget appearance.
            </p>

            <ol>
              <li>Open <strong>Website Integrations</strong> in the sidebar.</li>
              <li>
                Click <strong>New integration</strong>. Give it a name (e.g.{" "}
                <code>Acme Marketing Site</code>).
              </li>
              <li>
                List <strong>Allowed domains</strong>, one per line (e.g.{" "}
                <code>www.acme.com</code>, <code>acme.com</code>). Leave blank only for
                local testing — empty means any origin.
              </li>
              <li>
                Set the <strong>Rate limit per minute</strong> (default 60) to protect
                the API from abuse.
              </li>
              <li>
                Customise the widget: primary colour (hex), position (bottom-right /
                bottom-left), welcome text, optional WhatsApp CTA number.
              </li>
              <li>
                Save. Copy the generated API key (prefixed{" "}
                <code>site_…</code>) — it's shown only once. Treat it like a password.
              </li>
              <li>
                Copy the embed snippet and paste it before <code>&lt;/body&gt;</code>{" "}
                on every page that should show the bubble:
                <pre><code>{`<script src="/widget.js" data-api-key="site_..." async></script>`}</code></pre>
              </li>
            </ol>

            <p>
              If a key leaks, click <strong>Rotate</strong>. The old key stops working
              immediately and a new one is shown.
            </p>

            <HelpImage
              src="/help-images/integrations.png"
              caption="Website Integrations — created key with allowed domains and widget preview"
            />
          </HelpSection>

          {/* ============ 6. SETTINGS REFERENCE ============ */}
          <HelpSection
            id="settings"
            number={6}
            title="Settings reference"
            roles={["Admin"]}
          >
            <p>
              The Settings page is the runtime control room for the entire app. Every
              value is encrypted at rest with AES-256-GCM and swappable without a
              restart — workers pick up changes within about 30 seconds. Each row
              shows the setting's key in monospace, an inline help tooltip, and an
              input matched to the type (toggle / number / dropdown / password). Edits
              raise an inline <strong>Save</strong> button.
            </p>

            <p>
              Settings are organised into five groups. Below is every setting you'll
              see, with the default and a one-line note on why you'd change it.
            </p>

            <HelpImage
              src="/help-images/settings-overview.png"
              caption="Settings page with the five groups: AI · Session · WhatsApp · Manual Queue · Microsoft Teams"
            />

            <h3>AI</h3>
            <ul>
              <li>
                <code>ai.global_enabled</code> — master kill switch. Mirrored as the{" "}
                <strong>Global AI</strong> toggle in the Dashboard header. Off = no
                automated replies on any campaign.
              </li>
              <li>
                <code>ai.provider</code> — <code>openai</code> or <code>gemini</code>.
                Swap at any time; in-flight sessions roll over on next reply. See{" "}
                <code>AI_PROVIDERS.md</code> for cost / quality trade-offs.
              </li>
              <li>
                <code>ai.confidence_threshold</code> — 0–1. Sweet spot 0.70–0.85.
                Answers below this fire the FALLBACK template or escalate to manual
                queue.
              </li>
              <li>
                <code>ai.max_replies_per_session</code> (default <code>10</code>) —
                after this many AI replies in one session, the session auto-converts
                to <code>MANUAL</code> regardless of confidence.
              </li>
              <li>
                <code>ai.concurrent_retrieval_limit</code> — how many KB searches may
                run in parallel. Raise on bigger boxes, lower on the 4GB VPS.
              </li>
              <li>
                <code>ai.generation_timeout_seconds</code> (default <code>15</code>) —
                raise to 30 if you're hitting Gemini free-tier latency limits.
              </li>
              <li>
                <code>ai.openai.api_key</code> (secret), <code>ai.openai.chat_model</code>{" "}
                (recommended <code>gpt-4o-mini</code>),{" "}
                <code>ai.openai.embedding_model</code> (recommended{" "}
                <code>text-embedding-3-small</code>, 1536-dim).
              </li>
              <li>
                <code>ai.gemini.api_key</code> (secret),{" "}
                <code>ai.gemini.chat_model</code> (recommended{" "}
                <code>gemini-2.5-flash-lite</code>),{" "}
                <code>ai.gemini.embedding_model</code> (Matryoshka, 1536-dim).
              </li>
            </ul>

            <h3>Session</h3>
            <ul>
              <li>
                <code>session.inactivity_reset_days</code> (default <code>7</code>) —
                after this many idle days, the session is considered finished. The
                customer's next message starts a NEW session.
              </li>
              <li>
                <code>session.resume_after_hours</code> — if a customer returns later
                than this threshold but before the reset window, the system sends the{" "}
                <code>SESSION_RESUME</code> template before re-engaging the AI.
              </li>
            </ul>

            <h3>WhatsApp</h3>
            <ul>
              <li>
                <code>wa.delay_min_seconds</code> / <code>wa.delay_max_seconds</code> —
                random "typing" delay range between outgoing messages so replies look
                human.
              </li>
              <li>
                <code>wa.outbound_per_minute_max</code> — hard cap on outbound rate per
                WhatsApp number. Going faster looks like spam to WhatsApp.
              </li>
              <li>
                <code>wa.warmup_mode</code> — turn on when pairing a brand-new
                WhatsApp number. Uses the gentler warmup-specific limits below.
              </li>
              <li>
                <code>wa.warmup_outbound_per_minute_max</code> (default <code>10</code>),{" "}
                <code>wa.warmup_delay_min_seconds</code>,{" "}
                <code>wa.warmup_delay_max_seconds</code> — reduced rate while WhatsApp
                builds trust on the new number. After week 1, bump the cap to 15–20
                and turn warmup mode off.
              </li>
            </ul>

            <h3>Manual queue</h3>
            <ul>
              <li>
                <code>manual_queue.sla_minutes</code> — items unresolved for longer get
                an amber / red SLA badge in the queue UI. Default 10.
              </li>
            </ul>

            <h3>Microsoft Teams (demo booking — optional)</h3>
            <ul>
              <li><code>microsoft.tenant_id</code> — Azure AD tenant GUID.</li>
              <li><code>microsoft.client_id</code> — Azure AD app registration client ID.</li>
              <li><code>microsoft.client_secret</code> (secret) — paired with client_id.</li>
              <li>
                <code>microsoft.organizer_user_id</code> — GUID of the demo host. Needs
                the <code>OnlineMeetings.ReadWrite.All</code> permission. Full
                walk-through is in <code>SETUP.md</code>.
              </li>
            </ul>

            <blockquote>
              <strong>Audit trail:</strong> every change to any of these settings is
              recorded in <code>/audit</code> with the user, timestamp, and the
              before/after values. See Section 18.
            </blockquote>
          </HelpSection>

          {/* ============ 7. KB ============ */}
          <HelpSection
            id="kb"
            number={7}
            title="Upload a knowledge base"
            roles={["Admin", "Manager"]}
          >
            <p>
              The AI only answers using context from a KB group linked to the campaign.
              Upload product FAQs, pricing sheets, policy docs as PDFs; the system
              extracts, chunks, embeds with pgvector, and indexes with HNSW.
            </p>

            <ol>
              <li>Open <strong>Knowledge Base</strong>.</li>
              <li>
                <strong>New group</strong> — name it after what's in it
                (<code>Product FAQ</code>, <code>Pricing</code>). Groups scope what
                each campaign can answer.
              </li>
              <li>
                <strong>Upload PDF</strong>. Watch the status:{" "}
                <code>PENDING</code> → <code>PROCESSING</code> → <code>READY</code>.
              </li>
              <li>
                Sanity-check the chunk count on the row — a 30-page PDF should produce
                dozens of chunks, not 1 or 2.
              </li>
            </ol>

            <HelpImage
              src="/help-images/kb-processing.png"
              caption="KB group with one PDF in PROCESSING and one in READY"
            />

            <blockquote>
              <strong>Tip:</strong> Re-upload after editing — the system deduplicates by
              content hash and replaces chunks atomically.
            </blockquote>
          </HelpSection>

          {/* ============ 8. TEMPLATES ============ */}
          <HelpSection
            id="templates"
            number={8}
            title="Create message templates"
            roles={["Manager"]}
          >
            <p>
              Five system template types drive every automatic message. Templates are
              also used by manual sends, bulk broadcasts, follow-ups, and automations —
              so editing one template propagates everywhere it's referenced.
            </p>

            <h3>System types</h3>
            <ul>
              <li><strong>ONBOARDING_DEFAULT</strong> — new opt-in greeting.</li>
              <li><strong>MANUAL_HANDOFF</strong> — sent when escalating to a human.</li>
              <li><strong>FALLBACK</strong> — low-confidence "I'm not sure".</li>
              <li><strong>SESSION_RESUME</strong> — returning customer after 24h.</li>
              <li><strong>DEMO_CONFIRMATION</strong> — after a Teams demo booking.</li>
            </ul>

            <p>
              Beyond these five, you can create <em>named templates</em> referenced by
              follow-up rules and automations (e.g. <code>soft_follow_up</code>,{" "}
              <code>price_quote</code>).
            </p>

            <ol>
              <li>Open <strong>Templates</strong> in the sidebar.</li>
              <li>
                Pick a type or create a named template. Write the body using
                placeholders like <code>{`{{firstName}}`}</code>,{" "}
                <code>{`{{company}}`}</code> — the editor lists the supported
                variables.
              </li>
              <li>Send yourself a test message to verify formatting.</li>
            </ol>

            <HelpImage
              src="/help-images/templates-editor.png"
              caption="Template editor with the FALLBACK message"
            />
          </HelpSection>

          {/* ============ 9. CONTACTS ============ */}
          <HelpSection
            id="contacts"
            number={9}
            title="Contacts"
            roles={["Manager", "Agent"]}
          >
            <p>
              The Contacts page is your single source of truth for who you talk to —
              every phone number, email, and company, deduplicated. Leads, chats, and
              broadcasts all point back to contacts here.
            </p>

            <h3>Day-to-day actions</h3>
            <ul>
              <li>
                <strong>Search</strong> by name, mobile, email, or company at the top.
              </li>
              <li>
                <strong>New contact</strong> — first/last name, mobile (E.164 without
                the <code>+</code>), email, company, location, source.
              </li>
              <li>
                <strong>Edit</strong> any field inline, including custom fields and
                city/state/country.
              </li>
              <li>
                <strong>Import</strong> from CSV / TSV / XLSX with column mapping —
                upload the file, map columns to fields, preview, confirm.
              </li>
              <li>
                <strong>Export</strong> the full list to CSV or XLSX for back-ups or
                hand-offs.
              </li>
              <li>
                <strong>Delete</strong> — soft delete. Existing leads keep their
                reference; the contact just stops appearing in lists.
              </li>
            </ul>

            <h3>The "leads / chats" column</h3>
            <p>
              Shows how many leads and how many chat sessions exist for that contact.
              Use it to spot duplicates before importing more.
            </p>

            <HelpImage
              src="/help-images/contacts-list.png"
              caption="Contacts list with the import / export bar and inline edit"
            />
          </HelpSection>

          {/* ============ 10. PIPELINE & LEADS ============ */}
          <HelpSection
            id="pipeline"
            number={10}
            title="Pipeline & leads"
            roles={["Manager", "Agent"]}
          >
            <p>
              The Pipeline is a Kanban board of <strong>leads</strong> grouped by{" "}
              <strong>stage</strong>. A lead is a deal-shaped link between a contact
              and a pipeline. You can have several pipelines (e.g. Enterprise vs SMB);
              switch between them with the dropdown at the top.
            </p>

            <h3>Working the board</h3>
            <ol>
              <li>
                Open <strong>Pipeline</strong> in the sidebar. Pick a pipeline from the
                dropdown.
              </li>
              <li>
                <strong>Drag a card</strong> between stage columns to move a lead
                forward (Prospect → Negotiation) or back. Updates are optimistic — the
                card moves instantly, then syncs.
              </li>
              <li>
                <strong>New lead</strong> — either pick an existing contact (search by
                name/mobile/email) or create one inline with company + mobile. Set the
                starting stage and expected value.
              </li>
              <li>
                <strong>Click any card</strong> to open the Lead Detail page (Section
                below).
              </li>
            </ol>

            <h3>What's on a card</h3>
            <ul>
              <li>Contact name and company</li>
              <li>
                <strong>Lead score badge</strong> — HOT / WARM / COLD / UNQUALIFIED, AI
                generated.
              </li>
              <li><strong>Expected value</strong> — deal size in currency.</li>
              <li>Assigned-to name.</li>
            </ul>

            <HelpImage
              src="/help-images/pipeline-board.png"
              caption="Pipeline Kanban — drag cards between stage columns"
            />

            <h3>Lead Detail page</h3>
            <p>
              Clicking a card opens <code>/leads/:leadId</code>. From here you can:
            </p>
            <ul>
              <li>
                <strong>Move stages</strong> by clicking the stage buttons in the left
                sidebar.
              </li>
              <li>
                Add <strong>notes</strong> (sticky-note style — agent-only context).
              </li>
              <li>
                Create <strong>tasks</strong> with optional due dates. Tick the icon to
                mark complete.
              </li>
              <li>
                Run <strong>Score now</strong> to re-run AI lead qualification (HOT /
                WARM / COLD / UNQUALIFIED + confidence %).
              </li>
              <li>
                Read the <strong>activity timeline</strong> — chronological feed of
                stage moves, assignments, notes, tasks, messages, and automation fires.
              </li>
              <li>
                Click any <strong>linked chat</strong> to jump straight into the
                conversation.
              </li>
            </ul>

            <HelpImage
              src="/help-images/lead-detail.png"
              caption="Lead Detail — stage picker, AI score, activity timeline, tasks"
            />
          </HelpSection>

          {/* ============ 11. OPT-IN CAMPAIGNS ============ */}
          <HelpSection
            id="campaigns"
            number={11}
            title="Opt-in campaigns"
            roles={["Manager"]}
          >
            <p>
              An opt-in campaign is a sales topic anchored by an UPPERCASE tag. When a
              customer texts the tag to your WhatsApp number, they opt in and the AI
              starts the conversation with the KB(s) linked to that campaign.
            </p>

            <ol>
              <li>Open <strong>Campaigns</strong>, click <strong>New</strong>.</li>
              <li>
                Fill the form:
                <ul>
                  <li><strong>Name</strong> — internal label (e.g. "Spring Product Launch").</li>
                  <li>
                    <strong>Tag</strong> — UPPERCASE, no spaces (e.g.{" "}
                    <code>SPRING</code>). The exact string customers send to opt in.
                  </li>
                  <li>
                    <strong>KB groups</strong> — one or more <code>READY</code> groups.
                  </li>
                  <li>
                    <strong>Expiry</strong> — optional cutoff for new opt-ins.
                  </li>
                  <li>
                    <strong>Onboarding message</strong> — optional. Blank uses{" "}
                    <code>ONBOARDING_DEFAULT</code>.
                  </li>
                  <li><strong>Active</strong> — toggle on.</li>
                </ul>
              </li>
              <li>
                Save. The page shows a shareable{" "}
                <code>https://wa.me/&lt;your-number&gt;?text=SPRING</code> link.
              </li>
            </ol>

            <HelpImage
              src="/help-images/campaigns-form.png"
              caption="Campaign creation form with KB groups linked"
            />
          </HelpSection>

          {/* ============ 12. BULK BROADCASTS ============ */}
          <HelpSection id="bulk" number={12} title="Bulk broadcasts" roles={["Manager"]}>
            <p>
              Send one message to many contacts at once, with safety rails: a daily
              cap, randomised delays between sends, and quiet hours so messages don't
              land at 3 AM.
            </p>

            <ol>
              <li>
                Open <strong>Bulk Broadcasts</strong>. Click <strong>New campaign</strong>{" "}
                — it saves as <code>DRAFT</code>.
              </li>
              <li>
                Fill in:
                <ul>
                  <li><strong>Name</strong> — internal label (e.g. "Diwali Promo Wave 2").</li>
                  <li>
                    <strong>Message body</strong> — supports template variables like{" "}
                    <code>{`{{firstName}}`}</code>, <code>{`{{company}}`}</code>.
                  </li>
                  <li>
                    <strong>Schedule at</strong> — date/time to begin. Leave blank to
                    start immediately on approval.
                  </li>
                  <li>
                    <strong>Daily limit</strong> (default 500) — max messages per day.
                  </li>
                  <li>
                    <strong>Delay min/max</strong> (default 30–60s) — random jitter
                    between sends so it doesn't look robotic.
                  </li>
                  <li>
                    <strong>Quiet hours</strong> (HH:MM, optional) — pause sends inside
                    this window.
                  </li>
                  <li>
                    <strong>Skip if replied within</strong> (hours, optional) — don't
                    re-send to contacts who messaged back recently.
                  </li>
                </ul>
              </li>
              <li>
                <strong>Add recipients</strong> — filter contacts by name, mobile,
                email, company, source. The audience is frozen as a snapshot when you
                save, so contacts added later aren't auto-included.
              </li>
              <li>
                <strong>Preview</strong> shows the message rendered with one
                recipient's variables.
              </li>
              <li>
                <strong>Schedule</strong> or <strong>Send now</strong>. The drip
                scheduler enqueues batches respecting all your safety knobs.
              </li>
              <li>
                Watch real-time analytics: <code>pending → queued → sent → delivered</code>{" "}
                (or <code>failed</code>), plus reply counts.
              </li>
              <li>
                <strong>Pause</strong> a running campaign any time — resumes from where
                it left off. <strong>Cancel</strong> stops further sends; what's
                already sent stays sent.
              </li>
            </ol>

            <h3>Campaign statuses</h3>
            <ul>
              <li><code>DRAFT</code> — still being edited.</li>
              <li><code>PENDING_APPROVAL</code> — waiting on admin review (optional).</li>
              <li><code>SCHEDULED</code> — approved, waiting for the start time.</li>
              <li><code>RUNNING</code> — actively sending.</li>
              <li><code>PAUSED</code> — temporarily halted, can resume.</li>
              <li><code>COMPLETED</code> — every recipient resolved.</li>
              <li><code>CANCELLED</code> — operator-stopped permanently.</li>
            </ul>

            <HelpImage
              src="/help-images/bulk-campaigns.png"
              caption="Bulk broadcast with audience filters, schedule, and live stats"
            />
          </HelpSection>

          {/* ============ 13. FOLLOW-UPS ============ */}
          <HelpSection
            id="followups"
            number={13}
            title="Auto follow-ups"
            roles={["Manager"]}
          >
            <p>
              Follow-up rules nudge a lead automatically after they've been silent. Set
              once, and the scheduler fires reminders until either the customer replies
              or the per-lead cap is reached.
            </p>

            <ol>
              <li>Open <strong>Follow-ups</strong>. Click <strong>New rule</strong>.</li>
              <li>
                Fill in:
                <ul>
                  <li><strong>Name</strong> — e.g. "24h reminder for Qualified leads".</li>
                  <li>
                    <strong>Pipeline</strong> (optional) — scope the rule to one
                    pipeline. Blank = all.
                  </li>
                  <li>
                    <strong>Stage</strong> (optional) — narrow further to a specific
                    stage. Requires a pipeline.
                  </li>
                  <li>
                    <strong>Template</strong> — the named template to send (e.g.{" "}
                    <code>soft_follow_up</code>).
                  </li>
                  <li>
                    <strong>Idle threshold</strong> (hours) — fires when{" "}
                    <code>lastMessageAt</code> is older than this. Any direction —
                    inbound or outbound — resets the clock.
                  </li>
                  <li>
                    <strong>Max reminders per lead</strong> (default 1) — lifetime cap
                    so you never spam.
                  </li>
                  <li>
                    <strong>Quiet hours</strong> — suppress fires inside this window.
                  </li>
                  <li><strong>Active</strong> — pause without deleting.</li>
                </ul>
              </li>
              <li>
                Save. Watch the <strong>Recent fires</strong> table (last 20) to audit
                what the system sent and to whom.
              </li>
            </ol>

            <p>
              Deleting a rule stops future fires; past sends stay in the log for audit.
            </p>

            <HelpImage
              src="/help-images/followups.png"
              caption="Follow-up rules list with recent fire history below"
            />
          </HelpSection>

          {/* ============ 14. AUTOMATIONS ============ */}
          <HelpSection
            id="automations"
            number={14}
            title="Automations"
            roles={["Admin"]}
          >
            <p>
              Automations are multi-step workflows that run when something happens — a
              new lead arrives, a stage changes, an owner is assigned, or a follow-up
              window expires. Think of them as recipes the system runs unattended.
            </p>

            <h3>Triggers</h3>
            <ul>
              <li><code>NEW_LEAD</code> — a lead is created.</li>
              <li><code>STAGE_CHANGED</code> — a lead moves to a new stage.</li>
              <li><code>LEAD_ASSIGNED</code> — a lead's owner changes.</li>
              <li><code>NO_REPLY</code> — a lead has been silent past an idle window.</li>
            </ul>

            <h3>Step types</h3>
            <ul>
              <li><code>WAIT</code> — pause for N seconds / minutes / hours.</li>
              <li><code>SEND_MESSAGE</code> — render a named template and send.</li>
              <li><code>ASSIGN</code> — assign the lead to a user.</li>
              <li><code>ADD_TAG</code> — apply a tag to the contact.</li>
              <li><code>MOVE_STAGE</code> — move the lead to a different stage.</li>
              <li><code>CREATE_TASK</code> — generate a task with optional due date.</li>
              <li><code>IF</code> — guard a branch with <code>no_reply:hours</code>, <code>has_tag:tagId</code>, or <code>stage_is:stageId</code>.</li>
            </ul>

            <ol>
              <li>Open <strong>Automations</strong>.</li>
              <li>
                <strong>New automation</strong> — name it, pick a trigger, optionally
                add a trigger filter as JSON (e.g.{" "}
                <code>{`{"toStageId":"xyz"}`}</code> to only fire on a specific stage
                transition).
              </li>
              <li>
                Write the <strong>definition</strong> — a JSON array of steps. Example:
                <pre><code>{`[
  { "type": "WAIT", "minutes": 30 },
  { "type": "IF", "no_reply": 24 },
  { "type": "SEND_MESSAGE", "template": "soft_follow_up" },
  { "type": "ASSIGN", "userEmail": "alex@acme.com" }
]`}</code></pre>
              </li>
              <li>Toggle <strong>Listening for events</strong> on, save.</li>
              <li>
                Check the <strong>Recent runs</strong> table — each run shows status
                (<code>PENDING</code>, <code>RUNNING</code>, <code>WAITING</code>,{" "}
                <code>DONE</code>, <code>FAILED</code>, <code>CANCELLED</code>) and
                which step it's on.
              </li>
            </ol>

            <HelpImage
              src="/help-images/automations.png"
              caption="Automation editor with trigger, JSON definition, and run history"
            />

            <blockquote>
              <strong>Tip:</strong> Start with a single-step automation (send one
              message on NEW_LEAD) and grow from there. Failed runs surface in the run
              table with the step and error — usually a typo in a template name.
            </blockquote>
          </HelpSection>

          {/* ============ 15. INBOX ============ */}
          <HelpSection id="inbox" number={15} title="Day-to-day inbox" roles={["Agent"]}>
            <p>
              The Inbox is where agents spend their day. Every customer conversation —
              from any channel — appears here, filterable by state, tag, campaign, and
              channel.
            </p>

            <h3>Session states</h3>
            <ul>
              <li><code>NEW</code> — just opted in, no replies yet.</li>
              <li><code>ACTIVE</code> — AI is handling it.</li>
              <li><code>PAUSED</code> — AI silenced, no automated replies will go out.</li>
              <li><code>MANUAL</code> — agent has taken over.</li>
              <li><code>CLOSED</code> — resolved, archived.</li>
            </ul>

            <HelpImage
              src="/help-images/inbox-list.png"
              caption="Inbox filtered to ACTIVE sessions on the SPRING campaign"
            />

            <h3>Inside a chat</h3>
            <ol>
              <li>Click any row to open <code>/chats/:chatId</code>.</li>
              <li>
                Messages colour-coded by source: <code>CUSTOMER</code>, <code>AI</code>,
                <code>AGENT</code>, <code>SYSTEM</code>. Hover for AI confidence
                scores.
              </li>
              <li>
                Type in the reply panel to send an <code>AGENT</code> message —
                automatically flips the session to <code>MANUAL</code>.
              </li>
              <li>
                Use the state dropdown to <strong>Pause AI</strong>,{" "}
                <strong>Take over</strong>, or <strong>Close</strong>.
              </li>
              <li>
                Use the session switcher to jump between past sessions with the same
                customer.
              </li>
            </ol>

            <HelpImage
              src="/help-images/chat-view.png"
              caption="Chat view with AI, agent, and customer messages interleaved"
            />
          </HelpSection>

          {/* ============ 16. QUEUE ============ */}
          <HelpSection id="queue" number={16} title="Manual queue" roles={["Agent"]}>
            <p>
              The manual queue is the agent worklist — conversations the system has
              decided need a human. Each item shows the reason and how long it's been
              waiting.
            </p>

            <h3>What pushes a session into the queue</h3>
            <ul>
              <li><strong>Low confidence</strong> — the AI's answer scored below the threshold.</li>
              <li><strong>Reply cap reached</strong> — 10 AI replies in one session.</li>
              <li><strong>Explicit handoff</strong> — the AI detected escalation intent ("speak to a human").</li>
            </ul>

            <ol>
              <li>Open <strong>Manual Queue</strong>.</li>
              <li>
                Rows highlighted amber/red are past the SLA threshold (default 10 min).
                Work these first.
              </li>
              <li>
                Click <strong>Open chat</strong> to claim and jump in. An agent reply
                automatically clears the queue item.
              </li>
            </ol>

            <HelpImage
              src="/help-images/manual-queue.png"
              caption="Manual queue with one item past SLA"
            />
          </HelpSection>

          {/* ============ 17. TAGS / NOTES / DEMO ============ */}
          <HelpSection
            id="tags-notes"
            number={17}
            title="Tags, notes & demo booking"
            roles={["Agent"]}
          >
            <h3>Tags</h3>
            <p>
              Tags are colour-coded labels you attach to customers / chats to segment
              them — <code>vip</code>, <code>pricing-question</code>,{" "}
              <code>follow-up-friday</code>. Used everywhere: inbox filter, follow-up
              rule scope, automation IF conditions.
            </p>
            <ol>
              <li>Open <strong>Tags</strong> in the sidebar.</li>
              <li>
                <strong>New tag</strong> — type a name, pick a colour from the preset
                palette (cyan, green, amber, red, purple, slate, or none).
              </li>
              <li>Save. The tag is now applyable from any chat or lead-detail page.</li>
              <li>
                The <strong>Chats</strong> column shows how many conversations
                currently carry the tag — use it to retire unused tags.
              </li>
              <li>
                Deleting a tag removes it from every chat instantly (the chats
                themselves stay).
              </li>
            </ol>

            <HelpImage
              src="/help-images/tags.png"
              caption="Tags page — palette picker and per-tag chat count"
            />

            <h3>Notes</h3>
            <p>
              Free-form per-customer notes live next to the chat (and on lead detail).
              Agent-only — the customer never sees them.
            </p>

            <h3>Booking a demo</h3>
            <ol>
              <li>
                In a chat, click <strong>Book demo</strong> in the toolbar (enabled
                only if Microsoft Teams integration is configured — see{" "}
                <code>SETUP.md</code>).
              </li>
              <li>
                Pick a time slot. The system creates a Teams meeting and sends a{" "}
                <code>DEMO_CONFIRMATION</code> message.
              </li>
              <li>The booking appears under "Demo bookings" in Analytics.</li>
            </ol>
          </HelpSection>

          {/* ============ 18. ANALYTICS / AUDIT ============ */}
          <HelpSection
            id="analytics"
            number={18}
            title="Analytics & audit"
            roles={["Manager", "Admin"]}
          >
            <h3>Analytics</h3>
            <ol>
              <li>Open <strong>Analytics</strong>.</li>
              <li>Pick a period — <code>24h</code>, <code>7d</code>, <code>30d</code>, <code>all</code>.</li>
              <li>
                Per-campaign rollups: sessions started, AI-vs-manual reply split,
                average confidence, demo bookings. Pipeline-side: leads created, won
                value, conversion rate by stage.
              </li>
              <li>
                Spot degrading campaigns (low confidence + high manual share = KB
                doesn't cover what customers ask).
              </li>
            </ol>

            <HelpImage
              src="/help-images/analytics.png"
              caption="Analytics — 7-day rollup, AI vs manual share per campaign"
            />

            <h3>Audit log</h3>
            <p>
              <code>/audit</code> (admin-only) records every settings change with
              timestamp, setting key, the previous value, the new value, and who did
              it (user email or <code>system</code> for automated changes like seed
              scripts).
            </p>
            <ol>
              <li>Open <strong>Audit Log</strong> in the sidebar.</li>
              <li>
                Filter by key — type e.g. <code>ai.provider</code> or{" "}
                <code>ai.confidence_threshold</code> and click <strong>Apply</strong>{" "}
                to see only that setting's history. <strong>Clear</strong> resets.
              </li>
              <li>
                Use it to answer "why did behaviour change on Tuesday?" — the row
                names the user and shows the exact before / after.
              </li>
            </ol>

            <HelpImage
              src="/help-images/audit-log.png"
              caption="Audit log filtered to ai.confidence_threshold changes"
            />
          </HelpSection>

          {/* ============ 19. HEALTH ============ */}
          <HelpSection
            id="health"
            number={19}
            title="Health & system status"
            roles={["Admin"]}
          >
            <p>
              The Health page is the ops cockpit. Top of the page shows the overall
              status — <code>OK</code> / <code>DEGRADED</code> / <code>DOWN</code> —
              with a timestamp. Below it, one card per critical component.
            </p>

            <h3>Components checked</h3>
            <ul>
              <li><strong>Database</strong> — Postgres connectivity, schema version, latency.</li>
              <li><strong>Redis</strong> — pub/sub + BullMQ queue backbone.</li>
              <li>
                <strong>WhatsApp worker</strong> — current state
                (<code>BOOTING</code> / <code>READY</code> / etc.), heartbeat age, last
                error if any.
              </li>
              <li>
                <strong>AI provider</strong> — last successful call timestamp, recent
                error count, expired-key detection.
              </li>
            </ul>

            <p>
              Each card carries a status dot, the last heartbeat (seconds since the
              last ping), the version where applicable, and an error string when
              something is wrong. Click <strong>Refresh</strong> for an immediate
              re-check.
            </p>

            <h3>When to use it</h3>
            <ul>
              <li>
                The Dashboard WhatsApp card flipped red → Health usually surfaces the
                actual reason (worker crashed, Chromium failed to launch, etc.).
              </li>
              <li>
                AI replies have stopped → Health will show a provider error or an
                expired API key.
              </li>
              <li>
                During an incident → screenshot this page for the post-mortem.
              </li>
            </ul>

            <HelpImage
              src="/help-images/health.png"
              caption="Health page — overall OK, all four component cards green"
            />
          </HelpSection>

          {/* ============ 20. TROUBLESHOOTING ============ */}
          <HelpSection
            id="troubleshooting"
            number={20}
            title="Troubleshooting"
            roles={["All"]}
          >
            <h3>WhatsApp won't connect</h3>
            <ul>
              <li>Stuck on <code>BOOTING</code>: the WhatsApp worker isn't running. Restart it.</li>
              <li>Flips to <code>AUTH_FAILURE</code>: linked devices revoked on the phone. Logout → restart worker → re-scan.</li>
              <li>No QR at all: check worker logs — Chromium often fails to launch with no GUI or missing sandbox flags on Linux.</li>
            </ul>

            <h3>Meta channel (IG / Messenger) not receiving messages</h3>
            <ul>
              <li>Confirm the webhook URL in Meta Business Settings exactly matches the one shown on the Channels page.</li>
              <li>Verify Token must match what you typed in the channel form.</li>
              <li>Page Access Token must have <code>pages_messaging</code> and <code>instagram_basic</code> permissions.</li>
            </ul>

            <h3>Website widget doesn't appear</h3>
            <ul>
              <li>Check the page's URL is in the integration's allowed domains list.</li>
              <li>Open the browser console — a 403 from <code>/widget.js</code> means the API key is invalid or rotated.</li>
              <li>Rate-limit hits will return 429 — increase the limit if traffic is genuine.</li>
            </ul>

            <h3>AI keeps falling back / "I'm not sure"</h3>
            <ul>
              <li>Confidence threshold may be too high — lower it in Settings.</li>
              <li>KB doesn't cover what customers ask. Look at FALLBACK sessions and add a doc.</li>
              <li>KB linked to the wrong campaign — verify on Campaigns.</li>
            </ul>

            <h3>KB document stuck on PROCESSING</h3>
            <ul>
              <li>Queue worker not running. Restart it.</li>
              <li>Check Bull-Board (System → Bull-Board) for failed jobs in <code>pdf-processing</code> and retry.</li>
              <li>Image-only (scanned) PDFs won't extract — OCR first.</li>
            </ul>

            <h3>Bulk broadcast won't start</h3>
            <ul>
              <li>Status is <code>PENDING_APPROVAL</code> — an admin needs to approve.</li>
              <li>Status is <code>SCHEDULED</code> — the start time hasn't arrived.</li>
              <li>Quiet hours are active right now — wait or adjust.</li>
            </ul>

            <h3>Automation never fires</h3>
            <ul>
              <li><strong>Listening for events</strong> toggle is off.</li>
              <li>Trigger filter JSON is too narrow — try removing the filter to confirm.</li>
              <li>Template name in <code>SEND_MESSAGE</code> doesn't match anything in Templates.</li>
              <li>Check Recent runs — failures show the step + error.</li>
            </ul>

            <h3>Follow-up not firing</h3>
            <ul>
              <li>Rule is inactive.</li>
              <li>Max reminders already hit for that lead.</li>
              <li>Currently inside quiet hours.</li>
              <li>Lead doesn't match pipeline / stage scope.</li>
            </ul>

            <h3>Where are the logs?</h3>
            <ul>
              <li>API: stdout of <code>backend npm run dev</code>.</li>
              <li>WhatsApp worker: stdout of <code>npm run wa</code>.</li>
              <li>Background jobs: <code>npm run worker</code>, or the Bull-Board UI.</li>
              <li>Production with PM2: <code>pm2 logs</code>.</li>
            </ul>
          </HelpSection>

          {/* ============ 21. GLOSSARY ============ */}
          <HelpSection id="glossary" number={21} title="Glossary" roles={["All"]}>
            <ul>
              <li><strong>Contact</strong> — a person (phone, email, company) in your CRM.</li>
              <li><strong>Lead</strong> — a deal record linking a contact to a pipeline + stage.</li>
              <li><strong>Pipeline</strong> — a series of sales stages.</li>
              <li><strong>Stage</strong> — a step in the pipeline (Prospect, Qualified, Negotiation, Won, Lost).</li>
              <li><strong>Lead score</strong> — AI-generated HOT / WARM / COLD / UNQUALIFIED.</li>
              <li><strong>Expected value</strong> — deal size; drives revenue forecasting.</li>
              <li><strong>Source</strong> — where a contact came from (import, website widget, manual, …).</li>
              <li><strong>Channel</strong> — WhatsApp, Web Chat, Instagram, Facebook Messenger.</li>
              <li><strong>Session</strong> — one continuous conversation; auto-resets after 7 days idle.</li>
              <li><strong>Campaign</strong> — opt-in topic anchored by an UPPERCASE tag.</li>
              <li><strong>Bulk broadcast</strong> — one-to-many outbound send with throttling.</li>
              <li><strong>Follow-up rule</strong> — auto-reminder when a lead is silent past N hours.</li>
              <li><strong>Automation</strong> — multi-step event-driven workflow.</li>
              <li><strong>Trigger</strong> — the event that starts an automation (NEW_LEAD, STAGE_CHANGED, LEAD_ASSIGNED, NO_REPLY).</li>
              <li><strong>Step</strong> — one action inside an automation (WAIT, SEND_MESSAGE, ASSIGN, …).</li>
              <li><strong>KB group</strong> — bundle of PDFs the AI grounds answers in.</li>
              <li><strong>Chunk</strong> — 200–500-token slice of a PDF, embedded for retrieval.</li>
              <li><strong>Confidence</strong> — 0–1 self-score on an AI answer.</li>
              <li><strong>Manual queue</strong> — agent worklist of conversations needing a human.</li>
              <li><strong>Template</strong> — pre-written message body.</li>
              <li><strong>Source / message source</strong> — who sent a message: <code>CUSTOMER</code>, <code>AI</code>, <code>AGENT</code>, <code>SYSTEM</code>.</li>
              <li><strong>Webhook</strong> — URL Meta/external systems POST events to.</li>
              <li><strong>API key</strong> — credential for the website widget (<code>site_…</code> prefix).</li>
              <li><strong>Audience snapshot</strong> — frozen recipient list of a bulk campaign.</li>
              <li><strong>Global AI switch</strong> — Dashboard kill switch silencing all automation at once.</li>
            </ul>
          </HelpSection>

          {/* Footer */}
          <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
            <p>
              More detail in the repository docs: <code>README.md</code>,{" "}
              <code>SETUP.md</code>, <code>OPS.md</code>, <code>AI_PROVIDERS.md</code>.
            </p>
            <p className="mt-1">
              SalesAutomation user guide · generated {lastUpdated}
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
