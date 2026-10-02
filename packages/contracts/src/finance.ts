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

// ==========================================
// RESPONSES (P9-20/21, ADR-097 Am. 5: what the API answers, published code-first)
// ==========================================
// A record is `record.toJSON()` plus its computed `depreciation`; the DECIMAL
// figures read as numbers (D-21) and `purchaseDate` is a DATEONLY string. The
// list and a read by id include the device and vendor (soft-deleted ones too);
// a record just created or updated carries no association.

const timestamp = z.iso.datetime();
const rowId = z.guid();

/** The figures `finance.service#computeDepreciation` adds to a record (as of now). */
const depreciation = z
  .object({
    ageYears: z.number(),
    annualDepreciation: z.number(),
    accumulatedDepreciation: z.number(),
    bookValue: z.number(),
    fullyDepreciated: z.boolean(),
  })
  .meta({ id: "AssetDepreciation", description: "Depreciation as of now, rounded to 2 places." });

const assetFinanceFields = {
  id: rowId,
  tenantId: rowId,
  deviceId: rowId,
  purchasePrice: z.number().meta({ description: "DECIMAL(14,2), read as a number (D-21)" }),
  purchaseDate: z.iso.date().meta({ description: "DATEONLY: YYYY-MM-DD" }),
  salvageValue: z.number().meta({ description: "DECIMAL(14,2), read as a number (D-21)" }),
  usefulLifeYears: z.number().int(),
  depreciationMethod: z.enum(DEPRECIATION_METHODS),
  vendorId: rowId.nullable(),
  invoiceNumber: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
  depreciation,
};

const assetFinanceExample = {
  id: "6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d",
  tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
  deviceId: "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
  purchasePrice: 120000,
  purchaseDate: "2024-01-15",
  salvageValue: 10000,
  usefulLifeYears: 10,
  depreciationMethod: "straight_line",
  vendorId: null,
  invoiceNumber: "INV-0001",
  notes: null,
  createdAt: "2024-01-20T08:00:00.000Z",
  updatedAt: "2024-01-20T08:00:00.000Z",
  deletedAt: null,
  depreciation: { ageYears: 2.71, annualDepreciation: 11000, accumulatedDepreciation: 29810, bookValue: 90190, fullyDepreciated: false },
};

/** An asset finance record as created or updated (no associations). */
const assetFinanceResponse = z
  .object(assetFinanceFields)
  .meta({ id: "AssetFinance", description: "A device's purchase and depreciation record.", example: assetFinanceExample });

/** A record as listed or read by id: with the device and the vendor (soft-deleted ones included). */
const assetFinanceWithRefs = z
  .object({
    ...assetFinanceFields,
    device: z
      .object({ id: rowId, name: z.string(), serialNumber: z.string().nullable(), category: z.string().nullable(), status: z.string() })
      .nullable(),
    vendor: z.object({ id: rowId, name: z.string() }).nullable(),
  })
  .meta({ id: "AssetFinanceWithRefs", description: "A finance record with its device and vendor." });

/** One line of the depreciation report. */
const depreciationReportRow = z.object({
  financeId: rowId,
  deviceId: rowId,
  deviceName: z.string().meta({ description: "\"Unknown device\" when the device has no name" }),
  serialNumber: z.string().nullable(),
  purchaseDate: z.iso.date(),
  purchasePrice: z.number(),
  salvageValue: z.number(),
  usefulLifeYears: z.number().int(),
  method: z.enum(DEPRECIATION_METHODS),
  ageYears: z.number(),
  annualDepreciation: z.number(),
  accumulatedDepreciation: z.number(),
  bookValue: z.number(),
  fullyDepreciated: z.boolean(),
});

/** The depreciation report as JSON (`?format=csv` answers the same rows as a CSV file instead). */
const depreciationReport = z
  .object({
    asOf: timestamp,
    totals: z.object({
      totalPurchase: z.number(),
      totalAccumulatedDepreciation: z.number(),
      totalBookValue: z.number(),
      fullyDepreciatedCount: z.number().int(),
    }),
    count: z.number().int(),
    rows: z.array(depreciationReportRow),
  })
  .meta({
    id: "DepreciationReport",
    description: "Every record purchased on or before `asOf`, with its figures as of that date, and the totals.",
    example: { asOf: "2026-10-01T00:00:00.000Z", totals: { totalPurchase: 0, totalAccumulatedDepreciation: 0, totalBookValue: 0, fullyDepreciatedCount: 0 }, count: 0, rows: [] },
  });

export { createAssetFinance, updateAssetFinance };
export { DEPRECIATION_METHODS, assetFinanceResponse, assetFinanceWithRefs, depreciationReport };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateAssetFinanceInput = z.input<typeof createAssetFinance>;
export type CreateAssetFinanceBody = z.output<typeof createAssetFinance>;
export type UpdateAssetFinanceInput = z.input<typeof updateAssetFinance>;
export type UpdateAssetFinanceBody = z.output<typeof updateAssetFinance>;
