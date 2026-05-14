// Dev-only: signs an access token for the seeded super admin. Used for
// smoke-testing REST endpoints without needing to know the password.
// Do NOT ship with the deployed image.

import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@local.test";

const user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
if (!user) {
  console.error(`admin ${ADMIN_EMAIL} not found`);
  process.exit(1);
}
const token = jwt.sign(
  { sub: user.id, role: user.role, tid: user.tenantId },
  process.env.JWT_SECRET,
  { audience: "sa-api", expiresIn: "1h" },
);
process.stdout.write(token);
await prisma.$disconnect();
