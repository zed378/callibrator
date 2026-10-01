/**
 * Tenant backup request bodies.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/tenantBackup.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the tenantBackup routes.
 */
import { z } from "zod";
import { booleanish, numeric, optionalText } from "./fields";

const createBackupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: optionalText(500),
  backupType: z.enum(["FULL", "PARTIAL", "USER_ONLY"]).default("FULL"),
  retentionDays: numeric(z.number().int().min(1).max(365)).default(90),
  tag: optionalText(50),
});

const restoreBackupSchema = z.object({
  mergeData: booleanish().default(false),
});

export { createBackupSchema, restoreBackupSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateBackupInput = z.input<typeof createBackupSchema>;
export type CreateBackupBody = z.output<typeof createBackupSchema>;
export type RestoreBackupInput = z.input<typeof restoreBackupSchema>;
export type RestoreBackupBody = z.output<typeof restoreBackupSchema>;
