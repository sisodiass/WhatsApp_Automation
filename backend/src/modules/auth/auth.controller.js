import { z } from "zod";
import { isProd } from "../../config/index.js";
import { asyncHandler, BadRequest, Unauthorized } from "../../shared/errors.js";
import { findUserById, publicUser } from "../users/user.service.js";
import {
  issueAccessToken,
  issueRefreshToken,
  verifyCredentials,
  verifyRefreshToken,
} from "./auth.service.js";

const REFRESH_COOKIE = "sa_refresh";

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: isProd() ? "strict" : "lax",
    path: "/api/auth",
    maxAge: 7 * 24 * 60 * 60 * 1000, // matches default JWT_REFRESH_TTL=7d
  };
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const login = asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid login payload", parsed.error.flatten());

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  const accessToken = issueAccessToken(user);
  const refreshToken = issueRefreshToken(user);

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.json({ accessToken, user: publicUser(user) });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw Unauthorized("no refresh cookie");
  const payload = verifyRefreshToken(token);
  const user = await findUserById(payload.sub);
  if (!user || !user.isActive) throw Unauthorized("user inactive");

  const accessToken = issueAccessToken(user);
  // Rotate the refresh cookie too — extends the rolling window.
  const refreshToken = issueRefreshToken(user);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.json({ accessToken, user: publicUser(user) });
});

export const me = asyncHandler(async (req, res) => {
  const user = await findUserById(req.auth.userId);
  if (!user) throw Unauthorized();
  res.json({ user: publicUser(user) });
});

export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.json({ ok: true });
});
