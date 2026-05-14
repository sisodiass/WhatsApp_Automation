// One-shot, idempotent backfill: turn every existing Chat into a CRM
// Contact (keyed on E.164 phone) and write the soft FK chats.contact_id.
//
// Safe to re-run — uses upsert and only updates chats with NULL contact_id.
// Run with:  node prisma/backfill-contacts.js
//
// Batch size of 500 keeps the transaction small enough to not interfere
// with the live API. New chats created after this script runs are linked
// by the inbound worker's hook in session.service.upsertChat (see M1).

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config();

const prisma = new PrismaClient();
const BATCH = 500;

// Splits a single displayName like "Alice" / "Alice Smith" / "Alice von Brandt"
// into firstName + lastName best-effort. Falls back to both null when the
// chat never had a display name.
function splitName(name) {
  if (!name) return { firstName: null, lastName: null };
  const trimmed = name.trim();
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function backfill() {
  let cursor = null;
  let createdContacts = 0;
  let linkedChats = 0;
  let skipped = 0;
  let totalSeen = 0;

  while (true) {
    const chats = await prisma.chat.findMany({
      where: { contactId: null },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        tenantId: true,
        phone: true,
        displayName: true,
      },
    });
    if (chats.length === 0) break;
    totalSeen += chats.length;

    await prisma.$transaction(async (tx) => {
      for (const chat of chats) {
        if (!chat.phone) {
          skipped += 1;
          continue;
        }
        const { firstName, lastName } = splitName(chat.displayName);

        // Upsert by (tenantId, mobile). If a Contact already exists we
        // leave its name fields alone — operator-edited values trump the
        // chat's notify name. We only update name if the contact's name
        // fields are entirely empty (first time we've seen this person).
        const existing = await tx.contact.findUnique({
          where: { tenantId_mobile: { tenantId: chat.tenantId, mobile: chat.phone } },
          select: { id: true, firstName: true, lastName: true },
        });

        let contactId;
        if (existing) {
          contactId = existing.id;
          if (!existing.firstName && !existing.lastName && (firstName || lastName)) {
            await tx.contact.update({
              where: { id: existing.id },
              data: { firstName, lastName },
            });
          }
        } else {
          const created = await tx.contact.create({
            data: {
              tenantId: chat.tenantId,
              mobile: chat.phone,
              firstName,
              lastName,
              source: "backfill",
            },
            select: { id: true },
          });
          contactId = created.id;
          createdContacts += 1;
        }

        await tx.chat.update({
          where: { id: chat.id },
          data: { contactId },
        });
        linkedChats += 1;
      }
    });

    cursor = chats[chats.length - 1].id;
    console.log(`… processed ${totalSeen} chats (linked ${linkedChats}, new contacts ${createdContacts}, skipped ${skipped})`);
  }

  console.log("");
  console.log("═══ Backfill complete ═══");
  console.log(`  Chats scanned:    ${totalSeen}`);
  console.log(`  Chats linked:     ${linkedChats}`);
  console.log(`  Contacts created: ${createdContacts}`);
  console.log(`  Skipped:          ${skipped}`);
}

backfill()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
