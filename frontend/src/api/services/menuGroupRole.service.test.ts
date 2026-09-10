import { menuGroupRoleService } from "./menuGroupRole.service";
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

const BASE = "/api/v1/menu-groups";

describe("menuGroupRoleService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAdminMenuGroups", () => {
    it("GETs the admin list and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "g1" }]));
      const res = await menuGroupRoleService.getAdminMenuGroups();
      expect(mockedApi.get).toHaveBeenCalledWith(
        `${BASE}/menu-groups/admin`,
      );
      expect(res).toHaveLength(1);
    });

    it("returns [] when data is falsy", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(
        menuGroupRoleService.getAdminMenuGroups(),
      ).resolves.toEqual([]);
    });
  });

  describe("createMenuGroup", () => {
    it("POSTs the create payload to /create", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "g1" }));
      const payload = { name: "Admin" };
      await menuGroupRoleService.createMenuGroup(payload);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/create`, payload);
    });
  });

  describe("updateMenuGroup", () => {
    it("POSTs the update payload to /update", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "g1" }));
      const payload = { id: "g1", name: "Renamed" };
      await menuGroupRoleService.updateMenuGroup(payload);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/update`, payload);
    });
  });

  describe("deleteMenuGroup", () => {
    it("POSTs the id to /delete", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope(null));
      await menuGroupRoleService.deleteMenuGroup("g1");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/delete`, {
        menuGroupId: "g1",
      });
    });
  });

  describe("getAvailableMenuGroups", () => {
    it("GETs /menu-groups with the roleId param", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "g1" }]));
      await menuGroupRoleService.getAvailableMenuGroups("r1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/menu-groups`, {
        params: { roleId: "r1" },
      });
    });

    it("returns [] when data is falsy", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(undefined));
      await expect(
        menuGroupRoleService.getAvailableMenuGroups("r1"),
      ).resolves.toEqual([]);
    });
  });

  describe("getAvailableRoles", () => {
    it("GETs /roles and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "r1" }]));
      const res = await menuGroupRoleService.getAvailableRoles();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/roles`);
      expect(res).toHaveLength(1);
    });
  });

  describe("getPersonalizedMenu", () => {
    it("POSTs the roleId to /get-assignments", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope([{ id: "g1" }]));
      await menuGroupRoleService.getPersonalizedMenu("r1");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/get-assignments`, {
        roleId: "r1",
      });
    });

    it("returns [] when data is falsy", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope(null));
      await expect(
        menuGroupRoleService.getPersonalizedMenu("r1"),
      ).resolves.toEqual([]);
    });
  });

  describe("filterMenuGroups", () => {
    it("POSTs the filters to /filter", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope([{ id: "g1" }]));
      const filters = { roleId: "r1", tenantId: "t1" };
      await menuGroupRoleService.filterMenuGroups(filters);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/filter`, filters);
    });
  });

  describe("assignMenuGroupToRole", () => {
    it("POSTs the payload to /assign", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "r1" }));
      const payload = { menuGroupId: "g1", roleId: "r1" };
      await menuGroupRoleService.assignMenuGroupToRole(payload);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/assign`, payload);
    });
  });

  describe("revokeMenuGroupFromRole", () => {
    it("POSTs the payload to /revoke", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "r1" }));
      const payload = { menuGroupId: "g1", roleId: "r1" };
      await menuGroupRoleService.revokeMenuGroupFromRole(payload);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/revoke`, payload);
    });
  });

  describe("assignMenuItemToRole", () => {
    it("POSTs the payload to /assign-item", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "r1" }));
      const payload = { menuItemId: "i1", roleId: "r1" };
      await menuGroupRoleService.assignMenuItemToRole(payload);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/assign-item`,
        payload,
      );
    });
  });

  describe("revokeMenuItemFromRole", () => {
    it("POSTs the payload to /revoke-item", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "r1" }));
      const payload = { menuItemId: "i1", roleId: "r1" };
      await menuGroupRoleService.revokeMenuItemFromRole(payload);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/revoke-item`,
        payload,
      );
    });
  });

  describe("bulkAssignMenuGroups", () => {
    it("POSTs the payload to /bulk-assign", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ assigned: 2 }));
      const payload = { roleId: "r1", menuGroupIds: ["g1", "g2"] };
      await menuGroupRoleService.bulkAssignMenuGroups(payload);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/bulk-assign`,
        payload,
      );
    });
  });

  describe("bulkRevokeMenuGroups", () => {
    it("POSTs the payload to /bulk-revoke", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ revoked: 2 }));
      const payload = { roleId: "r1", menuGroupIds: ["g1", "g2"] };
      await menuGroupRoleService.bulkRevokeMenuGroups(payload);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/bulk-revoke`,
        payload,
      );
    });
  });
});
