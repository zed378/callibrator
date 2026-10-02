/**
 * A-342 — GET /api/v1/jobs answers the house envelope: rows in `data`,
 * pagination in a top-level `meta`. The service reads them there.
 */
import { batchJobService } from "./batchJob.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

describe("A-342 — batchJobService.getAll reads the house envelope", () => {
  beforeEach(() => jest.clearAllMocks());

  it("takes the rows from data and the pagination from meta", async () => {
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      status: 200,
      message: "Jobs retrieved successfully",
      data: [
        { id: "j1", type: "EXPORT_CSV", status: "PENDING" },
        { id: "j2", type: "EXPORT_CSV", status: "COMPLETED" },
      ],
      meta: { total: 12, page: 2, limit: 10, totalPages: 2 },
    });

    const res = await batchJobService.getAll({ page: 2, limit: 10 });

    expect(res.rows.map((r) => r.id)).toEqual(["j1", "j2"]);
    expect(res).toMatchObject({ total: 12, page: 2, limit: 10, totalPages: 2 });
  });
});
