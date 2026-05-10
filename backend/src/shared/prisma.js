import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";

export const prisma = new PrismaClient({
  log: config.env === "development" ? ["warn", "error"] : ["error"],
});

export async function pingDb() {
  await prisma.$queryRaw`SELECT 1`;
}
