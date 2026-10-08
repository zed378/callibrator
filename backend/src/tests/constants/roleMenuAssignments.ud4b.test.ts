/**
 * P20-06 — UD-4 (b) (working decision 2026-10-08) in the seed's own source of grants,
 * `ROLE_MENU_ASSIGNMENTS`: the two technician roles hold an explicit `calibration: write` row and no
 * other role's explicit row on `calibration` was added; the three new slugs carry exactly the
 * explicit rows of spec MEMORY/specs/P18-01-02 § 3.1 (inherited cells need none — those are
 * proved on the seeded matrix by services/effectivePermission.ud4b.test.ts).
 */
import { MENU_SLUGS, PERMISSION_TYPES, ROLE_MENU_ASSIGNMENTS, ROLE_NAMES } from "../../constants/roleConstants";

const rowsOn = (slug: string): string[] =>
  ROLE_MENU_ASSIGNMENTS.flatMap((a) => (slug in a.menus ? [`${a.roleName}|${String((a.menus as Record<string, string>)[slug])}`] : [])).sort();

describe("UD-4 (b) and the P20-06 slugs in ROLE_MENU_ASSIGNMENTS", () => {
  it("`calibration` has explicit rows for exactly TECHNICIAN and HEALTHCARE TECHNICIAN, both write", () => {
    expect(MENU_SLUGS.CALIBRATION).toBe("calibration");
    expect(rowsOn(MENU_SLUGS.CALIBRATION)).toEqual([`${ROLE_NAMES.HEALTHCARE_TECHNICIAN}|write`, `${ROLE_NAMES.TECHNICIAN}|write`]);
  });

  it("FACILITY MAINTENANCE, SUPERVISOR, ENGINEERING MANAGER, ROOM USER, WAREHOUSE STAFF and USER are not widened", () => {
    const holders = rowsOn(MENU_SLUGS.CALIBRATION).map((r) => r.split("|")[0]);
    for (const role of [ROLE_NAMES.FACILITY_MAINTENANCE, ROLE_NAMES.SUPERVISOR, ROLE_NAMES.ENGINEERING_MANAGER, ROLE_NAMES.ROOM_USER, ROLE_NAMES.WAREHOUSE_STAFF, ROLE_NAMES.USER]) {
      expect(holders).not.toContain(role);
    }
  });

  it("the three new slugs carry the explicit rows of § 3.1", () => {
    expect([MENU_SLUGS.IPM, MENU_SLUGS.IPM_TEMPLATES, MENU_SLUGS.CLIENT_FACILITIES]).toEqual(["ipm", "ipm-templates", "client-facilities"]);
    expect(rowsOn(MENU_SLUGS.IPM)).toEqual(["FACILITY MAINTENANCE|write", "HEALTHCARE TECHNICIAN|write", "SUPERADMIN|write", "TECHNICIAN|write"]);
    expect(rowsOn(MENU_SLUGS.IPM_TEMPLATES)).toEqual(["SUPERADMIN|write"]);
    expect(rowsOn(MENU_SLUGS.CLIENT_FACILITIES)).toEqual([
      "CALIBRATOR ADMIN|write",
      "ENGINEERING MANAGER|read",
      "HEALTHCARE ADMIN|write",
      "SUPERADMIN|write",
    ]);
    expect(PERMISSION_TYPES.WRITE).toBe("write");
  });
});
