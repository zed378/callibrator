/**
 * Migrations and seeding over HTTP, `/api/v1/migration` (internal).
 *
 * P9-18 (ADR-087): converted from migration.controller.js, behaviour
 * unchanged. `Up` and `Down`, `success` and `asyncHandler` are captured at
 * load, as the `.js` destructured them; the service is read through its module
 * object at call time. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import migrate from "../config/migrate";
import migrationService from "../services/migration.service";
import { success as loadedSuccess } from "../utils/response.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";

const { Up, Down } = migrate;
const success = loadedSuccess;
const asyncHandler = loadedAsyncHandler;

// ==========================================
// MIGRATE
// ==========================================

const migrateHandler = asyncHandler(async (_req: Request, res: Response) => {
  await Up();
  success(res, null, null, "Database table migrate success", 200);
});

// ==========================================
// DROP TABLE
// ==========================================

const dropTable = asyncHandler(async (_req: Request, res: Response) => {
  await Down();
  success(res, null, null, "Database table drop successfully", 200);
});

// ==========================================
// SEEDING
// ==========================================

const seeding = asyncHandler(async (_req: Request, res: Response) => {
  const result = await migrationService.seedAll();
  success(res, result, null, "Seeding success", 200);
});

// ==========================================
// UNSEEDING
// ==========================================

const unseeding = asyncHandler(async (_req: Request, res: Response) => {
  const result = await migrationService.unseedAll();
  success(res, result, null, "Unseeding success", 200);
});

// ==========================================
// DEMO DATA SEEDING
// ==========================================

const seedDemo = asyncHandler(async (_req: Request, res: Response) => {
  const result = await migrationService.seedDemoData();
  success(res, result, null, "Demo data seeding success", 200);
});

const controller = { migrate: migrateHandler, dropTable, seeding, unseeding, seedDemo };

export = controller;
