import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../../config/index.js";
import { Unauthorized } from "../../shared/errors.js";
import { findUserByEmail, recordLogin } from "../users/user.service.js";

const ACCESS_AUDIENCE = "sa-api";
const REFRESH_AUDIENCE = "sa-refresh";

export async function verifyCredentials(email, password) {
  const user = await findUserByEmail(email);
  if (!user || !user.isActive) throw Unauthorized("invalid credentials");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw Unauthorized("invalid credentials");
  await recordLogin(user.id);
  return user;
}

export function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, tid: user.tenantId },
    config.jwt.secret,
    { audience: ACCESS_AUDIENCE, expiresIn: config.jwt.accessTtl },
  );
}

export function issueRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, tid: user.tenantId },
    config.jwt.secret,
    { audience: REFRESH_AUDIENCE, expiresIn: config.jwt.refreshTtl },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, { audience: ACCESS_AUDIENCE });
  } catch {
    throw Unauthorized("invalid or expired token");
  }
}

export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, { audience: REFRESH_AUDIENCE });
  } catch {
    throw Unauthorized("invalid or expired refresh token");
  }
}
