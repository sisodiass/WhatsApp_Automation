// whatsapp-web.js gives us either:
//   - "919999999999@c.us"  — classic phone-number jid
//   - "167250388615354@lid" — newer LID (Linked Identifier) used by
//     accounts that opted into WhatsApp's privacy-first identifier system
//
// We strip @c.us for cleanliness on phone-number jids, but preserve
// @lid intact — sending to a LID-only contact requires the @lid suffix.
// Group chats use "@g.us" — we don't support groups in v1.

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
