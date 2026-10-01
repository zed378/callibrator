/**
 * A-329 — a root tenant's tree lists its sub-organizations, and its
 * descendants are found.
 *
 * createSubOrganization writes a tenant_hierarchies row for the CHILD only; a
 * root parent has none (the child is placed under `/<root code>` with
 * parentCode = the root's code). getTenantTree(root) and
 * getDescendantTenants(root) looked for the root's OWN row, found none, and
 * answered an empty tree and `[]` — measured on PostgreSQL 18.6 in the P9-13
 * live probe. Now a row-less tenant is its own implicit root at `/<code>`.
 *
 * Also: the descendant LIKE was unescaped, and every generated child code has a
 * `_` (`ACME_001`), a single-character wildcard — so `/acme/acme_001/%` matched
 * `/acme/acmez001/…` too. It is escaped with the file's own subtreePattern.
 *
 * REAL service and models, with the tenant hooks, on fixtures/memoryDb, in the
 * super-admin context the hierarchy routes run in (the model's own note:
 * cross-tenant traversal needs it).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as Service from "../../services/tenantHierarchy.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as PlatformTenant from "../../constants/platformTenant";
import type { TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const svc = jest.requireActual<typeof Service>("../../services/tenantHierarchy.service");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");
const { PLATFORM_TENANT_ID } = jest.requireActual<typeof PlatformTenant>("../../constants/platformTenant");

const id = (n: number): TenantId => `a3290000-0000-4000-8000-${String(n).padStart(12, "0")}` as TenantId;
const ROOT = id(1);
const CHILD = id(2);
const GRANDCHILD = id(3);
const LOOKALIKE = id(4); // code ACMEZ001: matches `acme_001` if `_` is a wildcard
const LOOKALIKE_CHILD = id(5);
const OTHER_ROOT = id(6);

const asSuperAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    tenantStorage.run({ tenantId: PLATFORM_TENANT_ID as TenantId, isSuperAdmin: true, isSystemTask: false }, () => {
      fn().then(resolve, reject);
    });
  });

beforeEach(() => {
  mdb.reset();
  const tenant = (tid: TenantId, code: string, parentId: TenantId | null = null): Record<string, unknown> => ({
    id: tid,
    name: `Tenant ${code}`,
    code,
    subdomain: code.toLowerCase().replace(/_/g, "-"),
    email: `${code.toLowerCase()}@example.test`,
    status: "active",
    parentId,
  });
  mdb.seed("Tenant", [
    tenant(ROOT, "ACME"),
    tenant(CHILD, "ACME_001", ROOT),
    tenant(GRANDCHILD, "ACME_001_001", CHILD),
    tenant(LOOKALIKE, "ACMEZ001", ROOT),
    tenant(LOOKALIKE_CHILD, "ACMEZ001_001", LOOKALIKE),
    tenant(OTHER_ROOT, "BETA"),
  ]);
  // As createSubOrganization writes them: a row per child, none for a root.
  mdb.seed("TenantHierarchy", [
    { tenantId: CHILD, tenantCode: "ACME_001", parentCode: "ACME", path: "/acme/acme_001", depth: 1 },
    { tenantId: GRANDCHILD, tenantCode: "ACME_001_001", parentCode: "ACME_001", path: "/acme/acme_001/acme_001_001", depth: 2 },
    { tenantId: LOOKALIKE, tenantCode: "ACMEZ001", parentCode: "ACME", path: "/acme/acmez001", depth: 1 },
    { tenantId: LOOKALIKE_CHILD, tenantCode: "ACMEZ001_001", parentCode: "ACMEZ001", path: "/acme/acmez001/acmez001_001", depth: 2 },
  ]);
});

describe("A-329 — a root tenant without a hierarchy row", () => {
  it("getTenantTree(root) lists its children, as the implicit root at /<code>", async () => {
    const tree = await asSuperAdmin(() => svc.getTenantTree(ROOT));
    expect(tree).toMatchObject({ isRoot: true, depth: 0, path: "/acme" });
    expect(tree.children.map((c) => c.code).sort()).toEqual(["ACMEZ001", "ACME_001"]);
  });

  it("getDescendantTenants(root) finds the whole subtree", async () => {
    const descendants = await asSuperAdmin(() => svc.getDescendantTenants(ROOT));
    expect([...descendants].sort()).toEqual([CHILD, GRANDCHILD, LOOKALIKE, LOOKALIKE_CHILD].sort());
  });

  it("a `_` in a code is not a wildcard: ACME_001's descendants exclude ACMEZ001's subtree", async () => {
    const descendants = await asSuperAdmin(() => svc.getDescendantTenants(CHILD));
    expect(descendants).toEqual([GRANDCHILD]);
  });

  it("control: a root with no children answers an empty tree", async () => {
    const tree = await asSuperAdmin(() => svc.getTenantTree(OTHER_ROOT));
    expect(tree).toMatchObject({ isRoot: true, children: [] });
    expect(await asSuperAdmin(() => svc.getDescendantTenants(OTHER_ROOT))).toEqual([]);
  });

  it("control: a tenant that does not exist answers the empty root", async () => {
    expect(await asSuperAdmin(() => svc.getTenantTree(id(99)))).toEqual({ isRoot: true, children: [] });
    expect(await asSuperAdmin(() => svc.getDescendantTenants(id(99)))).toEqual([]);
  });

  it("control: a child's own tree is unchanged (its row, its children)", async () => {
    const tree = await asSuperAdmin(() => svc.getTenantTree(CHILD));
    expect(tree).toMatchObject({ isRoot: false, depth: 1, path: "/acme/acme_001" });
    expect(tree.children.map((c) => c.code)).toEqual(["ACME_001_001"]);
  });
});
