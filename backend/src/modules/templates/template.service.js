import { prisma } from "../../shared/prisma.js";
import { applyFormat, buildStandardVars } from "./variables.js";

// Replaces {{var}} and {{var|format}} placeholders with values from `vars`.
// Missing keys are left as-is so the operator can spot them in the message
// body. Standard variables (date/time) are always available — callers
// don't need to populate them.
//
// Syntax:
//   {{name}}                       — simple substitution
//   {{current_date|DD/MM/YYYY}}    — pipe-format (Moment-style tokens)
//   {{ name }}                     — whitespace tolerated
export function interpolate(content, vars = {}) {
  const merged = { ...buildStandardVars(), ...vars };
  return content.replace(
    /\{\{\s*([\w.]+)\s*(?:\|\s*([^}]+?))?\s*\}\}/g,
    (match, key, format) => {
      const v = merged[key];
      if (v === undefined || v === null) return match;
      if (format) return applyFormat(v, format.trim(), key);
      // No explicit format pipe — applyFormat falls back to per-key defaults
      // (e.g. current_date renders as "12 May 2026", not an ISO string).
      return applyFormat(v, null, key);
    },
  );
}

// Fetches the active template of the given type for a tenant.
// Returns the *content* string with optional variable interpolation, or null
// if no active template of that type exists.
export async function renderTemplate(tenantId, type, vars = {}) {
  const tpl = await prisma.messageTemplate.findFirst({
    where: { tenantId, type, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!tpl) return null;
  return interpolate(tpl.content, vars);
}
