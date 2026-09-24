import { iotService } from "./iot.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T) => ({ success: true, status: 200, message: "ok", data });

describe("iotService (A-29 / A-46) — targets the real /api/v1/iot/devices routes", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getConfig GETs /iot/devices/:id and unwraps data", async () => {
    mockedApi.get.mockResolvedValueOnce(envelope({ deviceId: "d1", hasToken: false }));
    await expect(iotService.getConfig("d1")).resolves.toEqual({ deviceId: "d1", hasToken: false });
    expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/iot/devices/d1");
  });

  it("updateConfig PATCHes the tolerance", async () => {
    mockedApi.patch.mockResolvedValueOnce(envelope({ deviceId: "d1" }));
    await iotService.updateConfig("d1", { readingTolerance: { t: { max: 3 } } });
    expect(mockedApi.patch).toHaveBeenCalledWith("/api/v1/iot/devices/d1", {
      readingTolerance: { t: { max: 3 } },
    });
  });

  it("issueToken POSTs /token and returns the one-time token", async () => {
    mockedApi.post.mockResolvedValueOnce(envelope({ deviceId: "d1", token: "iot_x", rotated: false }));
    await expect(iotService.issueToken("d1")).resolves.toMatchObject({ token: "iot_x" });
    expect(mockedApi.post).toHaveBeenCalledWith("/api/v1/iot/devices/d1/token");
  });

  it("revokeToken DELETEs /token", async () => {
    mockedApi.delete.mockResolvedValueOnce(envelope({ deviceId: "d1", hasToken: false }));
    await iotService.revokeToken("d1");
    expect(mockedApi.delete).toHaveBeenCalledWith("/api/v1/iot/devices/d1/token");
  });
});
