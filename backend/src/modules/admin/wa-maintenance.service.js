// Operator-triggered maintenance jobs for WhatsApp.
//
// refreshLidContacts(): walks the tenant's Contact rows whose mobile
// still ends with @lid (i.e., we never resolved a real phone for
// them — typically rows created before the M11 LID fix landed), asks
// the wa-worker for the current contact info via getContactById, and
// updates the row when a better number or push-name is found.
//
// Bounded: processes up to MAX_PER_RUN rows per call, rate-limited at
// ~5 queries/sec to avoid hammering the WA worker. Resumable — calling
// again picks up where the previous run left off (no cursor state
// needed; the WHERE clause keeps the candidate set).
//
// SUPER_ADMIN only at the route layer.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { queryContact } from "../whatsapp/contact-query.js";

const log = child("wa-maintenance");

const MAX_PER_RUN = 50;
const DELAY_BETWEEN_QUERIES_MS = 200;

export async function refreshLidContacts(tenantId, opts = {}) {
  const limit = Math.min(MAX_PER_RUN, Math.max(1, Number(opts.limit) || MAX_PER_RUN));

  // Find contacts whose mobile is an @lid (the unresolved-phone case).
  // We join via Chat to pick up the routing JID (which the worker
  // needs to look up the contact — Contact.mobile may equal the JID in
  // these rows, but going through Chat is more explicit about intent).
  const candidates = await prisma.contact.findMany({
    where: {
      tenantId,
      deletedAt: null,
      mobile: { endsWith: "@lid" },
    },
    select: {
      id: true,
      mobile: true,
      firstName: true,
      lastName: true,
      notifyName: true,
      chats: { select: { phone: true }, take: 1 },
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  let checked = 0;
  let updated = 0;
  let resolvedPhones = 0;
  let resolvedNames = 0;
  let failed = 0;
  let workerUnavailable = false;

  for (const c of candidates) {
    if (workerUnavailable) break; // short-circuit once we know worker is down
    const jid = c.chats[0]?.phone || c.mobile;
    if (!jid) {
      continue;
    }
    checked += 1;
    const res = await queryContact(jid).catch((err) => ({
      ok: false,
      error: err.message,
    }));

    if (!res.ok) {
      failed += 1;
      log.warn("contact query failed", { contactId: c.id, jid, error: res.error });
      // If the worker says "not ready" we should bail out of the whole
      // run — no point continuing to fail every row.
      if (res.error?.includes("not ready") || res.error === "timeout") {
        workerUnavailable = true;
      }
      continue;
    }

    const number = isValidPhone(res.number) ? String(res.number) : null;
    const pushname = res.pushname?.trim() || null;
    const dataPatch = {};

    // Real phone resolved — promote it to Contact.mobile IF the new
    // number doesn't collide with an existing row (unique constraint).
    if (number && c.mobile !== number) {
      const collision = await prisma.contact.findUnique({
        where: { tenantId_mobile: { tenantId, mobile: number } },
        select: { id: true },
      });
      if (!collision) {
        dataPatch.mobile = number;
        resolvedPhones += 1;
      } else {
        log.info("skipping mobile update — would collide", {
          contactId: c.id,
          oldMobile: c.mobile,
          newMobile: number,
          collisionContactId: collision.id,
        });
      }
    }

    // Push-name resolved — always refresh notifyName. Only update
    // firstName/lastName when both are empty (don't clobber operator
    // edits).
    if (pushname && pushname !== c.notifyName) {
      dataPatch.notifyName = pushname;
      resolvedNames += 1;
    }
    if (pushname && !c.firstName && !c.lastName) {
      const parts = pushname.split(/\s+/).filter(Boolean);
      if (parts[0]) dataPatch.firstName = parts[0];
      if (parts.length > 1) dataPatch.lastName = parts.slice(1).join(" ");
    }

    if (Object.keys(dataPatch).length > 0) {
      await prisma.contact.update({ where: { id: c.id }, data: dataPatch });
      updated += 1;
    }

    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_QUERIES_MS));
  }

  const result = {
    checked,
    updated,
    resolvedPhones,
    resolvedNames,
    failed,
    remaining: Math.max(0, candidates.length - checked),
    workerUnavailable,
    moreCandidatesLikely: candidates.length === limit,
  };
  log.info("refresh-lid-contacts run", result);
  return result;
}

function isValidPhone(v) {
  if (!v) return false;
  const s = String(v);
  return /^\d{7,15}$/.test(s);
}
