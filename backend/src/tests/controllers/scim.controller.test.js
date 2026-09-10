jest.mock("../../services/scim.service", () => ({
  getUsers: jest.fn(),
  getUserById: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  patchUser: jest.fn(),
  deleteUser: jest.fn(),
  getGroups: jest.fn(),
  getGroupById: jest.fn(),
  createGroup: jest.fn(),
  updateGroup: jest.fn(),
  patchGroup: jest.fn(),
  deleteGroup: jest.fn(),
}));

jest.mock("../../validators/scim.validator", () => ({
  validate: jest.fn((data) => data),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    res.status(status || 200).json({ success: true, data, message });
  }),
}));

const scimController = require("../../controllers/scim.controller");
const scimService = require("../../services/scim.service");

describe("scim Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { params: {}, body: {}, query: {}, user: { id: "user-1", tenantId: "tenant-1" } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("Users", () => {
    it("should get users", async () => {
      req.query = { startIndex: 1, count: 100 };
      scimService.getUsers.mockResolvedValue([]);
      await scimController.getUsers(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should get user by id", async () => {
      req.params = { id: "user-1" };
      scimService.getUserById.mockResolvedValue({ id: "user-1" });
      await scimController.getUserById(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should create user", async () => {
      req.body = { userName: "test" };
      scimService.createUser.mockResolvedValue({ id: "user-1" });
      await scimController.createUser(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should update user", async () => {
      req.params = { id: "user-1" };
      req.body = { userName: "updated" };
      scimService.updateUser.mockResolvedValue({ id: "user-1" });
      await scimController.updateUser(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should patch user", async () => {
      req.params = { id: "user-1" };
      req.body = { Operations: [{ op: "replace" }] };
      scimService.patchUser.mockResolvedValue({ id: "user-1" });
      await scimController.patchUser(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should delete user", async () => {
      req.params = { id: "user-1" };
      await scimController.deleteUser(req, res, next);
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe("Groups", () => {
    it("should get groups", async () => {
      req.query = { startIndex: 1, count: 100 };
      scimService.getGroups.mockResolvedValue([]);
      await scimController.getGroups(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should get group by id", async () => {
      req.params = { id: "group-1" };
      scimService.getGroupById.mockResolvedValue({ id: "group-1" });
      await scimController.getGroupById(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should create group", async () => {
      req.body = { displayName: "test" };
      scimService.createGroup.mockResolvedValue({ id: "group-1" });
      await scimController.createGroup(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should update group", async () => {
      req.params = { id: "group-1" };
      req.body = { displayName: "updated" };
      scimService.updateGroup.mockResolvedValue({ id: "group-1" });
      await scimController.updateGroup(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should patch group", async () => {
      req.params = { id: "group-1" };
      req.body = { Operations: [{ op: "add" }] };
      scimService.patchGroup.mockResolvedValue({ id: "group-1" });
      await scimController.patchGroup(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should delete group", async () => {
      req.params = { id: "group-1" };
      await scimController.deleteGroup(req, res, next);
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  // getUsers/getGroups default startIndex to 1 and count to 100 when the SCIM
  // client omits them, and tenantId is read through `req.user?.tenantId`.
  describe("pagination defaults and tenant resolution", () => {
    it("defaults startIndex to 1 and count to 100 for users", async () => {
      req.query = {};
      scimService.getUsers.mockResolvedValue([]);
      await scimController.getUsers(req, res, next);
      expect(scimService.getUsers).toHaveBeenCalledWith(
        "tenant-1",
        1,
        100,
        undefined,
      );
    });

    it("coerces startIndex/count strings and forwards the filter for users", async () => {
      req.query = { startIndex: "3", count: "25", filter: 'userName eq "a"' };
      scimService.getUsers.mockResolvedValue([]);
      await scimController.getUsers(req, res, next);
      expect(scimService.getUsers).toHaveBeenCalledWith(
        "tenant-1",
        3,
        25,
        'userName eq "a"',
      );
    });

    it("defaults startIndex to 1 and count to 100 for groups", async () => {
      req.query = {};
      scimService.getGroups.mockResolvedValue([]);
      await scimController.getGroups(req, res, next);
      expect(scimService.getGroups).toHaveBeenCalledWith(
        "tenant-1",
        1,
        100,
        undefined,
      );
    });

    it("passes tenantId undefined when req.user is absent", async () => {
      req.query = {};
      req.user = undefined;
      scimService.getGroups.mockResolvedValue([]);
      await scimController.getGroups(req, res, next);
      expect(scimService.getGroups).toHaveBeenCalledWith(
        undefined,
        1,
        100,
        undefined,
      );
    });
  });

  // patchUser/patchGroup fall back to an empty Operations array.
  describe("patch Operations fallback", () => {
    it("passes an empty array when the user patch body has no Operations", async () => {
      req.params = { id: "user-1" };
      req.body = {};
      scimService.patchUser.mockResolvedValue({ id: "user-1" });
      await scimController.patchUser(req, res, next);
      expect(scimService.patchUser).toHaveBeenCalledWith("tenant-1", "user-1", []);
    });

    it("passes an empty array when the group patch body has no Operations", async () => {
      req.params = { id: "group-1" };
      req.body = {};
      scimService.patchGroup.mockResolvedValue({ id: "group-1" });
      await scimController.patchGroup(req, res, next);
      expect(scimService.patchGroup).toHaveBeenCalledWith("tenant-1", "group-1", []);
    });
  });
});