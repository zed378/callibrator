/**
 * N-01 / V-15 guard — the super admin is recognised by ONE predicate.
 *
 * Before N-01 about twenty call sites open-coded the role-name comparison and
 * disagreed: session.controller accepted only "SUPER_ADMIN" (the seeded name
 * is "SUPERADMIN", so revoke-all was 403 for every caller who could reach it),
 * tenantHierarchy.route and auth.middleware#superAdminOnly accepted only
 * "SUPERADMIN" (V-15). utils/role.util.ts is now the only place the spellings
 * are listed; this file:
 *
 *  1. proves the predicate treats both spellings identically, and nothing else
 *     as the super admin;
 *  2. fails the build on a new string comparison of either spelling (or of
 *     ROLE_NAMES.SUPER_ADMIN) anywhere in backend/src outside role.util.ts,
 *     tests and migrations.
 *
 * `rbac(["SUPERADMIN"])` arrays are NOT comparisons: rbac itself recognises
 * the super admin through the predicate.
 */
import fs from "node:fs";
import path from "node:path";
import type * as RoleUtil from "../../utils/role.util";
import type * as RoleConstants from "../../constants/roleConstants";

const { isSuperAdmin, isSuperAdminRoleName, SUPER_ADMIN_ROLE_NAMES } = jest.requireActual<typeof RoleUtil>(
  "../../utils/role.util",
);
const { ROLE_NAMES } = jest.requireActual<typeof RoleConstants>("../../constants/roleConstants");

const SRC = path.resolve(__dirname, "../..");
const ROLE_UTIL = path.join(SRC, "utils", "role.util.ts");

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return full === path.join(SRC, "tests") || full === path.join(SRC, "migrations") ? [] : sourceFiles(full);
    }
    return /\.(c|m)?(j|t)s$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });

const NAME = String.raw`(?:["'\x60](?:SUPER_ADMIN|SUPERADMIN)["'\x60]|ROLE_NAMES\.SUPER_ADMIN)`;
const COMPARISON = new RegExp(
  String.raw`(?:[!=]==?\s*${NAME})|(?:${NAME}\s*[!=]==?)|(?:\[\s*["'](?:SUPER_ADMIN|SUPERADMIN)["']\s*,[^\]]*\]\s*\.includes)|(?:new Set[^;]*["'](?:SUPER_ADMIN|SUPERADMIN)["'])`,
);

/**
 * Reviewed lines that match the pattern and are NOT a role-name check.
 * Each is the exact trimmed line text.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // Filters the KEYS of ROLE_NAMES (the constant name), not a principal's role.
  '.filter(([key]) => key !== "SUPER_ADMIN")': "services/migration.service.js — a ROLE_NAMES key, not a role name",
};

describe("N-01 / V-15 — the one super-admin predicate", () => {
  it("recognises both spellings identically", () => {
    expect(isSuperAdminRoleName(ROLE_NAMES.SUPER_ADMIN)).toBe(true);
    expect(isSuperAdminRoleName("SUPER_ADMIN")).toBe(true);
    expect(isSuperAdmin({ role: { name: "SUPERADMIN" } })).toBe(isSuperAdmin({ role: { name: "SUPER_ADMIN" } }));
    expect([...SUPER_ADMIN_ROLE_NAMES].sort()).toEqual(["SUPERADMIN", "SUPER_ADMIN"].sort());
  });

  it.each([
    ["a tenant admin", { role: { name: "HEALTHCARE ADMIN" } }],
    ["a lower-case spelling", { role: { name: "superadmin" } }],
    ["a spaced spelling", { role: { name: "SUPER ADMIN" } }],
    ["no role", { role: null }],
    ["no principal", undefined],
    ["a non-string name", { role: { name: 10 } }],
  ])("does not treat %s as the super admin", (_label, principal) => {
    expect(isSuperAdmin(principal)).toBe(false);
  });

  it("no source file outside utils/role.util.ts compares a super-admin role name by string", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file === ROLE_UTIL) {
        continue;
      }
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
          return;
        }
        if (COMPARISON.test(line) && !(trimmed in ALLOWED)) {
          offenders.push(`${path.relative(SRC, file)}:${String(index + 1)}: ${trimmed}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the pattern catches the N-01 and V-15 shapes it exists for", () => {
    for (const shape of [
      'const isAdmin = req.user.role?.name === "SUPER_ADMIN";',
      "if (req.user?.role?.name === ROLE_NAMES.SUPER_ADMIN) {",
      'return name === "SUPER_ADMIN" || name === "SUPERADMIN";',
      '["SUPER_ADMIN", "SUPERADMIN"].includes(found.role?.name)',
      'const S = new Set(["SUPER_ADMIN", "SUPERADMIN"]);',
    ]) {
      expect(COMPARISON.test(shape)).toBe(true);
    }
    expect(COMPARISON.test('router.get("/", auth, rbac(["SUPERADMIN"]), handler);')).toBe(false);
  });
});
