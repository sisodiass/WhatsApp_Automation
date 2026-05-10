import { asyncHandler } from "../../shared/errors.js";
import { getFullHealth } from "./health.service.js";

export const full = asyncHandler(async (_req, res) => {
  const h = await getFullHealth();
  res.status(h.status === "red" ? 503 : 200).json(h);
});
