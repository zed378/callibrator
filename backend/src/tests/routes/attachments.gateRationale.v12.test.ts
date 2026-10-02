/**
 * V-12 — the attachments gating rationale states what is actually true.
 *
 * attachments.route.ts said "There is NO `attachments` slug in MENU_SLUGS".
 * False: the slug is seeded (seedMenuGroups.util.js, parent `mgmt-content`)
 * and, since ADR-102, is MENU_SLUGS.ATTACHMENTS. The real reason the gates use
 * `equipment` is the ROLE ASSIGNMENTS: `attachments` is granted to three roles,
 * `equipment:read` to every role. The facts the corrected comment rests on are
 * asserted here, so the comment cannot drift from them again unnoticed.
 */
import fs from "node:fs";
import path from "node:path";
import type * as RoleConstants from "../../constants/roleConstants";

const { ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = jest.requireActual<typeof RoleConstants>("../../constants/roleConstants");

const ROUTE = path.resolve(__dirname, "../../routes/api/attachments.route.ts");
const SEED = path.resolve(__dirname, "../../utils/seedMenuGroups.util.ts");

const grant = (roleName: string, slug: string): string | undefined => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((r) => r.roleName === roleName);
  return (entry?.menus as Record<string, string> | undefined)?.[slug];
};

describe("V-12 — attachments.route.ts gating rationale", () => {
  it("no longer claims the attachments slug does not exist", () => {
    expect(fs.readFileSync(ROUTE, "utf8")).not.toContain("There is NO `attachments` slug");
  });

  it("the slug IS seeded and IS a MENU_SLUGS value", () => {
    expect(MENU_SLUGS.ATTACHMENTS).toBe("attachments");
    expect(fs.readFileSync(SEED, "utf8")).toMatch(/slug:\s*"attachments"/);
  });

  it("every role holds equipment:read or better — the gate the route uses", () => {
    const tenantRoles = ROLE_MENU_ASSIGNMENTS.filter((r) => r.roleName !== "SUPERADMIN");
    for (const role of tenantRoles) {
      expect([role.roleName, grant(role.roleName, MENU_SLUGS.EQUIPMENT)]).toEqual([role.roleName, expect.stringMatching(/^(read|write)$/)]);
    }
  });

  it("technicians hold no attachments grant — why re-pointing the gate needs seeding first", () => {
    expect(grant("TECHNICIAN", MENU_SLUGS.ATTACHMENTS)).toBeUndefined();
    expect(grant("TECHNICIAN", MENU_SLUGS.EQUIPMENT)).toBe("read");
  });
});
