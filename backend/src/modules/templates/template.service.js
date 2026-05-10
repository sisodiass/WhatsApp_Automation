import { prisma } from "../../shared/prisma.js";

// Replaces {{var}} placeholders with values from `vars`. Missing keys are
// left as-is so the operator can spot them in the message body.
export function interpolate(content, vars = {}) {
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? `{{${key}}}` : String(v);
  });
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
