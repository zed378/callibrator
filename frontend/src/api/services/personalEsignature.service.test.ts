/**
 * P21-15 (ADR-140) — the personal e-signature service calls the contract's paths with the right
 * parameters and bodies, and answers the envelope's `data`. The generated client is mocked.
 */
jest.mock("../typed", () => ({
  typedApi: { GET: jest.fn(async () => ({ data: { data: "got" } })), POST: jest.fn(async () => ({ data: { data: "posted" } })) },
  unwrap: (r: { data: unknown }) => r.data,
}));

import { typedApi } from "../typed";
import { personalEsignatureService as service } from "./personalEsignature.service";

const GET = typedApi.GET as unknown as jest.Mock;
const POST = typedApi.POST as unknown as jest.Mock;
const cred = { authMethod: "password" as const, credential: "x" };

describe("personalEsignatureService", () => {
  it("reads mine and a record's applications", async () => {
    expect(await service.mine()).toBe("got");
    expect(GET).toHaveBeenLastCalledWith("/api/v1/esignature/me");
    expect(await service.recordApplications("r1")).toBe("got");
    expect(GET).toHaveBeenLastCalledWith("/api/v1/calibration-records/{calibrationRecordId}/esignatures", { params: { path: { calibrationRecordId: "r1" } } });
  });

  it("saves, revokes, signs a document and signs a record", async () => {
    expect(await service.save({ specimenSvg: "<svg/>", ...cred })).toBe("posted");
    expect(POST).toHaveBeenLastCalledWith("/api/v1/esignature/me", { body: { specimenSvg: "<svg/>", ...cred } });
    await service.revoke({ ...cred, reason: "Lost" });
    expect(POST).toHaveBeenLastCalledWith("/api/v1/esignature/me/revoke", { body: { ...cred, reason: "Lost" } });
    await service.signDocument({ title: "t", contentHash: "a".repeat(64), sizeBytes: 1, meaning: "authored", ...cred });
    expect(POST).toHaveBeenLastCalledWith("/api/v1/esignature/documents", expect.objectContaining({ body: expect.objectContaining({ title: "t" }) as unknown }));
    await service.signRecord("r1", { meaning: "performed", ...cred });
    expect(POST).toHaveBeenLastCalledWith("/api/v1/calibration-records/{calibrationRecordId}/esignatures", { params: { path: { calibrationRecordId: "r1" } }, body: { meaning: "performed", ...cred } });
  });
});
