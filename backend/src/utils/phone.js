// whatsapp-web.js gives us either:
//   - "919999999999@c.us"  — classic phone-number jid
//   - "167250388615354@lid" — newer LID (Linked Identifier) used by
//     accounts that opted into WhatsApp's privacy-first identifier system
//
// Routing layer: keep the original JID — sending to a LID-only contact
// requires the @lid suffix and stripping it would break delivery.
// CRM display layer: a LID's numeric part is NOT a phone number; we
// detect it via isLidJid() and the UI renders such contacts as
// "(private)" instead of showing the meaningless 15-digit synthetic id.
// Group chats use "@g.us" — we don't support groups in v1.

const LID_SUFFIX = "@lid";

export function fromWaJid(jid) {
  if (!jid) return null;
  if (jid.endsWith("@g.us")) return null; // ignore groups
  return jid.replace(/@c\.us$/, "");
}

export function toWaJid(phone) {
  if (!phone) return null;
  if (phone.includes("@")) return phone; // already has a suffix (e.g. @lid)
  return `${phone}@c.us`;
}

/**
 * True if the given string is a WhatsApp Linked-Identifier rather than
 * a real phone number. Used to flag contacts whose real phone we
 * couldn't resolve, so the UI can render them as private instead of
 * displaying the synthetic 15-digit number.
 */
export function isLidJid(value) {
  if (!value) return false;
  return String(value).endsWith(LID_SUFFIX);
}

/**
 * Normalize a possibly-LID identifier for use as a display "mobile".
 * Real phones are returned as-is (digits, optional + prefix). LIDs are
 * returned unchanged — the caller is expected to use isLidJid() to
 * decide rendering. We deliberately do NOT strip @lid because the
 * suffix is the marker the rest of the app uses.
 */
export function normalizeMobile(value) {
  if (!value) return null;
  return String(value).trim();
}
