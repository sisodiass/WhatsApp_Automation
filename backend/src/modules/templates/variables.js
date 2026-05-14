// Variable registry + context builders for the template engine.
//
// Two responsibilities:
//   1. Spec — what variables exist, what each one means, what the
//      autocomplete UI displays. Source of truth for the frontend.
//   2. Builders — given a lead/contact/extras, return the {key: value}
//      object that interpolate() consumes.
//
// Date/time variables are always available; lead-aware variables resolve
// to "" when no lead context is passed. Missing keys are intentionally
// preserved verbatim by interpolate() so operators spot gaps.

import { format as dfFormat } from "date-fns";
import { prisma } from "../../shared/prisma.js";

// ─── Format pipe support ─────────────────────────────────────────────
// Operator writes `{{current_date|DD/MM/YYYY}}`. We accept Moment-style
// tokens for ergonomics, normalize to date-fns tokens, and fall back to
// the raw token string on failure.

const TOKEN_MAP = [
  // Order matters — longer tokens first so YYYY isn't munged to "y" + y + y + y.
  [/YYYY/g, "yyyy"],
  [/YY/g, "yy"],
  [/DD/g, "dd"],
  [/(?<![DdMm])D(?!D)/g, "d"], // bare D → d (day of month, no leading zero)
  // date-fns uses lowercase `a` for AM/PM (output: "AM"/"PM"); Moment uses
  // uppercase A. Swap before formatting so {{current_time|hh:mm A}} works.
  [/A/g, "a"],
  // hh / HH / mm / MM / ss all match between Moment + date-fns
];

function toDfTokens(format) {
  let out = format;
  for (const [re, rep] of TOKEN_MAP) out = out.replace(re, rep);
  return out;
}

// Whitelist of "common" formats — these always render correctly without
// touching the generic mapper. Anything else falls through to toDfTokens().
const COMMON_FORMATS = new Set([
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
  "D MMM YYYY",
  "DD MMM YYYY",
  "hh:mm A",
  "HH:mm",
  "hh:mm:ss A",
  "HH:mm:ss",
]);

function tryFormatDate(date, format) {
  try {
    return dfFormat(date, COMMON_FORMATS.has(format) ? toDfTokens(format) : toDfTokens(format));
  } catch {
    return null;
  }
}

// Default rendering when no format pipe is provided on a date var.
const DEFAULT_DATE_FORMAT = {
  current_date: "D MMM YYYY",
  current_time: "hh:mm A",
  current_datetime: "D MMM YYYY hh:mm A",
  meeting_date: "D MMM YYYY",
  meeting_time: "hh:mm A",
  followup_date: "D MMM YYYY",
};

export function applyFormat(value, format, key) {
  // Date or ISO string → date-fns format
  let date = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) date = d;
  }
  if (date) {
    const fmt = format || DEFAULT_DATE_FORMAT[key];
    if (fmt) {
      const out = tryFormatDate(date, fmt);
      if (out !== null) return out;
    }
    return date.toISOString();
  }
  return String(value);
}

// ─── Variable spec — drives the autocomplete UI ─────────────────────

export const VARIABLE_SPEC = {
  groups: [
    {
      name: "Contact",
      variables: [
        { name: "name",        description: "Full name (first + last)",       sample: "Alice Smith" },
        { name: "first_name",  description: "First name",                     sample: "Alice" },
        { name: "last_name",   description: "Last name",                      sample: "Smith" },
        { name: "mobile",      description: "Mobile number (E.164)",          sample: "919999999999" },
        { name: "email",       description: "Email address",                  sample: "alice@example.com" },
        { name: "company",     description: "Company name",                   sample: "Acme Inc" },
        { name: "city",        description: "City",                           sample: "Mumbai" },
        { name: "state",       description: "State",                          sample: "Maharashtra" },
        { name: "country",     description: "Country",                        sample: "India" },
      ],
    },
    {
      name: "Lead",
      variables: [
        { name: "lead_source",     description: "Lead source",            sample: "webform" },
        { name: "lead_stage",      description: "Current pipeline stage", sample: "Qualified" },
        { name: "lead_status",     description: "Alias for lead stage",   sample: "Qualified" },
        { name: "assigned_agent",  description: "Assigned agent name",    sample: "Priya Reddy" },
        { name: "expected_value",  description: "Expected deal value",    sample: "12,000" },
        { name: "currency",        description: "Currency code",          sample: "INR" },
        { name: "campaign_name",   description: "Inbound campaign name",  sample: "Diwali Promo" },
      ],
    },
    {
      name: "Date & time",
      variables: [
        { name: "current_date",     description: "Today's date",     sample: "12 May 2026", formats: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "D MMM YYYY"] },
        { name: "current_time",     description: "Current time",     sample: "08:45 PM",    formats: ["hh:mm A", "HH:mm"] },
        { name: "current_datetime", description: "Date + time",      sample: "12 May 2026 08:45 PM" },
        { name: "current_day",      description: "Day of week",      sample: "Tuesday" },
        { name: "current_month",    description: "Month name",       sample: "May" },
        { name: "current_year",     description: "Year",             sample: "2026" },
      ],
    },
    {
      name: "Scheduling",
      variables: [
        { name: "meeting_date",  description: "Meeting date (from booking context)", sample: "15 May 2026" },
        { name: "meeting_time",  description: "Meeting time",                         sample: "10:30 AM" },
        { name: "followup_date", description: "Next scheduled follow-up date",        sample: "14 May 2026" },
      ],
    },
  ],
};

export function listVariables() {
  return VARIABLE_SPEC;
}

// ─── Context builders ────────────────────────────────────────────────

export function buildStandardVars(now = new Date()) {
  return {
    current_date: now,
    current_time: now,
    current_datetime: now,
    current_day: dfFormat(now, "EEEE"),
    current_month: dfFormat(now, "MMMM"),
    current_year: String(now.getFullYear()),
  };
}

function fullName(c) {
  const n = [c?.firstName, c?.lastName].filter(Boolean).join(" ");
  return n || c?.mobile || "";
}

export function buildContactVars(contact) {
  if (!contact) return {};
  return {
    name: fullName(contact),
    first_name: contact.firstName ?? "",
    last_name: contact.lastName ?? "",
    mobile: contact.mobile ?? "",
    email: contact.email ?? "",
    company: contact.company ?? "",
    city: contact.city ?? "",
    state: contact.state ?? "",
    country: contact.country ?? "",
  };
}

export async function buildVarsForContact(contactId, tenantId, extras = {}) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId, deletedAt: null },
  });
  return { ...buildStandardVars(), ...buildContactVars(contact), ...extras };
}

export async function buildVarsForLead(leadId, tenantId, extras = {}) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      contact: true,
      stage: true,
      pipeline: true,
      assignedTo: { select: { name: true, email: true } },
    },
  });
  if (!lead) return { ...buildStandardVars(), ...extras };
  return {
    ...buildStandardVars(),
    ...buildContactVars(lead.contact),
    lead_source: lead.source ?? "",
    lead_stage: lead.stage?.name ?? "",
    lead_status: lead.stage?.name ?? "",
    assigned_agent: lead.assignedTo?.name ?? "",
    expected_value: lead.expectedValue ? String(lead.expectedValue) : "",
    currency: lead.currency ?? "",
    ...extras,
  };
}

// Sample vars used when previewing a template without a real contact/lead.
// Pulled from the spec so the preview UI matches what autocomplete shows.
export function buildSampleVars() {
  const out = { ...buildStandardVars() };
  for (const group of VARIABLE_SPEC.groups) {
    for (const v of group.variables) {
      if (out[v.name] === undefined && v.sample !== undefined) {
        out[v.name] = v.sample;
      }
    }
  }
  return out;
}
