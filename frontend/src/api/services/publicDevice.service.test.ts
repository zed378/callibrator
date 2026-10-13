/**
 * P22-08 — the public-link service against the backend contract (P21-08): the four staff routes on the
 * device's path, the data from `data`, a refusal rejected.
 */
import { publicDeviceService as svc } from "./publicDevice.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const ok = <T,>(data: T) => ({ success: true, status: 200, message: "ok", data });
const ID = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const PATH = `/api/v1/calibration-devices/${ID}/public-token`;
const STATE = { active: false, issuedAt: null, issuedBy: null, lastRevokedAt: null, setting: "off" };
const ISSUED = { token: "Zx3kQ9vN2mP4rT6wY8aC1d", url: "https://x.test/d/Zx3kQ9vN2mP4rT6wY8aC1d", issuedAt: "2026-10-13T00:00:00.000Z" };

describe("publicDeviceService (P22-08)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("state, issue, rotate and revoke use the device's link path", async () => {
    mocked.get.mockResolvedValueOnce(ok(STATE));
    expect(await svc.state(ID)).toEqual(STATE);
    expect(mocked.get).toHaveBeenCalledWith(PATH);
    mocked.post.mockResolvedValueOnce(ok(ISSUED));
    expect(await svc.issue(ID)).toEqual(ISSUED);
    mocked.post.mockResolvedValueOnce(ok(ISSUED));
    expect(await svc.rotate(ID)).toEqual(ISSUED);
    expect(mocked.post.mock.calls.map((c) => c[0])).toEqual([PATH, `${PATH}/rotate`]);
    mocked.delete.mockResolvedValueOnce(ok({ revokedAt: "2026-10-13T01:00:00.000Z" }));
    await svc.revoke(ID);
    expect(mocked.delete).toHaveBeenCalledWith(PATH);
  });

  it("a refusal rejects (409 PUBLIC_TOKEN_ACTIVE)", async () => {
    mocked.post.mockRejectedValueOnce(new Error("This device already has a public link."));
    await expect(svc.issue(ID)).rejects.toThrow("already has a public link");
  });
});
