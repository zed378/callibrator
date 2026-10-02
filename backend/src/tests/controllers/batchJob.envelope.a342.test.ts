/**
 * A-342 — GET /api/v1/jobs answers the house envelope: the rows in `data`
 * and the pagination in a top-level `meta` (CLAUDE.md, The Response
 * Envelope). It answered `data: { total, page, limit, totalPages, jobs }`,
 * so a client written to the envelope read `data` as an object and rendered
 * nothing.
 */
const mockGetJobs = jest.fn();

jest.mock("../../services/batchJob.service", () => ({
  createJob: jest.fn(),
  getJobs: (...args: unknown[]): unknown => mockGetJobs(...args),
  getJobStatus: jest.fn(),
}));

type Handler = (req: unknown, res: unknown, next: unknown) => Promise<unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factory above
const controller = require("../../controllers/batchJob.controller") as { getJobs: Handler };

const TENANT = "a3420000-0000-4000-8000-0000000000a1";

describe("A-342 — GET /jobs answers rows in data and pagination in a top-level meta", () => {
  it("puts the jobs in `data` and { total, page, limit, totalPages } in `meta`", async () => {
    const jobs = [{ id: "j1" }, { id: "j2" }];
    mockGetJobs.mockResolvedValue({ total: 12, page: 2, limit: 10, totalPages: 2, jobs });
    const json = jest.fn();
    const res = { headersSent: false, status: jest.fn().mockReturnThis(), json };
    const req = { user: { id: "u1", tenantId: TENANT }, query: { page: "2", limit: "10" }, params: {}, headers: {} };

    await controller.getJobs(req, res, jest.fn());
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockGetJobs).toHaveBeenCalledWith(TENANT, "2", "10");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      status: 200,
      message: "Jobs retrieved successfully",
      data: jobs,
      meta: { total: 12, page: 2, limit: 10, totalPages: 2 },
    });
  });
});
