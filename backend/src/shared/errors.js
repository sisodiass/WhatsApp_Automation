import { child } from "./logger.js";

const log = child("http");

export class AppError extends Error {
  constructor(message, status = 500, code = "internal_error", details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Unauthorized = (msg = "unauthorized") => new AppError(msg, 401, "unauthorized");
export const Forbidden = (msg = "forbidden") => new AppError(msg, 403, "forbidden");
export const NotFound = (msg = "not found") => new AppError(msg, 404, "not_found");
export const BadRequest = (msg = "bad request", details) =>
  new AppError(msg, 400, "bad_request", details);
export const Conflict = (msg = "conflict", details) =>
  new AppError(msg, 409, "conflict", details);

// Express requires the 4-arg signature so it recognises this as an error middleware.
// eslint-disable-next-line no-unused-vars
export function errorMiddleware(err, req, res, _next) {
  if (err instanceof AppError) {
    if (err.status >= 500) log.error("app error", { err: err.message, status: err.status });
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  log.error("unhandled error", { err: err.message, stack: err.stack });
  res.status(500).json({ error: { code: "internal_error", message: "Internal server error" } });
}

// Wrap async route handlers so thrown errors flow into the middleware.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
