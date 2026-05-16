import bcrypt from "bcryptjs";
import { z } from "zod";
import { isProd, config } from "../../config/index.js";
import { asyncHandler, BadRequest, Conflict, Forbidden, Unauthorized } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { findUserById, findUserByEmail, publicUser } from "../users/user.service.js";
import { sendEmail, renderNotificationEmail } from "../email/email.service.js";
import { provisionTenant } from "../tenants/tenant-provisioning.service.js";
import { createToken, consumeToken, DEFAULT_TTLS } from "./auth.tokens.js";
import {
  issueAccessToken,
  issueRefreshToken,
  verifyCredentials,
  verifyRefreshToken,
} from "./auth.service.js";

const authLog = child("auth");

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

// ─── M11.C1 — password reset + email verification ──────────────────

// Constant-time "always 200" — never leak whether an email exists.
function genericOk(res) {
  res.json({ ok: true });
}

function ttlMinutes(kind) {
  return Math.round((DEFAULT_TTLS[kind] || 3600_000) / 60_000);
}

function frontendUrl(path) {
  const base = (config.frontendUrl || "").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function sendResetEmail(user, plaintextToken) {
  const url = frontendUrl(`/reset-password?token=${encodeURIComponent(plaintextToken)}`);
  const { html, text } = renderNotificationEmail({
    title: "Reset your SalesAutomation password",
    body: [
      "We received a request to reset the password for this account.",
      `This link is valid for ${ttlMinutes("RESET_PASSWORD")} minutes.`,
      "If you didn't request a reset you can safely ignore this email.",
    ].join("\n\n"),
    url,
    urlLabel: "Reset password",
  });
  await sendEmail({
    to: user.email,
    subject: "Reset your SalesAutomation password",
    html,
    text,
    kind: "PASSWORD_RESET",
  });
}

async function sendVerifyEmail(user, plaintextToken) {
  const url = frontendUrl(`/verify-email?token=${encodeURIComponent(plaintextToken)}`);
  const { html, text } = renderNotificationEmail({
    title: "Verify your SalesAutomation email",
    body: [
      "Confirm the email address on this account.",
      `This link is valid for ${ttlMinutes("VERIFY_EMAIL") / 60} hours.`,
    ].join("\n\n"),
    url,
    urlLabel: "Verify email",
  });
  await sendEmail({
    to: user.email,
    subject: "Verify your SalesAutomation email",
    html,
    text,
    kind: "EMAIL_VERIFY",
  });
}

const forgotSchema = z.object({ email: z.string().email() });

export const forgotPassword = asyncHandler(async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid email payload");
  const user = await findUserByEmail(parsed.data.email);

  // Always succeed silently — even when the user doesn't exist. This
  // prevents the endpoint from leaking which emails are registered.
  if (!user || !user.isActive) {
    authLog.info("forgot-password for unknown/inactive email", { email: parsed.data.email });
    return genericOk(res);
  }

  try {
    const plaintext = await createToken({
      userId: user.id,
      kind: "RESET_PASSWORD",
      invalidatePrior: true,
    });
    await sendResetEmail(user, plaintext);
  } catch (err) {
    authLog.warn("forgot-password send failed (returning 200 anyway)", {
      userId: user.id,
      err: err?.message,
    });
  }
  return genericOk(res);
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

export const resetPassword = asyncHandler(async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    throw BadRequest("invalid reset payload (password must be 8+ chars)");
  }
  const user = await consumeToken(parsed.data.token, "RESET_PASSWORD");
  const newHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });
  // Belt-and-braces: invalidate any other outstanding reset tokens for
  // this user so a leaked email can't trigger a second reset.
  await prisma.authToken.updateMany({
    where: { userId: user.id, kind: "RESET_PASSWORD", usedAt: null },
    data: { usedAt: new Date() },
  });
  authLog.info("password reset", { userId: user.id });
  res.json({ ok: true });
});

const verifyEmailSchema = z.object({ token: z.string().min(1) });

export const verifyEmail = asyncHandler(async (req, res) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid verify payload");
  const user = await consumeToken(parsed.data.token, "VERIFY_EMAIL");
  if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
  }
  authLog.info("email verified", { userId: user.id });
  res.json({ ok: true, email: user.email });
});

const resendVerifySchema = z.object({ email: z.string().email() });

export const resendVerification = asyncHandler(async (req, res) => {
  const parsed = resendVerifySchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid email payload");
  const user = await findUserByEmail(parsed.data.email);
  // Same silent-success policy as /forgot-password.
  if (!user || !user.isActive) return genericOk(res);
  if (user.emailVerifiedAt) return genericOk(res); // already verified

  try {
    const plaintext = await createToken({
      userId: user.id,
      kind: "VERIFY_EMAIL",
      invalidatePrior: true,
    });
    await sendVerifyEmail(user, plaintext);
  } catch (err) {
    authLog.warn("resend-verification send failed", { userId: user.id, err: err?.message });
  }
  return genericOk(res);
});

// ─── M11.C2 — SaaS signup ──────────────────────────────────────────
//
// Creates: Tenant → SUPER_ADMIN user → per-tenant scaffolding via
// provisionTenant() → returns tokens (so the user lands signed-in on
// the dashboard) + sends a verification email asynchronously.
//
// Gating: signup is OFF by default. The operator flips the
// `tenant.signup_enabled` setting on the DEFAULT (operator-controlled)
// tenant to open public signups. This keeps existing single-tenant
// deploys safe from random tenant creation.
//
// Email-uniqueness is enforced at the User-table level: an email can
// only belong to one tenant in the whole DB. This is intentional for
// v1 — no multi-tenant memberships, no "join an org" flow yet.

async function isSignupEnabled() {
  // Read from the default tenant (operator-controlled). If no tenants
  // exist yet (cold DB), signup must be allowed so the very first user
  // can bootstrap.
  const tenantCount = await prisma.tenant.count();
  if (tenantCount === 0) return true;
  // Convention: default tenant has the smallest createdAt (seed runs
  // first). Operators can toggle via Settings.
  const oldest = await prisma.tenant.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!oldest) return true;
  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId: oldest.id, key: "tenant.signup_enabled" } },
  });
  return row?.value === true;
}

// Public — frontend uses this to show/hide the "Sign up" link.
export const signupEnabled = asyncHandler(async (_req, res) => {
  res.json({ enabled: await isSignupEnabled() });
});

// Slugify the org name into a unique tenant slug. Collisions get a
// numeric suffix; we cap the loop so a pathological input can't run
// forever.
async function uniqueTenantSlug(orgName) {
  const base = String(orgName)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40) || "org";
  let slug = base;
  for (let i = 0; i < 50; i++) {
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (!existing) return slug;
    slug = `${base}-${i + 2}`;
  }
  // Fallback to a random suffix; effectively never collides.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be 8+ chars").max(200),
  fullName: z.string().min(1).max(120),
  orgName: z.string().min(1).max(120),
});

export const signup = asyncHandler(async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    throw BadRequest("invalid signup payload", parsed.error.flatten());
  }
  const { email, password, fullName, orgName } = parsed.data;

  if (!(await isSignupEnabled())) {
    throw Forbidden(
      "signup is disabled — contact your administrator to open public signups",
    );
  }

  // Email uniqueness — surface as 409 Conflict, not Unauthorized, so
  // the frontend can render a friendly "email already in use" error.
  const dupe = await prisma.user.findUnique({ where: { email } });
  if (dupe) throw Conflict("an account with this email already exists");

  const slug = await uniqueTenantSlug(orgName);
  const passwordHash = await bcrypt.hash(password, 12);

  // Create Tenant + User atomically — if anything in the txn fails the
  // partial tenant doesn't linger. Provisioning runs after commit so
  // its idempotent helpers don't deadlock on uncommitted rows.
  const { tenant, user } = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: { slug, name: String(orgName).slice(0, 120) },
    });
    const u = await tx.user.create({
      data: {
        tenantId: t.id,
        email,
        passwordHash,
        name: String(fullName).slice(0, 120),
        role: "SUPER_ADMIN",
      },
    });
    return { tenant: t, user: u };
  });

  // Provision the new tenant's scaffolding. Failure here is unusual but
  // we don't want to leave the user with an empty workspace — surface
  // as 500. The earlier transaction is committed so the user exists;
  // they can retry by deleting + recreating if it persists.
  await provisionTenant(tenant.id, { includeTestCampaign: false });

  // Fire-and-forget verify email. Failures don't block signup —
  // operator can resend later.
  try {
    const token = await createToken({ userId: user.id, kind: "VERIFY_EMAIL" });
    await sendVerifyEmail(user, token);
  } catch (err) {
    authLog.warn("signup verify-email send failed (non-fatal)", {
      userId: user.id,
      err: err?.message,
    });
  }

  const accessToken = issueAccessToken(user);
  const refreshToken = issueRefreshToken(user);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  authLog.info("signup completed", {
    userId: user.id,
    tenantId: tenant.id,
    slug: tenant.slug,
  });
  res.status(201).json({
    accessToken,
    user: publicUser(user),
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
  });
});
