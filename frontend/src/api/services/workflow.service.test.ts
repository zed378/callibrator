import { workflowService } from "./workflow.service";
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

const BASE = "/api/v1/workflows";

describe("workflowService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("reads the plain array in data (the endpoint does not paginate)", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "w1", name: "Cert approval" }]),
      );

      const res = await workflowService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE);
      expect(res).toHaveLength(1);
    });

    it("returns [] when data is empty", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(workflowService.getAll()).resolves.toEqual([]);
    });
  });

  describe("getById", () => {
    it("fetches one workflow", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "w1" }));
      await workflowService.getById("w1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/w1`);
    });
  });

  describe("create", () => {
    it("sends the shape the validator requires", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "w1" }));

      const input = {
        name: "Cert approval",
        resourceType: "Certificate" as const,
        steps: [
          {
            stepOrder: 1,
            roleId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
            requiredApprovals: 1,
          },
        ],
      };
      await workflowService.create(input);

      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      // The old service sent `type` + `order`/`assigneeType`, which Joi rejects.
      const body = mockedApi.post.mock.calls[0][1] as {
        steps: Record<string, unknown>[];
      };
      expect(body).not.toHaveProperty("type");
      expect(body.steps[0]).not.toHaveProperty("order");
      expect(body.steps[0]).not.toHaveProperty("assigneeType");
    });
  });

  describe("update", () => {
    it("PUTs a partial by id", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "w1" }));

      await workflowService.update("w1", { name: "Renamed", isActive: false });

      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/w1`, {
        name: "Renamed",
        isActive: false,
      });
    });
  });

  describe("delete", () => {
    it("deletes by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await workflowService.delete("w1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/w1`);
    });
  });

  describe("getPendingInstances", () => {
    it("reads the plain array of pending tasks", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "i1", workflowId: "w1" }]),
      );

      const res = await workflowService.getPendingInstances();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/instances/pending`);
      expect(res).toHaveLength(1);
    });
  });

  describe("actionOnInstance", () => {
    it("sends uppercase action and a `comments` field", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ status: "APPROVED" }));

      const res = await workflowService.actionOnInstance("i1", {
        action: "APPROVED",
        comments: "Looks good",
      });

      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/instances/i1/action`,
        { action: "APPROVED", comments: "Looks good" },
      );
      expect(res.status).toBe("APPROVED");
    });

    it("approve() wraps the APPROVED action", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ status: "APPROVED" }));
      await workflowService.approve("i1", "ok");
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/instances/i1/action`,
        { action: "APPROVED", comments: "ok" },
      );
    });

    it("reject() wraps the REJECTED action", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ status: "REJECTED" }));
      await workflowService.reject("i1");
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/instances/i1/action`,
        { action: "REJECTED", comments: undefined },
      );
    });
  });
});
