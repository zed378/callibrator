import { userPermissionService } from "./userPermission.service";
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

const BASE = "/api/v1/user-permissions";

describe("userPermissionService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getUserPermissions", () => {
    it("GETs by userId and unwraps data", async () => {
      const data = { user: { id: "u1" }, rolePermissions: [], overrides: [], effective: [] };
      mockedApi.get.mockResolvedValueOnce(envelope(data));
      const res = await userPermissionService.getUserPermissions("u1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/u1`);
      expect(res).toEqual(data);
    });
  });

  describe("setUserPermission", () => {
    it("POSTs the override payload including notes", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope(null));
      await userPermissionService.setUserPermission("u1", "m1", "write", "why");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/u1`, {
        menuGroupId: "m1",
        permissionType: "write",
        notes: "why",
      });
    });

    it("sends notes:undefined when omitted", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope(null));
      await userPermissionService.setUserPermission("u1", "m1", "none");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/u1`, {
        menuGroupId: "m1",
        permissionType: "none",
        notes: undefined,
      });
    });
  });

  describe("removeUserPermission", () => {
    it("DELETEs by userId and menuGroupId", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await userPermissionService.removeUserPermission("u1", "m1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/u1/m1`);
    });
  });
});
