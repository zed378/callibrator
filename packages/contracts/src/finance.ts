/**
 * Asset finance request bodies.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/finance.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the finance routes.
 */
import { z } from "zod";
import { isoDate, numeric, optionalText, uuid } from "./fields";

const DEPRECIATION_METHODS = ["straight_line", "declining_balance"] as const;

const createAssetFinance = z.object({
  deviceId: uuid(),
  purchasePrice: numeric(z.number().min(0)),
  purchaseDate: isoDate(),
  salvageValue: numeric(z.number().min(0)).default(0),
  usefulLifeYears: numeric(z.number().int().min(1).max(50)),
  depreciationMethod: z.enum(DEPRECIATION_METHODS).default("straight_line"),
  vendorId: uuid().nullable().optional(),
  invoiceNumber: optionalText(100),
  notes: optionalText(),
});

const updateAssetFinance = z.object({
  purchasePrice: numeric(z.number().min(0)).optional(),
  purchaseDate: isoDate().optional(),
  salvageValue: numeric(z.number().min(0)).optional(),
  usefulLifeYears: numeric(z.number().int().min(1).max(50)).optional(),
  depreciationMethod: z.enum(DEPRECIATION_METHODS).optional(),
  vendorId: uuid().nullable().optional(),
  invoiceNumber: optionalText(100),
  notes: optionalText(),
});

export { createAssetFinance, updateAssetFinance };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateAssetFinanceInput = z.input<typeof createAssetFinance>;
export type CreateAssetFinanceBody = z.output<typeof createAssetFinance>;
export type UpdateAssetFinanceInput = z.input<typeof updateAssetFinance>;
export type UpdateAssetFinanceBody = z.output<typeof updateAssetFinance>;
