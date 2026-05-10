import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load both backend/.env and project-root .env (root takes precedence if duplicated).
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function required(name) {
  const v = process.env[name];
  if (!v || v.startsWith("replace_me")) {
    throw new Error(`Missing or unset env var: ${name}`);
  }
  return v;
}

export const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4000", 10),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  logLevel: process.env.LOG_LEVEL || "info",

  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  jwt: {
    secret: required("JWT_SECRET"),
    accessTtl: process.env.JWT_ACCESS_TTL || "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL || "7d",
  },

  encryptionKey: required("ENCRYPTION_KEY"),

  // Per-provider env defaults. The active provider + model selections live
  // in the `settings` table and are read at runtime by the provider factory.
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    chatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    embedModel: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    chatModel: process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash",
    embedModel: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001",
  },

  tenant: {
    defaultSlug: process.env.DEFAULT_TENANT_SLUG || "default",
    defaultName: process.env.DEFAULT_TENANT_NAME || "Default Tenant",
  },
};

export function isProd() {
  return config.env === "production";
}
