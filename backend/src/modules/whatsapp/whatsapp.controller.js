import { asyncHandler } from "../../shared/errors.js";
import { getConnectedNumber, getLastQr, getLastStatus } from "./whatsapp.bus.js";
import { getLiveness, requestLogout, requestRestart } from "./whatsapp.consumer.js";

export const getStatus = asyncHandler(async (_req, res) => {
  const [status, qr, liveness, me] = await Promise.all([
    getLastStatus(),
    getLastQr(),
    getLiveness(),
    getConnectedNumber(),
  ]);
  res.json({ status, qr, worker: liveness, me });
});

export const postLogout = asyncHandler(async (_req, res) => {
  await requestLogout();
  res.json({ ok: true });
});

export const postRestart = asyncHandler(async (_req, res) => {
  await requestRestart();
  res.json({ ok: true });
});
