// M11.C4 — cross-tenant isolation regression test.
//
// Reproduces the production bug observed after C.2 shipped:
// a SUPER_ADMIN from tenant B logged in and saw tenant A's CRM data
// (sessions, contacts, leads, analytics) because every authenticated
// controller was hard-coded to getDefaultTenantId() instead of reading
// req.auth.tenantId from the JWT.
//
// This test drives the analytics + leads + contacts controllers
// directly with two different fixture tenants and asserts each only
// sees its own data.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { provisionTenant } from "../../src/modules/tenants/tenant-provisioning.service.js";
import { overview } from "../../src/modules/analytics/analytics.controller.js";
import { list as listLeads } from "../../src/modules/leads/lead.controller.js";
import { list as listContacts } from "../../src/modules/contacts/contact.controller.js";

const p = new PrismaClient();
let tenantA;
let tenantB;
let contactA;
let contactB;
let leadA;
let leadB;

before(async () => {
  // Tenant A.
  tenantA = await p.tenant.create({
    data: { slug: `c4-iso-a-${Date.now()}`, name: "Iso A" },
  });
  await provisionTenant(tenantA.id, { includeTestCampaign: false });
  contactA = await p.contact.create({
    data: {
      tenantId: tenantA.id,
      mobile: `c4a-${Date.now()}`,
      firstName: "ContactA",
      source: "iso-test-A",
    },
  });
  const pipelineA = await p.pipeline.findFirst({ where: { tenantId: tenantA.id } });
  const stageA = await p.stage.findFirst({ where: { pipelineId: pipelineA.id } });
  leadA = await p.lead.create({
    data: {
      tenantId: tenantA.id,
      contactId: contactA.id,
      pipelineId: pipelineA.id,
      stageId: stageA.id,
      source: "iso-test-A",
    },
  });

  // Tenant B (separate world).
  tenantB = await p.tenant.create({
    data: { slug: `c4-iso-b-${Date.now()}`, name: "Iso B" },
  });
  await provisionTenant(tenantB.id, { includeTestCampaign: false });
  contactB = await p.contact.create({
    data: {
      tenantId: tenantB.id,
      mobile: `c4b-${Date.now()}`,
      firstName: "ContactB",
      source: "iso-test-B",
    },
  });
  const pipelineB = await p.pipeline.findFirst({ where: { tenantId: tenantB.id } });
  const stageB = await p.stage.findFirst({ where: { pipelineId: pipelineB.id } });
  leadB = await p.lead.create({
    data: {
      tenantId: tenantB.id,
      contactId: contactB.id,
      pipelineId: pipelineB.id,
      stageId: stageB.id,
      source: "iso-test-B",
    },
  });
});

after(async () => {
  // Cascade-delete via tenant — clears users, settings, pipelines, leads,
  // contacts, etc. in one shot per fixture tenant.
  await p.tenant.delete({ where: { id: tenantA.id } });
  await p.tenant.delete({ where: { id: tenantB.id } });
  await p.$disconnect();
});

// Driver: same controller-call harness used in C.1/C.2 tests.
async function invoke(controller, { tenantId, query = {}, body = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      auth: { tenantId, userId: "test-user", role: "SUPER_ADMIN" },
      user: { tenantId, id: "test-user", role: "SUPER_ADMIN" },
      query,
      body,
      params: {},
    };
    const res = {
      statusCode: 200,
      jsonBody: null,
      status(code) {
        res.statusCode = code;
        return res;
      },
      json(b) {
        res.jsonBody = b;
        resolve(res);
        return res;
      },
    };
    const next = (err) => (err ? reject(err) : resolve(res));
    controller(req, res, next);
  });
}

describe("Cross-tenant isolation (regression for C.2 leak)", () => {
  test("contact list scoped to caller's tenant — no tenant-A rows in tenant-B's response", async () => {
    const resA = await invoke(listContacts, { tenantId: tenantA.id });
    const resB = await invoke(listContacts, { tenantId: tenantB.id });

    const idsA = (resA.jsonBody.items || resA.jsonBody.data || []).map((c) => c.id);
    const idsB = (resB.jsonBody.items || resB.jsonBody.data || []).map((c) => c.id);

    assert.ok(idsA.includes(contactA.id), "tenant A's caller must see contact A");
    assert.ok(!idsA.includes(contactB.id), "tenant A's caller must NOT see contact B");
    assert.ok(idsB.includes(contactB.id), "tenant B's caller must see contact B");
    assert.ok(!idsB.includes(contactA.id), "tenant B's caller must NOT see contact A");
  });

  test("lead list scoped to caller's tenant", async () => {
    const resA = await invoke(listLeads, { tenantId: tenantA.id });
    const resB = await invoke(listLeads, { tenantId: tenantB.id });

    const idsA = (resA.jsonBody.items || resA.jsonBody.data || []).map((l) => l.id);
    const idsB = (resB.jsonBody.items || resB.jsonBody.data || []).map((l) => l.id);

    assert.ok(idsA.includes(leadA.id), "tenant A's caller must see lead A");
    assert.ok(!idsA.includes(leadB.id), "tenant A's caller must NOT see lead B");
    assert.ok(idsB.includes(leadB.id));
    assert.ok(!idsB.includes(leadA.id));
  });

  test("analytics overview scoped to caller's tenant — no cross-tenant counts", async () => {
    // Each tenant has exactly one lead and one contact, no sessions/AI
    // replies. The numbers may legitimately be 0 — the point is they
    // must match per-tenant data, not the default tenant's data.
    const resA = await invoke(overview, { tenantId: tenantA.id, query: { period: "30d" } });
    const resB = await invoke(overview, { tenantId: tenantB.id, query: { period: "30d" } });

    assert.ok(resA.jsonBody.overview, "tenant A overview should populate");
    assert.ok(resB.jsonBody.overview, "tenant B overview should populate");
    // The campaign breakdown for two fresh tenants with no campaigns
    // should be empty arrays — proves we're not pulling from the
    // default tenant.
    assert.deepEqual(
      resA.jsonBody.by_campaign,
      [],
      "tenant A's by_campaign must be empty (no campaigns provisioned)",
    );
    assert.deepEqual(resB.jsonBody.by_campaign, []);
  });
});
