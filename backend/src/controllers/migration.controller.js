const { Up, Down } = require("../config/migrate");
const migrationService = require("../services/migration.service");
const { success } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");

// ==========================================
// MIGRATE
// ==========================================

exports.migrate = asyncHandler(async (req, res) => {
  await Up();
  success(res, null, null, "Database table migrate success", 200);
});

// ==========================================
// DROP TABLE
// ==========================================

exports.dropTable = asyncHandler(async (req, res) => {
  await Down();
  success(res, null, null, "Database table drop successfully", 200);
});

// ==========================================
// SEEDING
// ==========================================

exports.seeding = asyncHandler(async (req, res) => {
  const result = await migrationService.seedAll();
  success(res, result, null, "Seeding success", 200);
});

// ==========================================
// UNSEEDING
// ==========================================

exports.unseeding = asyncHandler(async (req, res) => {
  const result = await migrationService.unseedAll();
  success(res, result, null, "Unseeding success", 200);
});

// ==========================================
// DEMO DATA SEEDING
// ==========================================

exports.seedDemo = asyncHandler(async (req, res) => {
  const result = await migrationService.seedDemoData();
  success(res, result, null, "Demo data seeding success", 200);
});
