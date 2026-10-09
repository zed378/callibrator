/**
 * P22-05 — the calibration-date and client-facility services against the backend contract (P21-05,
 * P21-06, P21-09; the paths, methods, queries and bodies of `schema.d.ts`). Each case pins the exact
 * path, the method, the query or body and the envelope unwrap: rows in `data`, paging in the
 * TOP-LEVEL `meta` (never `data.rows`), a list without `meta` read as one page of what came.
 */
import { calibrationDatesService as svc } from "./calibrationDates.service";
import { clientFacilityService } from "./clientFacility.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const ok = <T,>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
const META = { total: 120, page: 2, limit: 50, totalPages: 3 };
const ID = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";

describe("calibrationDatesService (P22-05)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("findDeviceByQr GETs the sticker's lookup and answers the device", async () => {
    mocked.get.mockResolvedValueOnce(ok({ id: ID, name: "Synthetic pump" }));
    expect(await svc.findDeviceByQr("QR-000123")).toEqual({ id: ID, name: "Synthetic pump" });
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/calibration-devices/by-qr/QR-000123");
  });

  it("recordDate POSTs the body on the device and answers the record", async () => {
    const body = { calibrationDate: "2026-10-01", externalLabName: "Synthetic Lab" };
    mocked.post.mockResolvedValueOnce(ok({ id: "r1", notices: [] }));
    expect(await svc.recordDate(ID, body)).toEqual({ id: "r1", notices: [] });
    expect(mocked.post).toHaveBeenCalledWith(`/api/v1/calibration-devices/${ID}/calibration-dates`, body);
  });

  it("recordDate rejects with the backend's 409", async () => {
    mocked.post.mockRejectedValueOnce(new Error("The device is retired"));
    await expect(svc.recordDate(ID, { calibrationDate: "2026-10-01" })).rejects.toThrow("The device is retired");
  });

  it("listRecords GETs the recap with the query as params: rows from data, paging from the top-level meta", async () => {
    const query = { page: 2, limit: 50, latestOnly: true, qrCode: "QR-1" };
    mocked.get.mockResolvedValueOnce(ok([{ id: "r1" }], META));
    expect(await svc.listRecords(query)).toEqual({ rows: [{ id: "r1" }], meta: META });
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/calibration-records", { params: query });
  });

  it("reads a list without meta as one page, and a null data as none", async () => {
    mocked.get.mockResolvedValueOnce(ok([{ id: "a" }, { id: "b" }]));
    expect((await svc.listRecords({ page: 3 })).meta).toEqual({ total: 2, page: 3, limit: 2, totalPages: 1 });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.listRecords()).toEqual({ rows: [], meta: { total: 0, page: 1, limit: 0, totalPages: 1 } });
  });

  it("sameDayEntries counts the device's quick entries on that day from meta.total, else the rows", async () => {
    mocked.get.mockResolvedValueOnce(ok([{ id: "r1" }], { total: 2, page: 1, limit: 1, totalPages: 2 }));
    expect(await svc.sameDayEntries(ID, "2026-10-01")).toBe(2);
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/calibration-records", {
      params: { deviceId: ID, fromDay: "2026-10-01", toDay: "2026-10-01", entryKind: "external_date", page: 1, limit: 1 },
    });
    mocked.get.mockResolvedValueOnce(ok([{ id: "r1" }]));
    expect(await svc.sameDayEntries(ID, "2026-10-01")).toBe(1);
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.sameDayEntries(ID, "2026-10-01")).toBe(0);
  });

  it("laboratories asks for the active calibration laboratories, with a search when given", async () => {
    mocked.get.mockResolvedValueOnce(ok([{ id: "v1", name: "Synthetic Lab" }], META));
    expect(await svc.laboratories()).toEqual([{ id: "v1", name: "Synthetic Lab" }]);
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/vendors", { params: { type: "CalibrationLab", status: "Active", page: 1, limit: 50 } });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.laboratories("synth")).toEqual([]);
    expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/vendors", {
      params: { type: "CalibrationLab", status: "Active", page: 1, limit: 50, find: "synth" },
    });
  });
});

describe("clientFacilityService (P22-05)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("options GETs the short list; a null data is none", async () => {
    mocked.get.mockResolvedValueOnce(ok([{ id: ID, name: "Synthetic clinic", code: null }]));
    expect(await clientFacilityService.options()).toEqual([{ id: ID, name: "Synthetic clinic", code: null }]);
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/client-facilities/options");
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await clientFacilityService.options()).toEqual([]);
  });
});
