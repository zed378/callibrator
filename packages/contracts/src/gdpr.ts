/**
 * GDPR/CCPA Validators.
 *
 * P9-11 (ADR-093): moved to Zod; the file's `validate` helper, which nothing
 * called, is gone (`validators/input` is the one helper).
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/gdpr.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the gdpr routes.
 */
import { z } from "zod";
import { booleanish, email } from "./fields";

/** Validate erasure request. */
const requestErasure = z.object({
  reason: z.string().min(1).max(500),
  confirm: booleanish().pipe(z.literal(true, { error: "confirm must be true" })),
});

/** Validate consent update. */
const updateConsent = z.object({
  categories: z.array(z.enum(["analytics", "marketing", "functional", "necessary"])),
  consent: booleanish(),
});

/** Validate data rectification. */
const rectifyData = z.object({
  field: z.string().min(1).max(100),
  value: z.unknown().refine((v) => v !== undefined, { error: "value is required" }),
  // A-214: an email change needs fresh re-authentication (the service
  // decides which of these it requires; other fields ignore them).
  currentPassword: z.string().min(1).max(1024).optional(),
  code: z.string().min(1).max(32).optional(),
  recoveryCode: z.string().min(1).max(64).optional(),
});

/** Validate processing restriction. */
const restrictProcessing = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * A rectified email address, already trimmed and lower-cased by gdpr.service
 * (the model's `isEmail` would otherwise throw inside the transaction — a 500).
 */
const rectifiedEmailSchema = email().max(255);

export { requestErasure, updateConsent, rectifyData, restrictProcessing, rectifiedEmailSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type RequestErasureInput = z.input<typeof requestErasure>;
export type RequestErasureBody = z.output<typeof requestErasure>;
export type UpdateConsentInput = z.input<typeof updateConsent>;
export type UpdateConsentBody = z.output<typeof updateConsent>;
export type RectifyDataInput = z.input<typeof rectifyData>;
export type RectifyDataBody = z.output<typeof rectifyData>;
export type RestrictProcessingInput = z.input<typeof restrictProcessing>;
export type RestrictProcessingBody = z.output<typeof restrictProcessing>;
export type RectifiedEmailInput = z.input<typeof rectifiedEmailSchema>;
export type RectifiedEmailBody = z.output<typeof rectifiedEmailSchema>;
