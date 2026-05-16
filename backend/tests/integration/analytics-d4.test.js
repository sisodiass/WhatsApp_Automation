// Integration test for the M11.D4 advanced analytics functions.
// Builds Prisma fixtures (lead + won-quote + agent-message) and asserts
// the rollups surface the right numbers. Standalone — doesn't depend
// on previously-seeded data.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { getDefaultTenantId } from "../../src/shared/tenant.js";
import {
  getAgentProductivity,
  getPipelineBurndown,
  getSourceRoi,
} from "../../src/modules/analytics/analytics.service.js";

const p = new PrismaClient();
let tid;

before(async () => {
  tid = await getDefaultTenantId();
});

after(async () => {
  await p.$disconnect();
});

async function withFixture(setup, body) {
  const ctx = await setup();
  try {
    await body(ctx);
  } finally {
    await ctx.cleanup();
  }
}

describe("getSourceRoi — leads + won + revenue per source", () => {
  test("includes ACCEPTED quotation revenue per currency per source", async () => {
    await withFixture(
      async () => {
        const phone = `roi-${Date.now()}`;
        const tag = `roi-tag-${Date.now()}`;
        const contact = await p.contact.create({
          data: { tenantId: tid, mobile: phone, firstName: "Roi", lastName: "Test" },
        });
        const pipeline = await p.pipeline.findFirst({
          where: { tenantId: tid, isDefault: true },
          include: { stages: true },
        });
        const wonStage = pipeline.stages.find((s) => s.category === "WON");
        const lead = await p.lead.create({
          data: {
            tenantId: tid,
            contactId: contact.id,
            pipelineId: pipeline.id,
            stageId: wonStage.id,
            source: tag,
            wonAt: new Date(),
          },
        });
        const quote = await p.quotation.create({
          data: {
            tenantId: tid,
            number: `ROI-${Date.now()}`,
            contactId: contact.id,
            leadId: lead.id,
            status: "ACCEPTED",
            currency: "INR",
            subtotal: "1000.00",
            discountTotal: "0.00",
            taxTotal: "180.00",
            grandTotal: "1180.00",
            validUntil: new Date(Date.now() + 7 * 86400000),
          },
        });
        return {
          tag,
          cleanup: async () => {
            await p.quotation.delete({ where: { id: quote.id } });
            await p.lead.delete({ where: { id: lead.id } });
            await p.contact.delete({ where: { id: contact.id } });
          },
        };
      },
      async ({ tag }) => {
        const items = await getSourceRoi(tid, "30d");
        const row = items.find((r) => r.source === tag);
        assert.ok(row, `expected a row for source ${tag}`);
        assert.equal(row.total, 1);
        assert.equal(row.won, 1);
        assert.equal(row.conversion, 1);
        // Per-currency map sums the grandTotal — INR 1180.00.
        assert.equal(row.revenueByCurrency.INR, "1180.00");
      },
    );
  });

  test("excludes DRAFT/SENT/REJECTED quotes from revenue (only ACCEPTED counts)", async () => {
    await withFixture(
      async () => {
        const tag = `roi-draft-${Date.now()}`;
        const phone = `roi-draft-${Date.now()}`;
        const contact = await p.contact.create({
          data: { tenantId: tid, mobile: phone, firstName: "Roi", lastName: "Draft" },
        });
        const pipeline = await p.pipeline.findFirst({
          where: { tenantId: tid, isDefault: true },
          include: { stages: true },
        });
        const wonStage = pipeline.stages.find((s) => s.category === "WON");
        const lead = await p.lead.create({
          data: {
            tenantId: tid,
            contactId: contact.id,
            pipelineId: pipeline.id,
            stageId: wonStage.id,
            source: tag,
            wonAt: new Date(),
          },
        });
        // Three quotes in different states — only ACCEPTED should count.
        const draft = await p.quotation.create({
          data: {
            tenantId: tid,
            number: `ROI-D-${Date.now()}`,
            contactId: contact.id,
            leadId: lead.id,
            status: "DRAFT",
            currency: "INR",
            subtotal: "999",
            discountTotal: "0",
            taxTotal: "0",
            grandTotal: "999.00",
            validUntil: new Date(Date.now() + 7 * 86400000),
          },
        });
        const sent = await p.quotation.create({
          data: {
            tenantId: tid,
            number: `ROI-S-${Date.now()}`,
            contactId: contact.id,
            leadId: lead.id,
            status: "SENT",
            currency: "INR",
            subtotal: "999",
            discountTotal: "0",
            taxTotal: "0",
            grandTotal: "888.00",
            validUntil: new Date(Date.now() + 7 * 86400000),
          },
        });
        const accepted = await p.quotation.create({
          data: {
            tenantId: tid,
            number: `ROI-A-${Date.now()}`,
            contactId: contact.id,
            leadId: lead.id,
            status: "ACCEPTED",
            currency: "INR",
            subtotal: "777",
            discountTotal: "0",
            taxTotal: "0",
            grandTotal: "500.00",
            validUntil: new Date(Date.now() + 7 * 86400000),
          },
        });
        return {
          tag,
          cleanup: async () => {
            await p.quotation.deleteMany({
              where: { id: { in: [draft.id, sent.id, accepted.id] } },
            });
            await p.lead.delete({ where: { id: lead.id } });
            await p.contact.delete({ where: { id: contact.id } });
          },
        };
      },
      async ({ tag }) => {
        const items = await getSourceRoi(tid, "30d");
        const row = items.find((r) => r.source === tag);
        assert.ok(row, "expected a row");
        // Only the 500.00 ACCEPTED quote counts — the 999 + 888 are skipped.
        assert.equal(row.revenueByCurrency.INR, "500.00");
      },
    );
  });
});

describe("getPipelineBurndown — daily stage counts over 30d", () => {
  test("returns the configured number of buckets with the right shape", async () => {
    const out = await getPipelineBurndown(tid, null, 14);
    assert.ok(out.pipeline, "should resolve a pipeline");
    assert.ok(Array.isArray(out.stages));
    assert.ok(out.stages.length > 0);
    assert.equal(out.series.length, 14, "14-day window → 14 buckets");
    // Every bucket has a date and a counts map keyed by stageId.
    for (const bucket of out.series) {
      assert.match(bucket.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(typeof bucket.counts, "object");
      for (const s of out.stages) {
        assert.ok(s.id in bucket.counts, `stage ${s.name} missing from counts`);
      }
    }
  });

  test("today's bucket reflects current per-stage counts", async () => {
    const funnel = await p.lead.groupBy({
      by: ["stageId"],
      where: { tenantId: tid },
      _count: true,
    });
    const out = await getPipelineBurndown(tid, null, 7);
    const today = out.series[out.series.length - 1];
    // For stages with leads, today's bucket should match the live count.
    for (const g of funnel) {
      if (today.counts[g.stageId] !== undefined) {
        assert.equal(
          today.counts[g.stageId],
          g._count,
          `today's bucket for stage ${g.stageId} should equal live count`,
        );
      }
    }
  });
});

describe("getAgentProductivity — assigned + won + lost per agent", () => {
  test("returns rows sorted by won count desc", async () => {
    const items = await getAgentProductivity(tid, "all");
    assert.ok(Array.isArray(items));
    for (let i = 0; i < items.length - 1; i++) {
      assert.ok(
        items[i].won >= items[i + 1].won,
        "results must be sorted by won desc",
      );
    }
  });

  test("each row carries the expected shape", async () => {
    const items = await getAgentProductivity(tid, "all");
    for (const row of items) {
      assert.ok(typeof row.userId === "string");
      assert.ok(typeof row.name === "string");
      assert.ok("role" in row);
      assert.ok(typeof row.active === "boolean");
      assert.equal(typeof row.openAssigned, "number");
      assert.equal(typeof row.won, "number");
      assert.equal(typeof row.lost, "number");
      assert.equal(typeof row.winRate, "number");
      assert.ok(row.winRate >= 0 && row.winRate <= 1);
    }
  });

  test("winRate is won/(won+lost), 0 when no closed deals", async () => {
    const items = await getAgentProductivity(tid, "all");
    for (const row of items) {
      const closed = row.won + row.lost;
      if (closed === 0) {
        assert.equal(row.winRate, 0);
      } else {
        const expected = Number((row.won / closed).toFixed(3));
        assert.equal(row.winRate, expected);
      }
    }
  });
});
