import { tenantHierarchyService } from "./tenantHierarchy.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

const BASE = "/api/v1/tenant-hierarchy";
const TENANT = "tenant-1";

describe("tenantHierarchyService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getTree", () => {
    // Verified live: the payload is the caller's own hierarchy position plus
    // direct children — there is no `root` wrapper and no `totalNodes`.
    it("sends no params — the backend scopes the tree to the caller", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          isRoot: false,
          depth: 1,
          path: "/hq/branch",
          tenant: { id: TENANT, name: "Branch", code: "BR", status: "ACTIVE" },
          children: [
            { tenantId: "c1", code: "C1", name: "Child", status: "ACTIVE", depth: 2 },
          ],
        }),
      );

      const res = await tenantHierarchyService.getTree();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/tree`);
      expect(res.isRoot).toBe(false);
      expect(res.children).toHaveLength(1);
      expect(res.children[0].tenantId).toBe("c1");
    });

    it("handles a tenant with no hierarchy row", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ isRoot: true, children: [] }));

      const res = await tenantHierarchyService.getTree();

      expect(res.isRoot).toBe(true);
      expect(res.children).toEqual([]);
    });
  });

  describe("getParent", () => {
    it("unwraps data.parent", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ parent: { id: "parent-1", name: "HQ" } }),
      );

      const res = await tenantHierarchyService.getParent(TENANT);

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/${TENANT}/parent`);
      expect(res?.id).toBe("parent-1");
    });

    it("returns null for a root tenant", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ parent: null }));
      await expect(tenantHierarchyService.getParent(TENANT)).resolves.toBeNull();
    });
  });

  describe("getChildren", () => {
    it("unwraps data.children and derives the total", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ children: [{ id: "c1" }, { id: "c2" }] }),
      );

      const res = await tenantHierarchyService.getChildren(TENANT);

      // Not paginated — no page/limit params are sent.
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/${TENANT}/children`);
      expect(res.children).toHaveLength(2);
      expect(res.total).toBe(2);
    });

    it("returns an empty result when there are no children", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ children: null }));
      const res = await tenantHierarchyService.getChildren(TENANT);
      expect(res.children).toEqual([]);
      expect(res.total).toBe(0);
    });
  });

  describe("getDescendants", () => {
    it("unwraps data.descendants", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ descendants: [{ id: "d1" }] }),
      );

      const res = await tenantHierarchyService.getDescendants(TENANT);

      expect(mockedApi.get).toHaveBeenCalledWith(
        `${BASE}/${TENANT}/descendants`,
      );
      expect(res.descendants).toHaveLength(1);
      expect(res.total).toBe(1);
    });
  });

  describe("getAncestors", () => {
    it("unwraps data.ancestors", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ ancestors: [{ id: "a1" }, { id: "a2" }] }),
      );

      const res = await tenantHierarchyService.getAncestors(TENANT);

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/${TENANT}/ancestors`);
      expect(res.total).toBe(2);
    });
  });

  describe("getCrossTenantRoles", () => {
    it("unwraps data.assignments and passes userId", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ assignments: [{ id: "x1", roleId: "r1" }] }),
      );

      const res = await tenantHierarchyService.getCrossTenantRoles("user-1");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/cross-tenant-roles`, {
        params: { userId: "user-1" },
      });
      expect(res).toHaveLength(1);
    });

    it("returns [] when no assignments come back", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ assignments: [] }));
      await expect(
        tenantHierarchyService.getCrossTenantRoles(),
      ).resolves.toEqual([]);
    });
  });

  describe("addChild", () => {
    it("posts the child under the parent", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ tenantId: "c1", code: "HQ-01", path: "/hq/c1", depth: 1 }),
      );

      const res = await tenantHierarchyService.addChild("parent-1", {
        name: "Branch A",
        plan: "business",
      });

      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/parent-1/children`,
        { name: "Branch A", plan: "business" },
      );
      expect(res.tenantId).toBe("c1");
    });
  });

  describe("updateParent", () => {
    it("PUTs the new parent id", async () => {
      mockedApi.put.mockResolvedValueOnce(
        envelope({ tenantId: TENANT, newParentId: "p2" }),
      );

      await tenantHierarchyService.updateParent(TENANT, "p2");

      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/${TENANT}/parent`, {
        newParentId: "p2",
      });
    });
  });

  describe("removeParent", () => {
    it("DELETEs the parent link", async () => {
      mockedApi.delete.mockResolvedValueOnce(
        envelope({ tenantId: TENANT, status: "root" }),
      );

      await tenantHierarchyService.removeParent(TENANT);

      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/${TENANT}/parent`);
    });
  });
});
