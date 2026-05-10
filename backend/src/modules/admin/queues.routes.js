// Bull-Board mount at /admin/queues. Auth-gated to ADMIN+.
//
// Auth handoff: Bull-Board navigates with normal HTML links that don't
// carry the Authorization header (the JWT lives in localStorage on the
// frontend, never in a cookie by default). Two-step solution:
//
//   1. First hit ships ?token=<jwt> in the URL (sidebar builds this URL
//      from the auth store).
//   2. Middleware copies the token into a short-lived httpOnly cookie
//      scoped to /admin/queues, then 302-redirects to the clean URL so
//      the token doesn't linger in browser history.
//   3. Subsequent in-app navigation within Bull-Board carries the cookie,
//      and the middleware injects its value as a Bearer header before
//      requireAuth runs.

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { getQueue, QUEUES } from "../../shared/queue.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

const COOKIE_NAME = "sa_queues_token";
const COOKIE_TTL_MS = 15 * 60 * 1000; // matches default JWT_ACCESS_TTL

export function mountBullBoard(app) {
  const adapter = new ExpressAdapter();
  adapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: Object.values(QUEUES).map((name) => new BullMQAdapter(getQueue(name))),
    serverAdapter: adapter,
  });

  app.use(
    "/admin/queues",
    (req, res, next) => {
      const queryToken = req.query.token;
      if (queryToken) {
        // Persist for subsequent navigation, then strip from URL via redirect.
        res.cookie(COOKIE_NAME, queryToken, {
          httpOnly: true,
          sameSite: "lax",
          path: "/admin/queues",
          maxAge: COOKIE_TTL_MS,
        });
        const cleanUrl =
          req.originalUrl.replace(/[?&]token=[^&]*/, "").replace(/\?$/, "") ||
          req.path;
        return res.redirect(cleanUrl);
      }
      // Hydrate Authorization from cookie set on first hit.
      const cookieToken = req.cookies?.[COOKIE_NAME];
      if (cookieToken && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${cookieToken}`;
      }
      next();
    },
    requireAuth,
    requireRole("SUPER_ADMIN", "ADMIN"),
    adapter.getRouter(),
  );
}
