// Dev-only — seeds 5 demo leads across the first 5 stages of the
// default pipeline so the Kanban has something to drag around.
// Idempotent: re-running won't create duplicates.
//
// Run from backend/:  node scripts/seed-demo-leads.js

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const demos = [
  { firstName: "Aarav",  lastName: "Khanna", mobile: "919800000101", company: "Khanna Industries", score: "HOT",  expectedValue: 12000, stage: 0 },
  { firstName: "Priya",  lastName: "Reddy",  mobile: "919800000102", company: "Reddy Foods",       score: "WARM", expectedValue: 8500,  stage: 1 },
  { firstName: "Vikram", lastName: "Shah",   mobile: "919800000103", company: "Shah Logistics",    score: "WARM", expectedValue: 22000, stage: 2 },
  { firstName: "Anjali", lastName: "Patel",  mobile: "919800000104", company: "Patel Textiles",    score: "COLD", expectedValue: 4000,  stage: 3 },
  { firstName: "Rohan",  lastName: "Gupta",  mobile: "919800000105", company: "Gupta Tech",        score: "HOT",  expectedValue: 31000, stage: 4 },
];

const tenant = await p.tenant.findFirst();
const pipe = await p.pipeline.findFirst({
  where: { tenantId: tenant.id, isDefault: true },
  include: { stages: { orderBy: { order: "asc" } } },
});

for (const d of demos) {
  const c = await p.contact.upsert({
    where: { tenantId_mobile: { tenantId: tenant.id, mobile: d.mobile } },
    update: {},
    create: {
      tenantId: tenant.id, mobile: d.mobile,
      firstName: d.firstName, lastName: d.lastName,
      company: d.company, source: "demo",
    },
  });
  const existing = await p.lead.findFirst({ where: { contactId: c.id } });
  if (existing) continue;
  await p.lead.create({
    data: {
      tenantId: tenant.id, contactId: c.id,
      pipelineId: pipe.id, stageId: pipe.stages[d.stage].id,
      score: d.score, expectedValue: d.expectedValue, currency: "INR", source: "demo",
    },
  });
}

console.log("seeded 5 demo leads across stages");
await p.$disconnect();
