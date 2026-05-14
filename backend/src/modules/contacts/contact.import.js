// CSV/XLSX bulk import — streamed parsing + per-row dedup by (tenantId,
// mobile). Mirrors the soft-delete tolerance of the rest of the service:
// re-importing a previously-deleted contact REVIVES it (clears deletedAt).
//
// Returns { created, updated, skipped, errors[] } where each error has
// { row, reason } so the operator can fix and re-upload only the failures.

import fs from "node:fs";
import Papa from "papaparse";
import XLSX from "xlsx";
import { prisma } from "../../shared/prisma.js";
import { BadRequest } from "../../shared/errors.js";

// Fields that can be mapped from a column. Anything else lands in
// customFields (operator can rename "Industry" → industry etc.).
export const MAPPABLE_FIELDS = [
  "firstName",
  "lastName",
  "mobile",
  "email",
  "company",
  "city",
  "state",
  "country",
  "source",
];

// Strip "+", spaces, dashes, parens. Result must be digits-only (matches
// chats.phone E.164 sans "+") OR end in "@lid" (WhatsApp Linked
// Identifier accounts). Returns "" for anything that doesn't match, so
// the row is rejected rather than silently inserted with junk.
const VALID_MOBILE_RE = /^(\d{7,20}|\d{6,20}@lid)$/;
export function normalizeMobile(raw) {
  if (raw === null || raw === undefined) return "";
  const cleaned = String(raw).trim().replace(/^\+/, "").replace(/[\s\-().]/g, "");
  return VALID_MOBILE_RE.test(cleaned) ? cleaned : "";
}

function parseCsvBuffer(buf) {
  const text = buf.toString("utf-8");
  const result = Papa.parse(text, { header: true, skipEmptyLines: "greedy" });
  if (result.errors?.length) {
    // Most CSV "errors" from Papa are recoverable warnings — only fail if
    // we got zero rows.
    if (!result.data?.length) {
      throw BadRequest(`CSV parse failed: ${result.errors[0].message}`);
    }
  }
  return result.data;
}

function parseXlsxBuffer(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw BadRequest("XLSX has no sheets");
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

// Pull the requested field from a row using the provided column mapping.
function pluck(row, mapping, field) {
  const col = mapping[field];
  if (!col) return undefined;
  const v = row[col];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length === 0 ? undefined : s;
}

export async function importContacts({
  tenantId,
  filePath,
  filename,
  mapping = {},
  source: defaultSource,
}) {
  // 1. Parse to an array of { rawRow, mapped }.
  const buf = fs.readFileSync(filePath);
  const ext = filename.toLowerCase().split(".").pop();
  let rows;
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    rows = parseCsvBuffer(buf);
  } else if (ext === "xlsx" || ext === "xls") {
    rows = parseXlsxBuffer(buf);
  } else {
    throw BadRequest(`unsupported file type: .${ext}`);
  }

  // 2. Auto-detect mapping if the caller didn't supply one. We accept the
  //    column header verbatim if it matches a MAPPABLE_FIELDS name (case
  //    insensitive, ignoring spaces / underscores).
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const effectiveMapping = { ...mapping };
  for (const field of MAPPABLE_FIELDS) {
    if (effectiveMapping[field]) continue;
    const norm = field.toLowerCase();
    const match = headers.find((h) => h.toLowerCase().replace(/[_\s-]/g, "") === norm);
    if (match) effectiveMapping[field] = match;
  }
  if (!effectiveMapping.mobile) {
    throw BadRequest("mobile column must be mapped (no header matched 'mobile')");
  }

  // 3. Walk rows and upsert. We re-process the entire file per request —
  //    CSVs over ~100k rows would need a queue worker; out of scope for M2.
  const result = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
  const seenMobiles = new Set();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2; // header is row 1 in spreadsheet terms

    const mapped = {};
    for (const f of MAPPABLE_FIELDS) {
      const v = pluck(raw, effectiveMapping, f);
      if (v !== undefined) mapped[f] = v;
    }

    // Drop the mapped columns from raw to get the customFields leftovers.
    const usedCols = new Set(Object.values(effectiveMapping));
    const customFields = {};
    for (const [k, v] of Object.entries(raw)) {
      if (usedCols.has(k)) continue;
      if (v === undefined || v === null) continue;
      const s = String(v).trim();
      if (!s) continue;
      customFields[k] = s;
    }

    const mobile = normalizeMobile(mapped.mobile);
    if (!mobile) {
      result.errors.push({ row: rowNum, reason: "mobile missing or empty" });
      result.skipped += 1;
      continue;
    }
    if (seenMobiles.has(mobile)) {
      result.errors.push({ row: rowNum, reason: `duplicate mobile within file: ${mobile}` });
      result.skipped += 1;
      continue;
    }
    seenMobiles.add(mobile);

    try {
      const existing = await prisma.contact.findUnique({
        where: { tenantId_mobile: { tenantId, mobile } },
      });

      if (existing) {
        // Re-import an existing contact: fill blank fields, do NOT
        // overwrite operator-edited data. Always revive a soft-deleted row.
        const update = {};
        for (const f of ["firstName", "lastName", "email", "company", "city", "state", "country"]) {
          if (mapped[f] && !existing[f]) update[f] = mapped[f];
        }
        if (mapped.source && !existing.source) update.source = mapped.source;
        else if (defaultSource && !existing.source) update.source = defaultSource;

        if (Object.keys(customFields).length) {
          const merged = { ...(existing.customFields || {}), ...customFields };
          // Only write if at least one value actually differs — avoids
          // spurious "updated" counts on identical re-imports.
          const existingKeys = Object.keys(existing.customFields || {});
          const mergedKeys = Object.keys(merged);
          const changed =
            mergedKeys.length !== existingKeys.length ||
            mergedKeys.some(
              (k) => (existing.customFields || {})[k] !== merged[k],
            );
          if (changed) update.customFields = merged;
        }
        if (existing.deletedAt) update.deletedAt = null;

        if (Object.keys(update).length === 0) {
          result.skipped += 1;
          continue;
        }
        await prisma.contact.update({ where: { id: existing.id }, data: update });
        result.updated += 1;
      } else {
        await prisma.contact.create({
          data: {
            tenantId,
            mobile,
            firstName: mapped.firstName ?? null,
            lastName: mapped.lastName ?? null,
            email: mapped.email ?? null,
            company: mapped.company ?? null,
            city: mapped.city ?? null,
            state: mapped.state ?? null,
            country: mapped.country ?? null,
            source: mapped.source ?? defaultSource ?? "import",
            customFields: Object.keys(customFields).length ? customFields : null,
          },
        });
        result.created += 1;
      }
    } catch (err) {
      result.errors.push({ row: rowNum, reason: err.message });
      result.skipped += 1;
    }
  }

  return { ...result, mapping: effectiveMapping };
}

// ─── Export ──────────────────────────────────────────────────────────

// Returns rows ready for csv/xlsx serialization. Source-of-truth field
// names match MAPPABLE_FIELDS so a round-trip (export → re-import) is
// lossless.
export async function listContactsForExport(tenantId, opts = {}) {
  const { includeDeleted = false, source, ownerId } = opts;
  const where = {
    tenantId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(source ? { source } : {}),
    ...(ownerId ? { ownerId } : {}),
  };
  const items = await prisma.contact.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      firstName: true,
      lastName: true,
      mobile: true,
      email: true,
      company: true,
      city: true,
      state: true,
      country: true,
      source: true,
      customFields: true,
      createdAt: true,
    },
  });

  return items.map((c) => {
    const flat = {
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      mobile: c.mobile,
      email: c.email || "",
      company: c.company || "",
      city: c.city || "",
      state: c.state || "",
      country: c.country || "",
      source: c.source || "",
      createdAt: c.createdAt.toISOString(),
    };
    // Spread custom fields into top-level columns; collisions favor the
    // built-in field (operator can rename custom keys before importing
    // again).
    if (c.customFields && typeof c.customFields === "object") {
      for (const [k, v] of Object.entries(c.customFields)) {
        if (flat[k] === undefined) flat[k] = String(v ?? "");
      }
    }
    return flat;
  });
}

export function buildCsv(rows) {
  if (rows.length === 0) return "firstName,lastName,mobile,email,company,city,state,country,source,createdAt\n";
  return Papa.unparse(rows);
}

export function buildXlsx(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
