import { batchJobService } from "./batchJob.service";
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

const BASE = "/api/v1/jobs";

describe("batchJobService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("reads rows from data.jobs and pagination from the flat payload", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          total: 2,
          page: 1,
          limit: 10,
          totalPages: 1,
          jobs: [
            { id: "j1", type: "EXPORT_CSV", status: "PENDING" },
            { id: "j2", type: "EXPORT_CSV", status: "COMPLETED" },
          ],
        }),
      );

      const res = await batchJobService.getAll({ page: 1, limit: 10 });

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 10 },
      });
      expect(res.rows).toHaveLength(2);
      expect(res.total).toBe(2);
    });

    it("degrades to an empty page on an unexpected payload", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({}));
      const res = await batchJobService.getAll();
      expect(res.rows).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.page).toBe(1);
    });
  });

  describe("getById", () => {
    it("fetches a single job", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ id: "j1", status: "PROCESSING" }),
      );

      const res = await batchJobService.getById("j1");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/j1`);
      expect(res.status).toBe("PROCESSING");
    });
  });

  describe("createTestJob", () => {
    it("sends the fields the backend actually reads", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "j1" }));

      await batchJobService.createTestJob({
        type: "EXPORT_CSV",
        totalItems: 50,
      });

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/test`, {
        type: "EXPORT_CSV",
        totalItems: 50,
      });
    });

    it("sends an empty body so the server defaults apply", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "j1" }));
      await batchJobService.createTestJob();
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/test`, {});
    });
  });
});
