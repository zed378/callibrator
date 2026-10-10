/**
 * P9-21 (ADR-097 / ADR-103) — the roles module's answer shapes, which the roles
 * controller writes. Since 2026-10-11 (ADR-137) they are the house envelope:
 * `{ success, status, message, data }`, a top-level `meta` on the two lists,
 * `data: null` on a removal and on a GET not found. The bodies below are the
 * ones roles.controller builds (see its handlers).
 */
import {
  menuGroupWithChildrenResponse,
  roleResponse,
  rolesAnswer,
  rolesListAnswer,
  rolesMessageAnswer,
  rolesNotFoundAnswer,
} from "@callibrator/contracts/roles";

const ROLE = {
  id: "6e5d4c3b-2a19-4f8e-9d7c-6b5a4f3e2d1c",
  name: "LAB TECHNICIAN",
  nameToShow: null,
  description: null,
  isSystem: false,
  status: "active",
  sortOrder: null,
  roleLevel: 5,
  isDeleted: false,
  createdAt: "2026-01-15T08:30:00.000Z",
  updatedAt: "2026-01-15T08:30:00.000Z",
  deletedAt: null,
};

describe("@callibrator/contracts/roles answers", () => {
  it("a list: { success, status, message, data: [...], meta } with meta a top-level sibling", () => {
    const body = { success: true, status: 200, message: "Roles retrieved", data: [ROLE], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } };
    expect(rolesListAnswer(roleResponse).parse(body)).toEqual(body);
    expect(rolesListAnswer(roleResponse).safeParse({ success: true, status: 200, message: "Roles retrieved", data: { rows: [ROLE] } }).success).toBe(false);
  });

  it("a record, a removal and a not-found", () => {
    expect(rolesAnswer(roleResponse).parse({ success: true, status: 200, message: "Role retrieved", data: ROLE }).data.roleLevel).toBe(5);
    expect(rolesMessageAnswer.parse({ success: true, status: 200, message: "Role deleted successfully", data: null }).message).toBe(
      "Role deleted successfully",
    );
    expect(rolesNotFoundAnswer.parse({ success: false, status: 404, message: "Role not found", data: null }).success).toBe(false);
    expect(rolesAnswer(roleResponse).safeParse({ success: false, status: 200, message: "x", data: ROLE }).success).toBe(false);
    // The pre-ADR-137 shapes (no status / message / data) no longer pass.
    expect(rolesAnswer(roleResponse).safeParse({ success: true, data: ROLE }).success).toBe(false);
    expect(rolesMessageAnswer.safeParse({ success: true, message: "Role deleted successfully" }).success).toBe(false);
    expect(rolesNotFoundAnswer.safeParse({ success: false, message: "Role not found" }).success).toBe(false);
  });

  it("a menu group with its children", () => {
    const menu = {
      id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      name: "Inventory",
      slug: "warehouse",
      icon: null,
      parentId: null,
      sortOrder: 3,
      isActive: true,
      createdAt: "2026-01-15T08:30:00.000Z",
      updatedAt: "2026-01-15T08:30:00.000Z",
      children: [{ id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", name: "Stock", slug: "stock", icon: null, sort_order: 1 }],
    };
    expect(menuGroupWithChildrenResponse.parse(menu).children).toHaveLength(1);
  });
});
