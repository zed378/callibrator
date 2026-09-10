/**
 * Credential Rotation Script
 *
 * Purpose: Rotate default/hardcoded super-admin credentials
 * Usage: node scripts/rotate-default-credentials.js
 *
 * This script:
 * 1. Generates a cryptographically secure random password
 * 2. Hashes it with bcrypt (cost factor 12)
 * 3. Updates the first super-admin user in the database
 * 4. Outputs the new password to secure console output
 *
 * SECURITY NOTE: In production, use environment variables or a secrets manager
 * to set initial credentials. Never hardcode them in source code.
 */

require("dotenv").config({ path: ".env" });
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { db } = require("../config");
const { Users, Role } = require("../models");

const BCRYPT_ROUNDS = 12;

async function rotateCredentials() {
  console.log("=".repeat(60));
  console.log("CREDENTIAL ROTATION SCRIPT");
  console.log("=".repeat(60));

  try {
    // Connect to database
    await db.authenticate();
    console.log("[OK] Database connection established");

    // Find super-admin user
    const adminRole = await Role.findOne({
      where: { name: "SUPER_ADMIN" },
    });

    if (!adminRole) {
      console.error(
        "[ERROR] SUPER_ADMIN role not found. Create the role first.",
      );
      process.exit(1);
    }

    const adminUser = await Users.findOne({
      where: { roleId: adminRole.id },
      include: [{ model: Role, as: "role", attributes: ["id", "name"] }],
    });

    if (!adminUser) {
      console.error("[ERROR] No SUPER_ADMIN user found. Create a user first.");
      process.exit(1);
    }

    console.log(
      `[INFO] Found super-admin user: ${adminUser.email} (ID: ${adminUser.id})`,
    );

    // Generate cryptographically secure random password
    const newPassword = crypto.randomBytes(20).toString("hex");
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Update the user
    await Users.update(
      { password: hashedPassword },
      { where: { id: adminUser.id } },
    );

    console.log("=".repeat(60));
    console.log("[SUCCESS] Password rotated successfully!");
    console.log("=".repeat(60));
    console.log("");
    console.log("NEW PASSWORD: " + newPassword);
    console.log("");
    console.log("IMPORTANT:");
    console.log(
      "1. Copy this password immediately - it will NOT be shown again",
    );
    console.log("2. Store it in a secure password manager");
    console.log("3. Consider enabling MFA for this account");
    console.log("4. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET env vars");
    console.log("=".repeat(60));

    // Log the rotation
    console.log("");
    console.log("[INFO] Rotation logged. Do NOT commit this output.");
  } catch (err) {
    console.error("[ERROR] Credential rotation failed:", err.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

rotateCredentials();
