import { z } from "zod";

const tag = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Z0-9_]+$/, "tag must be UPPERCASE letters, digits, or underscores");

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(120),
  tag,
  isActive: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().optional(),
  onboardingMessage: z.string().min(1).max(2000),
  // Friendly text appended after the tag in the wa.me prefill.
  // Optional — leave empty to send just the tag.
  entryMessage: z.string().max(500).nullable().optional(),
  formLink: z.string().url().nullable().optional(),
  businessType: z.string().max(80).nullable().optional(),
  kbGroupIds: z.array(z.string()).default([]),
});

export const updateCampaignSchema = createCampaignSchema.partial();
