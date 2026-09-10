import { qmsService } from "./qms.service";
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

const BASE = "/api/v1/qms";

describe("qmsService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("non-conformances", () => {
    // The route is /nc. The service used to call /non-conformances (404).
    it("lists NCs from data.nonConformances, not data.rows", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          nonConformances: [{ id: "nc1", ncNumber: "NC-00001" }],
        }),
      );

      const res = await qmsService.listNonConformances({ page: 1, limit: 10 });

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/nc`, {
        params: { page: 1, limit: 10 },
      });
      expect(res.rows).toHaveLength(1);
      expect(res.total).toBe(1);
    });

    it("degrades to an empty page when the payload is unexpected", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({}));
      const res = await qmsService.listNonConformances();
      expect(res.rows).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.page).toBe(1);
    });

    it("passes a status filter through", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ nonConformances: [] }));
      await qmsService.listNonConformances({ status: "OPEN" });
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/nc`, {
        params: { status: "OPEN" },
      });
    });

    it("creates an NC without inventing server-side fields", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "nc1" }));
      await qmsService.createNonConformance({
        title: "Reading drift",
        severity: "HIGH",
      });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/nc`, {
        title: "Reading drift",
        severity: "HIGH",
      });
      const body = mockedApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("ncNumber");
      expect(body).not.toHaveProperty("status");
    });

    it("updates an NC via PATCH", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "nc1" }));
      await qmsService.updateNonConformance("nc1", { title: "Updated" });
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/nc/nc1`, {
        title: "Updated",
      });
    });

    it("updateNcStatus PATCHes the resource, not a /status subroute", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "nc1" }));
      await qmsService.updateNcStatus("nc1", "CLOSED");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/nc/nc1`, {
        status: "CLOSED",
      });
    });

    it("setRootCause writes the flat rootCause field", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "nc1" }));
      await qmsService.setRootCause("nc1", "Sensor out of tolerance");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/nc/nc1`, {
        rootCause: "Sensor out of tolerance",
      });
    });
  });

  describe("capas", () => {
    it("lists CAPAs from data.capas, not data.rows", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          total: 2,
          page: 1,
          limit: 10,
          totalPages: 1,
          capas: [{ id: "c1" }, { id: "c2" }],
        }),
      );

      const res = await qmsService.listCapas();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/capa`, { params: {} });
      expect(res.rows).toHaveLength(2);
      expect(res.total).toBe(2);
    });

    it("creates a CAPA with the required ncId", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "c1" }));
      await qmsService.createCapa({
        ncId: "nc1",
        title: "Recalibrate",
        actionPlan: "Recalibrate and re-verify",
      });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/capa`, {
        ncId: "nc1",
        title: "Recalibrate",
        actionPlan: "Recalibrate and re-verify",
      });
    });

    it("updates a CAPA via PATCH", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "c1" }));
      await qmsService.updateCapa("c1", { actionPlan: "Revised" });
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/capa/c1`, {
        actionPlan: "Revised",
      });
    });

    it("updateCapaStatus PATCHes the resource", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "c1" }));
      await qmsService.updateCapaStatus("c1", "COMPLETED");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/capa/c1`, {
        status: "COMPLETED",
      });
    });

    it("approveCapa records approvedBy + notes (no /review route exists)", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "c1" }));
      await qmsService.approveCapa("c1", "user-1", "Verified effective");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/capa/c1`, {
        status: "APPROVED",
        approvedBy: "user-1",
        verificationNotes: "Verified effective",
      });
    });
  });
});
