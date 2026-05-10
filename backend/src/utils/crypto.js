import crypto from "node:crypto";
import { config } from "../config/index.js";

// AES-256-GCM envelope: { v, iv, tag, data } — all base64url.
// Key is 32 bytes (64 hex chars in ENCRYPTION_KEY).

const ALGO = "aes-256-gcm";
const VERSION = 1;

function getKey() {
  const hex = config.encryptionKey;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes / 64 hex chars");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: VERSION,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    data: enc.toString("base64url"),
  };
}

export function decrypt(envelope) {
  if (!envelope || envelope.v !== VERSION) throw new Error("invalid encrypted envelope");
  const key = getKey();
  const iv = Buffer.from(envelope.iv, "base64url");
  const tag = Buffer.from(envelope.tag, "base64url");
  const data = Buffer.from(envelope.data, "base64url");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}
