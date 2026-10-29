/**
 * ADR-042 step 3 (S-01) -- CMS images are public on purpose: uploaded under
 * content:create, recorded in the audit log, or not kept at all.
 */
import type * as UploadUtilModule from "../../utils/upload.util";

jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
// P8-01 (ADR-086 Amendment 1): the image is in platform storage; a refused
// upload is removed through deleteUpload (from storage and the legacy folder).
jest.mock("../../utils/upload.util", () => ({
  ...(jest.requireActual<typeof UploadUtilModule>("../../utils/upload.util") as unknown as Record<string, unknown>),
  deleteUpload: jest.fn(),
}));

interface UploadUtil {
  deleteUpload: jest.Mock;
}

interface AuditService {
  logAction: jest.Mock;
}

interface ContentMediaService {
  recordMediaUpload: (file: unknown, actor?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const uploadUtil = require("../../utils/upload.util") as UploadUtil;
const auditService = require("../../services/audit.service") as AuditService;
const { recordMediaUpload } = require("../../services/contentMedia.service") as ContentMediaService;
/* eslint-enable @typescript-eslint/no-require-imports */

const FILE = {
  path: "global/content/123-abc.png",
  filename: "123-abc.png",
  originalname: "hero.png",
  mimetype: "image/png",
  size: "2048",
};

beforeEach(() => jest.clearAllMocks());

describe("contentMedia.service -- recordMediaUpload", () => {
  it("ADR-042: returns the PUBLIC url and writes an attributed audit row", async () => {
    auditService.logAction.mockResolvedValue({ id: 1 });
    const out = await recordMediaUpload(FILE, {
      userId: "u-1",
      tenantId: "t-1",
      ipAddress: "10.0.0.1",
      userAgent: "jest",
    });
    expect(out).toEqual({
      url: "/uploads/public/cms/123-abc.png",
      fileName: "123-abc.png",
      mimeType: "image/png",
      size: 2048,
    });
    expect(auditService.logAction).toHaveBeenCalledWith({
      tenantId: "t-1",
      userId: "u-1",
      action: "CREATE",
      resourceType: "ContentMedia",
      resourceId: null,
      changes: {
        url: "/uploads/public/cms/123-abc.png",
        originalName: "hero.png",
        mimeType: "image/png",
        size: "2048",
        public: true,
      },
      ipAddress: "10.0.0.1",
      userAgent: "jest",
    });
  });

  it("ADR-042: an upload the audit log could not record is deleted and refused", async () => {
    auditService.logAction.mockResolvedValue(null);
    uploadUtil.deleteUpload.mockRejectedValue(new Error("already gone"));
    await expect(recordMediaUpload(FILE)).rejects.toMatchObject({ status: 500 });
    // P8-01: by name, from the CMS folder -- FILE.path is now a storage key,
    // which an unlink of it would never have removed.
    expect(uploadUtil.deleteUpload).toHaveBeenCalledWith("123-abc.png", "uploads/public/cms");
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, userId: null, ipAddress: null, userAgent: null }),
    );
  });

  it("A-282 (ADR-100): an upload by an API key is system:api-key, the key in changes, never a user", async () => {
    auditService.logAction.mockResolvedValue({ id: 2 });
    await recordMediaUpload(FILE, { userId: null, apiKeyId: "key-1", tenantId: "t-1" });
    const [entry] = auditService.logAction.mock.calls[0] as [Record<string, unknown>];
    expect(entry).toMatchObject({ tenantId: "t-1", systemActor: "system:api-key" });
    expect(entry).not.toHaveProperty("userId");
    expect((entry["changes"] as Record<string, unknown>)["apiKeyId"]).toBe("key-1");
  });

  it("refuses a request with no file", async () => {
    await expect(recordMediaUpload(undefined)).rejects.toMatchObject({ status: 400 });
    expect(auditService.logAction).not.toHaveBeenCalled();
  });
});
