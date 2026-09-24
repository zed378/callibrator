import {
  CAPA_STATUSES,
  NC_SEVERITIES,
  NC_STATUSES,
  qmsService,
} from "./qms.service";
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
    // The rows ARE `data`; pagination is the top-level `meta` sibling
    // (backend qms.controller.js). The service used to read
    // `data.nonConformances`, which the backend stopped sending — every list
    // rendered empty with no error.
    it("lists NCs from the house envelope: rows in data, pagination in top-level meta", async () => {
      mockedApi.get.mockResolvedValueOnce({
        ...envelope([{ id: "nc1", ncNumber: "NC-00001" }]),
        meta: { total: 11, page: 2, limit: 10, totalPages: 2 },
      });

      const res = await qmsService.listNonConformances({ page: 2, limit: 10 });

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/nc`, {
        params: { page: 2, limit: 10 },
      });
      expect(res.rows).toEqual([{ id: "nc1", ncNumber: "NC-00001" }]);
      expect(res).toMatchObject({ total: 11, page: 2, limit: 10, totalPages: 2 });
    });

    it("does not read rows from a named key inside data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ nonConformances: [{ id: "nc1" }] }),
      );
      const res = await qmsService.listNonConformances();
      expect(res.rows).toEqual([]);
    });

    it("degrades to an empty page when the payload is unexpected", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({}));
      const res = await qmsService.listNonConformances();
      expect(res.rows).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.page).toBe(1);
      expect(res.limit).toBe(10);
      expect(res.totalPages).toBe(1);
    });

    it("falls back to the row count and the request params when meta is absent", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "a" }, { id: "b" }]));
      const res = await qmsService.listNonConformances({ page: 3, limit: 5 });
      expect(res).toMatchObject({ total: 2, page: 3, limit: 5, totalPages: 1 });
    });

    it("passes a status filter through", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));
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
    it("lists CAPAs from the house envelope, not data.capas", async () => {
      mockedApi.get.mockResolvedValueOnce({
        ...envelope([{ id: "c1" }, { id: "c2" }]),
        meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
      });

      const res = await qmsService.listCapas();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/capa`, { params: {} });
      expect(res.rows).toHaveLength(2);
      expect(res.total).toBe(2);
    });

    it("degrades to an empty page when the list response is missing", async () => {
      mockedApi.get.mockResolvedValueOnce(undefined);
      const res = await qmsService.listCapas();
      expect(res.rows).toEqual([]);
      expect(res.total).toBe(0);
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
      await qmsService.updateCapaStatus("c1", "VERIFICATION");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/capa/c1`, {
        status: "VERIFICATION",
      });
    });

    // A-66: it used to send status "APPROVED", which is not in the backend
    // CAPA enum (DRAFT, OPEN, IN_PROGRESS, VERIFICATION, CLOSED) — the
    // validator answered 400 and nothing was approved.
    it("approveCapa sends a status the backend enum accepts (CLOSED, not APPROVED)", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "c1" }));
      await qmsService.approveCapa("c1", "user-1", "Verified effective");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/capa/c1`, {
        status: "CLOSED",
        approvedBy: "user-1",
        verificationNotes: "Verified effective",
      });
      const body = mockedApi.patch.mock.calls[0][1] as { status: string };
      // Checked against the backend's list, written out here from
      // backend/src/models/capa.model.js — not against CAPA_STATUSES, which is
      // the code under test.
      expect(["DRAFT", "OPEN", "IN_PROGRESS", "VERIFICATION", "CLOSED"]).toContain(
        body.status,
      );
    });
  });
});

describe("QMS status vocabularies match the backend ENUMs", () => {
  // Literal copies of backend/src/models/{nonConformance,capa}.model.js.
  it("NC statuses", () => {
    expect([...NC_STATUSES]).toEqual([
      "OPEN",
      "UNDER_INVESTIGATION",
      "CAPA_REQUIRED",
      "CLOSED",
    ]);
  });

  it("CAPA statuses", () => {
    expect([...CAPA_STATUSES]).toEqual([
      "DRAFT",
      "OPEN",
      "IN_PROGRESS",
      "VERIFICATION",
      "CLOSED",
    ]);
  });

  it("NC severities", () => {
    expect([...NC_SEVERITIES]).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });
});
