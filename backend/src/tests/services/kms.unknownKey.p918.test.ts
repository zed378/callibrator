/**
 * P9-18 (kms conversion, gate a): an envelope that names a master key the ring
 * does not hold is refused BY NAME.
 *
 * `decryptDEK` refuses an unknown key id before it tries any key, and logs
 * "envelope names a master key that is not configured" with that id, so an
 * operator who dropped KMS_MASTER_KEY_PREVIOUS too early is told which key is
 * missing. Removing that check still fails the decryption (the lookup yields
 * no key), but with the generic "KMS Decryption failed for DEK", and the
 * missing key goes unnamed. No suite pinned the difference: the planted-
 * defect run of the kms conversion found it. This one does.
 */
import type KmsService from "../../services/kms.service";

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock("../../middlewares/activityLog.middleware", () => ({ logger: mockLogger }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factory above
const kms = require("../../services/kms.service") as typeof KmsService;

describe("kms — an envelope naming an unconfigured master key", () => {
  beforeEach(() => {
    mockLogger.error.mockClear();
  });

  it("is refused, and the refusal names the missing key id", () => {
    const current = kms.encryptData("tenant-a", "secret") as string;
    const fields = current.split(":").slice(2);
    const foreign = ["v2", "deadbeefdeadbeef", ...fields].join(":");

    expect(() => kms.decryptData("tenant-a", foreign)).toThrow("Failed to decrypt data");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "KMS: envelope names a master key that is not configured",
      { keyId: "deadbeefdeadbeef" },
    );
    expect(mockLogger.error).not.toHaveBeenCalledWith("KMS Decryption failed for DEK", expect.anything());
  });

  it("an envelope under the current key still opens (the check is not a blanket refusal)", () => {
    const current = kms.encryptData("tenant-a", "secret") as string;
    expect(kms.decryptData("tenant-a", current)).toBe("secret");
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
