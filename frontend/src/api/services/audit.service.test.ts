import { auditService } from "./audit.service";
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
const envelope = <T,>(data: T, meta?: unknown) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
  ...(meta ? { meta } : {}),
});

const BASE = "/api/v1/audit";

describe("auditService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("GETs with default page/limit and unwraps logs + meta", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "l1" }], {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      );

      const res = await auditService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 10 },
      });
      expect(res.logs).toHaveLength(1);
      expect(res.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it("adds all optional filter params only when provided", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));

      await auditService.getAll({
        page: 2,
        limit: 25,
        userId: "u1",
        action: "LOGIN",
        resourceType: "Certificate",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
      });

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: {
          page: 2,
          limit: 25,
          userId: "u1",
          action: "LOGIN",
          resourceType: "Certificate",
          startDate: "2026-01-01",
          endDate: "2026-02-01",
        },
      });
    });

    it("falls back to [] logs and a synthesized meta when data/meta are absent", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));

      const res = await auditService.getAll({ page: 4, limit: 5 });

      expect(res.logs).toEqual([]);
      expect(res.meta).toEqual({
        total: 0,
        page: 4,
        limit: 5,
        totalPages: 1,
      });
    });
  });
});
