// Provider factory. Reads the active provider + per-provider model from
// the settings table, and resolves API keys from settings first then env.
// Caches a single instance per (provider, models, key-fingerprint) signature.
// Call `invalidateProvider()` after a relevant settings update so the next
// caller picks up the change.

import crypto from "node:crypto";
import { config } from "../../../config/index.js";
import { child } from "../../../shared/logger.js";
import { getDefaultTenantId } from "../../../shared/tenant.js";
import { prisma } from "../../../shared/prisma.js";
import { decrypt } from "../../../utils/crypto.js";
import { createOpenAIProvider } from "./openai.provider.js";
import { createGeminiProvider } from "./gemini.provider.js";

const log = child("ai-provider");

// To avoid a circular import (settings.service imports invalidateProvider
// from this file), we read settings rows directly here instead of using
// settings.service's helpers.
async function readSettings(tenantId, keys) {
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { in: keys } },
  });
  const out = {};
  for (const r of rows) {
    if (r.encrypted) {
      try {
        out[r.key] = decrypt(r.value);
      } catch {
        // skip — corrupted / wrong key
      }
    } else {
      out[r.key] = r.value;
    }
  }
  return out;
}

const REGISTRY = {
  openai: ({ apiKey, chatModel, embedModel }) =>
    createOpenAIProvider({ apiKey, chatModel, embedModel }),
  gemini: ({ apiKey, chatModel, embedModel }) =>
    createGeminiProvider({ apiKey, chatModel, embedModel }),
};

let cached = null; // { signature, provider }

function fingerprint(s) {
  if (!s) return "none";
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function signature(name, chat, embed, apiKey) {
  return `${name}|${chat}|${embed}|${fingerprint(apiKey)}`;
}

export async function getProvider() {
  const tenantId = await getDefaultTenantId();
  const cfg = await readSettings(tenantId, [
    "ai.provider",
    "ai.openai.api_key",
    "ai.openai.chat_model",
    "ai.openai.embedding_model",
    "ai.gemini.api_key",
    "ai.gemini.chat_model",
    "ai.gemini.embedding_model",
  ]);

  const name = String(cfg["ai.provider"] || "openai").toLowerCase();
  if (!REGISTRY[name]) throw new Error(`unknown ai provider "${name}"`);

  let apiKey, chatModel, embedModel;
  if (name === "openai") {
    apiKey = cfg["ai.openai.api_key"] || config.openai.apiKey;
    chatModel = cfg["ai.openai.chat_model"] || config.openai.chatModel;
    embedModel = cfg["ai.openai.embedding_model"] || config.openai.embedModel;
  } else {
    apiKey = cfg["ai.gemini.api_key"] || config.gemini.apiKey;
    chatModel = cfg["ai.gemini.chat_model"] || config.gemini.chatModel;
    embedModel = cfg["ai.gemini.embedding_model"] || config.gemini.embedModel;
  }

  const sig = signature(name, chatModel, embedModel, apiKey);
  if (cached && cached.signature === sig) return cached.provider;

  log.info("instantiating provider", {
    name,
    chatModel,
    embedModel,
    keySource: cfg[`ai.${name}.api_key`] ? "settings" : "env",
  });
  const provider = REGISTRY[name]({ apiKey, chatModel, embedModel });
  cached = { signature: sig, provider };
  return provider;
}

export function invalidateProvider() {
  cached = null;
}

export function listProviders() {
  return Object.keys(REGISTRY);
}
