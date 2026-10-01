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

// The real Zod schemas check every body; validateInput is wrapped only so the
// fallback tests below can force a parse result the schema itself never gives.
jest.mock("../../validators/input", () => {
  const actual = jest.requireActual("../../validators/input");
  return { ...actual, validateInput: jest.fn(actual.validateInput) };
});

jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    res.status(status || 200).json({ success: true, data, message });
  }),
  error: jest.fn(),
}));

const scimController = require("../../controllers/scim.controller");
const scimService = require("../../services/scim.service");
const { validateInput } = require("../../validators/input");
const { error } = require("../../utils/response.util");

// A-272 (ADR-100): a thrown validateInput failure answers like validate() —
// "Validation Error" with the field list as details (it was "[object Object]").
const FIELD_ERRORS = expect.arrayContaining([
  expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
]);

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
      req.body = { userName: "test@example.com" };
      scimService.createUser.mockResolvedValue({ id: "user-1" });
      await scimController.createUser(req, res, next);
      expect(scimService.createUser).toHaveBeenCalledWith(
        "tenant-1",
        { userName: "test@example.com" },
        expect.any(Object),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("records an authorized API key, the ip and the user agent as the provisioning actor", async () => {
      req.user = { id: "key-1", tenantId: "tenant-1", isApiKey: true };
      req.apiKeyAuthorized = true;
      req.ip = "10.0.0.9";
      req.headers = { "user-agent": "Okta SCIM" };
      req.body = { userName: "test@example.com" };
      scimService.createUser.mockResolvedValue({ id: "user-1" });
      await scimController.createUser(req, res, next);
      expect(scimService.createUser).toHaveBeenCalledWith(
        "tenant-1",
        { userName: "test@example.com" },
        { apiKeyId: "key-1", userId: null, ipAddress: "10.0.0.9", userAgent: "Okta SCIM" },
      );
    });

    // A-278 (ADR-094): a super admin JWT is audited as that user; replace and
    // delete now carry the actor too.
    it("passes a super admin JWT as the actor of a replace and a delete", async () => {
      req.user = { id: "op-1", tenantId: "tenant-1" };
      req.ip = "10.0.0.8";
      req.headers = {};
      req.params = { id: "user-1" };
      req.body = { userName: "updated@example.com" };
      scimService.updateUser.mockResolvedValue({ id: "user-1" });
      await scimController.updateUser(req, res, next);
      await scimController.deleteUser(req, res, next);
      const actor = { apiKeyId: null, userId: "op-1", ipAddress: "10.0.0.8", userAgent: null };
      expect(scimService.updateUser).toHaveBeenCalledWith("tenant-1", "user-1", expect.any(Object), actor);
      expect(scimService.deleteUser).toHaveBeenCalledWith("tenant-1", "user-1", actor);
    });

    it("names no user for a principal without an id", async () => {
      req.user = { tenantId: "tenant-1" };
      req.params = { id: "user-1" };
      await scimController.deleteUser(req, res, next);
      expect(scimService.deleteUser).toHaveBeenCalledWith("tenant-1", "user-1", expect.objectContaining({ userId: null }));
    });

    it("answers 400 and provisions nothing when userName is not an email", async () => {
      req.body = { userName: "test" };
      await scimController.createUser(req, res, next);
      expect(scimService.createUser).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });

    it("should update user", async () => {
      req.params = { id: "user-1" };
      req.body = { userName: "updated@example.com" };
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

  // patchUser/patchGroup fall back to an empty Operations array. The schema
  // requires Operations, so the fallback is reachable only with the parse forced.
  describe("patch Operations fallback", () => {
    it("passes an empty array when the user patch body has no Operations", async () => {
      req.params = { id: "user-1" };
      req.body = {};
      validateInput.mockImplementationOnce((data) => data);
      scimService.patchUser.mockResolvedValue({ id: "user-1" });
      await scimController.patchUser(req, res, next);
      expect(scimService.patchUser).toHaveBeenCalledWith("tenant-1", "user-1", [], expect.any(Object));
    });

    it("passes an empty array when the group patch body has no Operations", async () => {
      req.params = { id: "group-1" };
      req.body = {};
      validateInput.mockImplementationOnce((data) => data);
      scimService.patchGroup.mockResolvedValue({ id: "group-1" });
      await scimController.patchGroup(req, res, next);
      expect(scimService.patchGroup).toHaveBeenCalledWith("tenant-1", "group-1", [], expect.any(Object));
    });
  });
});
