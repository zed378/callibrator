import { sopService } from "./sop.service";
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

// Routes live on /sop itself — the service used to call /sop/documents (404).
const BASE = "/api/v1/sop";

describe("sopService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("listDocuments", () => {
    it("reads rows from data.documents and pagination from the flat payload", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          total: 3,
          page: 2,
          limit: 10,
          totalPages: 1,
          documents: [{ id: "d1", documentNumber: "SOP-0001" }],
        }),
      );

      const res = await sopService.listDocuments({ page: 2, limit: 10 });

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 2, limit: 10 },
      });
      expect(res.rows).toHaveLength(1);
      expect(res.total).toBe(3);
      expect(res.page).toBe(2);
    });

    it("degrades to an empty page on an unexpected payload", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({}));
      const res = await sopService.listDocuments();
      expect(res.rows).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.totalPages).toBe(1);
    });

    it("passes a status filter", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ documents: [] }));
      await sopService.listDocuments({ status: "PUBLISHED" });
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { status: "PUBLISHED" },
      });
    });
  });

  describe("createDocument", () => {
    it("sends only fields the backend reads", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "d1" }));

      await sopService.createDocument({
        title: "Calibration procedure",
        version: "2.0",
        contentUrl: "https://example.com/sop.pdf",
        requiresTraining: true,
      });

      expect(mockedApi.post).toHaveBeenCalledWith(BASE, {
        title: "Calibration procedure",
        version: "2.0",
        contentUrl: "https://example.com/sop.pdf",
        requiresTraining: true,
      });
      const body = mockedApi.post.mock.calls[0][1] as Record<string, unknown>;
      // documentNumber and status are assigned server-side.
      expect(body).not.toHaveProperty("documentNumber");
      expect(body).not.toHaveProperty("status");
    });
  });

  describe("publishDocument", () => {
    it("PATCHes /:id/publish (not POST)", async () => {
      mockedApi.patch.mockResolvedValueOnce(
        envelope({ id: "d1", status: "PUBLISHED" }),
      );

      const res = await sopService.publishDocument("d1");

      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/d1/publish`);
      expect(res.status).toBe("PUBLISHED");
    });
  });

  describe("acknowledgeTraining", () => {
    it("posts to /:documentId/acknowledge with no body", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ id: "a1", status: "COMPLETED" }),
      );

      const res = await sopService.acknowledgeTraining("d1");

      // :id here is the DOCUMENT id, not an acknowledgment id.
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/d1/acknowledge`);
      expect(res.status).toBe("COMPLETED");
    });
  });
});
