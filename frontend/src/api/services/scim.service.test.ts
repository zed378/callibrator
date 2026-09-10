import { scimService, emailFilter, activeFilter } from "./scim.service";
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

const BASE = "/api/v1/scim/v2";

const listOf = <T,>(resources: T[]) => ({
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  totalResults: resources.length,
  startIndex: 1,
  itemsPerPage: resources.length,
  Resources: resources,
});

describe("filter helpers", () => {
  it("emits the backend's email filter dialect", () => {
    expect(emailFilter("a@b.c")).toBe('email eq "a@b.c"');
  });

  it("emits an active filter", () => {
    expect(activeFilter(false)).toBe("active eq false");
  });
});

describe("scimService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("Users", () => {
    it("lists users with paging params", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope(listOf([{ id: "u1", userName: "a@b.c" }])),
      );
      const res = await scimService.getUsers({ startIndex: 1, count: 25 });
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/Users`, {
        params: { startIndex: 1, count: 25 },
      });
      expect(res.Resources).toHaveLength(1);
    });

    it("passes a filter through", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(listOf([])));
      await scimService.getUsers({ filter: 'email eq "a@b.c"' });
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/Users`, {
        params: { filter: 'email eq "a@b.c"' },
      });
    });

    it("falls back to an empty ListResponse", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      const res = await scimService.getUsers();
      expect(res.totalResults).toBe(0);
      expect(res.Resources).toEqual([]);
    });

    it("gets a user by id", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "u1" }));
      await scimService.getUserById("u1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/Users/u1`);
    });

    it("creates a user", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "u1" }));
      await scimService.createUser({ userName: "a@b.c", active: true });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/Users`, {
        userName: "a@b.c",
        active: true,
      });
    });

    it("replaces a user", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "u1" }));
      await scimService.updateUser("u1", { userName: "a@b.c" });
      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/Users/u1`, {
        userName: "a@b.c",
      });
    });

    it("wraps patch operations in an Operations envelope", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "u1" }));
      await scimService.patchUser("u1", [
        { op: "replace", path: "active", value: "false" },
      ]);
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/Users/u1`, {
        Operations: [{ op: "replace", path: "active", value: "false" }],
      });
    });

    it("deletes a user", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await scimService.deleteUser("u1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/Users/u1`);
    });

    it("deactivateUser patches active to false", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "u1" }));
      await scimService.deactivateUser("u1");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/Users/u1`, {
        Operations: [{ op: "replace", path: "active", value: "false" }],
      });
    });

    it("activateUser patches active to true", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "u1" }));
      await scimService.activateUser("u1");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/Users/u1`, {
        Operations: [{ op: "replace", path: "active", value: "true" }],
      });
    });
  });

  describe("Groups", () => {
    it("lists groups", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope(listOf([{ id: "g1", displayName: "Engineers" }])),
      );
      const res = await scimService.getGroups({ count: 10 });
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/Groups`, {
        params: { count: 10 },
      });
      expect(res.Resources[0].displayName).toBe("Engineers");
    });

    it("gets a group by id", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "g1" }));
      await scimService.getGroupById("g1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/Groups/g1`);
    });

    it("creates a group", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "g1" }));
      await scimService.createGroup({ displayName: "Engineers" });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/Groups`, {
        displayName: "Engineers",
      });
    });

    it("replaces a group", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "g1" }));
      await scimService.updateGroup("g1", { displayName: "Eng" });
      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/Groups/g1`, {
        displayName: "Eng",
      });
    });

    it("patches a group's members", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "g1" }));
      await scimService.patchGroup("g1", [
        { op: "add", path: "members", value: [{ value: "u1" }] },
      ]);
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/Groups/g1`, {
        Operations: [{ op: "add", path: "members", value: [{ value: "u1" }] }],
      });
    });

    it("deletes a group", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await scimService.deleteGroup("g1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/Groups/g1`);
    });
  });
});
