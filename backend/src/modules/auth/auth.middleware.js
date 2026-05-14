import { Forbidden, Unauthorized } from "../../shared/errors.js";
import { verifyAccessToken } from "./auth.service.js";

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(Unauthorized("missing bearer token"));
  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, role: payload.role, tenantId: payload.tid };
    // Many controllers read `req.user.{id,role,tenantId}` — populate that
    // shape too so we have one source of truth without rewriting every
    // call site. (Both shapes carry the same data.)
    req.user = { id: payload.sub, role: payload.role, tenantId: payload.tid };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...allowed) {
  return (req, _res, next) => {
    if (!req.auth) return next(Unauthorized());
    if (!allowed.includes(req.auth.role)) return next(Forbidden("insufficient role"));
    next();
  };
}
