/**
 * P22-02 — the device register service against the backend contract (P21-02a, P21-02b; the paths,
 * methods, queries and bodies of `schema.d.ts`): rows from `data`, paging from the TOP-LEVEL `meta`;
 * the two multipart calls as FormData; a signed photo link turned into a same-origin path.
 */
import { deviceRegisterService as svc } from "./deviceRegister.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const ok = <T,>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
const META = { total: 41, page: 2, limit: 20, totalPages: 3 };
const ID = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const PHOTO = "7f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const row = { id: ID, tenantId: "t", name: "Synthetic pump", status: "active" };

describe("deviceRegisterService (P22-02)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("list: the query as params; full rows only; the top-level meta", async () => {
    mocked.get.mockResolvedValueOnce(ok([row, { id: "f", name: "field row" }], META));
    const query = { page: 2, limit: 20, qrCode: "TST1", condition: "good" as const };
    expect(await svc.list(query)).toEqual({ rows: [row], meta: META });
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/calibration-devices", { params: query });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.list({})).toEqual({ rows: [], meta: { total: 0, page: 1, limit: 0, totalPages: 1 } });
  });

  it("get, create, update and remove use the device's path", async () => {
    mocked.get.mockResolvedValueOnce(ok(row));
    expect(await svc.get(ID)).toEqual(row);
    expect(mocked.get).toHaveBeenCalledWith(`/api/v1/calibration-devices/${ID}`);
    mocked.post.mockResolvedValueOnce(ok(row));
    await svc.create({ name: "Synthetic pump", room: { name: "Room 1", floor: null } });
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/calibration-devices", { name: "Synthetic pump", room: { name: "Room 1", floor: null } });
    mocked.put.mockResolvedValueOnce(ok(row));
    await svc.update(ID, { condition: "broken" });
    expect(mocked.put).toHaveBeenCalledWith(`/api/v1/calibration-devices/${ID}`, { condition: "broken" });
    mocked.delete.mockResolvedValueOnce(ok({}));
    await svc.remove(ID);
    expect(mocked.delete).toHaveBeenCalledWith(`/api/v1/calibration-devices/${ID}`);
  });

  it("a refused create rejects (409 taken QR)", async () => {
    mocked.post.mockRejectedValueOnce(new Error("QR code TST000001 is already on device X"));
    await expect(svc.create({ name: "Synthetic pump" })).rejects.toThrow("already on device");
  });

  it("bulkImport and uploadPhoto post FormData", async () => {
    mocked.post.mockResolvedValueOnce({ data: { successCount: 1, failedCount: 0, totalCount: 1, errors: [] } });
    const csv = new File(["name\nA"], "devices.csv", { type: "text/csv" });
    expect((await svc.bulkImport(csv)).successCount).toBe(1);
    const [path, form] = mocked.post.mock.calls[0] as [string, FormData];
    expect(path).toBe("/api/v1/calibration-devices/bulk-import");
    expect(form.get("file")).toBe(csv);

    mocked.post.mockResolvedValueOnce({ data: { id: PHOTO, purpose: "device_front" } });
    const jpg = new File(["x"], "front.jpg", { type: "image/jpeg" });
    expect((await svc.uploadPhoto(ID, "device_front", jpg)).id).toBe(PHOTO);
    const [photoPath, photoForm] = mocked.post.mock.calls[1] as [string, FormData];
    expect(photoPath).toBe(`/api/v1/calibration-devices/${ID}/photos`);
    expect(photoForm.get("purpose")).toBe("device_front");
    expect(photoForm.get("file")).toBe(jpg);
  });

  it("deletePhoto DELETEs the photo of the device", async () => {
    mocked.delete.mockResolvedValueOnce(ok({ id: PHOTO }));
    await svc.deletePhoto(ID, PHOTO);
    expect(mocked.delete).toHaveBeenCalledWith(`/api/v1/calibration-devices/${ID}/photos/${PHOTO}`);
  });

  it("photoLink asks for the variant and answers a same-origin path", async () => {
    mocked.post.mockResolvedValueOnce(
      ok({ url: `https://api.example.invalid/api/v1/attachments/${PHOTO}/signed?token=abc&variant=thumb`, token: "abc", expiresAt: "x", expiresInSec: 300 }),
    );
    expect(await svc.photoLink(PHOTO, "thumb")).toBe(`/api/v1/attachments/${PHOTO}/signed?token=abc&variant=thumb`);
    expect(mocked.post).toHaveBeenCalledWith(`/api/v1/attachments/${PHOTO}/signed-url`, { variant: "thumb" });
  });

  it("stores asks for stores only; deviceTypes for active types, with a search when given", async () => {
    mocked.get.mockResolvedValueOnce(ok([{ id: "s1" }]));
    expect(await svc.stores()).toEqual([{ id: "s1" }]);
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/warehouses", { params: { kind: "store", page: 1, limit: 100 } });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.stores()).toEqual([]);
    mocked.get.mockResolvedValueOnce(ok([{ id: "t1", name: "Infusion pump", status: "active" }]));
    expect(await svc.deviceTypes("pump")).toHaveLength(1);
    expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/device-types", { params: { status: "active", page: 1, limit: 50, search: "pump" } });
    mocked.get.mockResolvedValueOnce(ok(null));
    expect(await svc.deviceTypes()).toEqual([]);
    expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/device-types", { params: { status: "active", page: 1, limit: 50 } });
  });
});
