/**
 * A-226 / A-271 — a menu group's parent could be the group itself or one of
 * its descendants.
 *
 * `menuGroup.service#updateMenuGroup` (and its twin on the other write path,
 * `roles.service#updateMenu`, A-271) wrote any `parentId`. Either choice makes
 * a loop: the group and its subtree drop out of the sidebar (they are
 * reachable from no top-level group) and the grant inheritance walks a cycle.
 * A parent that does not exist was a foreign-key violation, answered 500.
 *
 * A small menu tree held in memory stands in for `menu_groups`; writes and
 * audit rows go through the auditLedger (real audit ENUM, real rollback,
 * `cls: false` so every write must carry its transaction).
 *
 *   root ─ reports ─ monthly ─ archive
 *        └ settings
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, tree: {} };

const mockRow = (fields) => {
  const row = { children: [], icon: null, sortOrder: 0, isActive: true, slug: fields.name.toLowerCase(), ...fields };
  row.update = async (values, options) => {
    mockRef.ledger.write("menu_groups", { id: row.id, ...values }, options);
    Object.assign(row, values);
    return row;
  };
  return row;
};

jest.mock("../../models", () => ({
  Role: {},
  User: {},
  MenuGroup: {
    findByPk: async (id) => mockRef.tree[id] || null,
    create: async (values, options) => {
      mockRef.ledger.write("menu_groups", values, options);
      return { id: "mg-new", children: [], ...values };
    },
  },
  RoleMenuPermission: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(async () => undefined),
  cacheKeys: { permissions: (id) => `perm:${id}` },
}));

const menuGroupService = require("../../services/menuGroup.service");
const RolesService = require("../../services/roles.service");

const actor = { userId: "super-1", tenantId: "home-tenant", ipAddress: "10.0.0.7", userAgent: "UA" };

const ROOT = "00000000-0000-4000-8000-000000000001";
const REPORTS = "00000000-0000-4000-8000-000000000002";
const MONTHLY = "00000000-0000-4000-8000-000000000003";
const ARCHIVE = "00000000-0000-4000-8000-000000000004";
const SETTINGS = "00000000-0000-4000-8000-000000000005";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  mockRef.tree = Object.fromEntries(
    [
      mockRow({ id: ROOT, name: "Root", parentId: null }),
      mockRow({ id: REPORTS, name: "Reports", parentId: ROOT }),
      mockRow({ id: MONTHLY, name: "Monthly", parentId: REPORTS }),
      mockRow({ id: ARCHIVE, name: "Archive", parentId: MONTHLY }),
      mockRow({ id: SETTINGS, name: "Settings", parentId: ROOT }),
    ].map((r) => [r.id, r]),
  );
});

const nothingWritten = () => {
  expect(mockRef.ledger.committed("menu_groups")).toEqual([]);
  expect(mockRef.ledger.auditRows()).toEqual([]);
};

const PATHS = [
  ["menuGroup.service#updateMenuGroup", (id, parentId) => menuGroupService.updateMenuGroup({ id, parentId }, actor)],
  ["roles.service#updateMenu (A-271)", (id, parentId) => RolesService.updateMenu(id, { parent_id: parentId }, actor)],
];

describe.each(PATHS)("%s", (_name, move) => {
  it("refuses a group as its own parent: 409, nothing written", async () => {
    await expect(move(REPORTS, REPORTS)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/cannot be its own parent/),
    });
    nothingWritten();
    expect(mockRef.tree[REPORTS].parentId).toBe(ROOT);
  });

  it("refuses a direct child as the parent: 409 naming it", async () => {
    await expect(move(REPORTS, MONTHLY)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/"Monthly" is inside the group being moved/),
    });
    nothingWritten();
  });

  it("refuses a deeper descendant as the parent", async () => {
    await expect(move(ROOT, ARCHIVE)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/"Archive" is inside the group being moved/),
    });
    nothingWritten();
  });

  it("refuses a parent that does not exist: 404, not a foreign-key 500", async () => {
    await expect(move(REPORTS, MISSING)).rejects.toMatchObject({ status: 404, message: "Parent menu group not found" });
    nothingWritten();
  });

  it("moves a group under a group outside its subtree, with its audit row", async () => {
    await move(MONTHLY, SETTINGS);

    expect(mockRef.tree[MONTHLY].parentId).toBe(SETTINGS);
    expect(mockRef.ledger.committed("menu_groups")).toHaveLength(1);
    expect(mockRef.ledger.auditRows()).toHaveLength(1);
  });

  it("moves a group to the top level (null parent) without a lookup", async () => {
    await move(MONTHLY, null);
    expect(mockRef.tree[MONTHLY].parentId).toBeNull();
  });

  it("a loop already in the data, elsewhere, does not hang the check or block the edit", async () => {
    mockRef.tree[SETTINGS].parentId = MONTHLY; // Settings -> Monthly -> Reports -> Root -> (null)
    mockRef.tree[ROOT].parentId = SETTINGS; // ... Root -> Settings: a pre-existing loop
    await move(ARCHIVE, REPORTS); // Archive is a leaf: moving it cannot close a loop through it
    expect(mockRef.tree[ARCHIVE].parentId).toBe(REPORTS);
  });

  it("an ancestor chain that ends at a dangling id is accepted", async () => {
    mockRef.tree[ROOT].parentId = MISSING;
    await move(MONTHLY, SETTINGS);
    expect(mockRef.tree[MONTHLY].parentId).toBe(SETTINGS);
  });
});

describe("A-226 — creating a group", () => {
  it("under a parent that does not exist is 404, nothing written", async () => {
    await expect(menuGroupService.createMenuGroup({ name: "Orphan", parentId: MISSING }, actor)).rejects.toMatchObject({
      status: 404,
    });
    await expect(RolesService.createMenu({ name: "Orphan", parent_id: MISSING }, actor)).rejects.toMatchObject({
      status: 404,
    });
    nothingWritten();
  });

  it("under an existing parent is created", async () => {
    await menuGroupService.createMenuGroup({ name: "Weekly", parentId: REPORTS }, actor);
    expect(mockRef.ledger.committed("menu_groups")).toHaveLength(1);
  });
});
