/**
 * ADR-042 step 3 (S-01) — CMS images are public on purpose: uploaded under
 * content:create, recorded in the audit log, or not kept at all.
 */
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return { ...actual, promises: { ...actual.promises, unlink: jest.fn() } };
});

const fs = require("fs");
const auditService = require("../../services/audit.service");
const { recordMediaUpload } = require("../../services/contentMedia.service");

const FILE = {
  path: "/srv/uploads/public/cms/123-abc.png",
  filename: "123-abc.png",
  originalname: "hero.png",
  mimetype: "image/png",
  size: "2048",
};

beforeEach(() => jest.clearAllMocks());

describe("contentMedia.service — recordMediaUpload", () => {
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
    fs.promises.unlink.mockRejectedValue(new Error("already gone"));
    await expect(recordMediaUpload(FILE)).rejects.toMatchObject({ status: 500 });
    expect(fs.promises.unlink).toHaveBeenCalledWith(FILE.path);
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, userId: null, ipAddress: null, userAgent: null }),
    );
  });

  it("refuses a request with no file", async () => {
    await expect(recordMediaUpload(undefined)).rejects.toMatchObject({ status: 400 });
    expect(auditService.logAction).not.toHaveBeenCalled();
  });
});
