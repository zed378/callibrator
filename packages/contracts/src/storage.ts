/**
 * A tenant's storage override. `local` is intentionally NOT accepted here — it
 * is the platform default only; letting a tenant point the local driver at a
 * server path would be an arbitrary filesystem read/write primitive.
 *
 * P9-11 (ADR-093): moved to Zod. The per-provider condition is a union
 * discriminated on `provider`; each branch refuses the other provider's keys,
 * as `forbidden()` did.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/storage.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the storage routes.
 */
import { z } from "zod";
import { booleanish, optionalText } from "./fields";

/** A key that belongs to the other provider: present at all, and it is refused. */
const notForThisProvider = z.never({ error: "Not allowed for this provider" }).optional();

const s3 = z.object({
  provider: z.literal("s3"),
  bucket: z.string().trim().min(1).max(255),
  region: z.string().trim().min(1).max(64).optional(),
  endpoint: z.string().trim().pipe(z.url().max(255).or(z.literal(""))).nullable().optional(),
  forcePathStyle: booleanish().optional(),
  prefix: optionalText(255),
  accessKeyId: optionalText(255),
  secretAccessKey: optionalText(255),
  root: notForThisProvider,
  fsync: notForThisProvider,
});

const nfs = z.object({
  provider: z.literal("nfs"),
  root: z.string().trim().min(1).max(1024),
  fsync: booleanish().optional(),
  bucket: notForThisProvider,
  region: notForThisProvider,
  endpoint: notForThisProvider,
  forcePathStyle: notForThisProvider,
  prefix: notForThisProvider,
  accessKeyId: notForThisProvider,
  secretAccessKey: notForThisProvider,
});

const updateStorageSettingsSchema = z.discriminatedUnion("provider", [s3, nfs]);

export { updateStorageSettingsSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type UpdateStorageSettingsInput = z.input<typeof updateStorageSettingsSchema>;
export type UpdateStorageSettingsBody = z.output<typeof updateStorageSettingsSchema>;
