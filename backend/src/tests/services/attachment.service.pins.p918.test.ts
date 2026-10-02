/**
 * P9-18 — one behaviour of attachment.service no unit suite asserted. The
 * service's conversion to TypeScript planted it as a defect in a scratch
 * mirror (removing the call), and all 49 attachment suites still passed:
 *
 * ADR-042 step 6 (S-01) — deleting an attachment removes its FILE as well as
 * the row, and only AFTER the transaction has committed: a filesystem unlink
 * cannot be rolled back, so done inside, a failed commit would leave a live
 * row whose evidence is gone. A delete the transaction refuses keeps the file.
 * (The opt-in live suite, attachmentService.p918.live, proves it on disk.)
 */
import fs from "fs";
import path from "path";
import type * as AttachmentServiceModule from "../../services/attachment.service";

const mockEvents: string[] = [];
let mockCommitFails = false;

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async (work: (t: unknown) => Promise<unknown>) => {
      mockEvents.push("begin");
      const out = await work({ id: "tx" });
      if (mockCommitFails) {
        mockEvents.push("rollback");
        throw new Error("commit failed");
      }
      mockEvents.push("commit");
      return out;
    }),
  },
}));
jest.mock("../../models", () => ({
  Attachment: { findOne: jest.fn() },
  Certificate: { findOne: jest.fn(() => Promise.resolve(null)) },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(() => {
    mockEvents.push("audit");
    return Promise.resolve({});
  }),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above */
const attachmentService = require("../../services/attachment.service") as typeof AttachmentServiceModule;
const models = require("../../models") as unknown as { Attachment: { findOne: jest.Mock } };
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111";

const row = (): Record<string, unknown> => ({
  id: "att-1",
  tenantId: TENANT,
  resourceType: "device",
  resourceId: null,
  folder: "uploads/attachments",
  fileName: "p918-pin.txt",
  originalName: "pin.txt",
  checksum: "c",
  save: jest.fn(() => {
    mockEvents.push("save");
    return Promise.resolve();
  }),
});

describe("attachment.service — S-01: a delete removes the file, after the commit", () => {
  let rm: jest.SpyInstance;

  beforeEach(() => {
    mockEvents.length = 0;
    mockCommitFails = false;
    models.Attachment.findOne.mockResolvedValue(row());
    rm = jest.spyOn(fs.promises, "rm").mockImplementation((target) => {
      mockEvents.push(`rm:${path.basename(String(target))}`);
      return Promise.resolve();
    });
  });
  afterEach(() => {
    rm.mockRestore();
  });

  it("removes the row's file, resolved inside the uploads tree, once the transaction has committed", async () => {
    await expect(attachmentService.deleteAttachment(TENANT, "att-1", { userId: "u1" })).resolves.toEqual({ id: "att-1" });

    expect(mockEvents).toEqual(["begin", "save", "audit", "commit", "rm:p918-pin.txt"]);
    expect(rm).toHaveBeenCalledWith(attachmentService.resolveAbsPath({ folder: "uploads/attachments", fileName: "p918-pin.txt" }), { force: true });
  });

  it("a delete whose transaction fails keeps the file", async () => {
    mockCommitFails = true;

    await expect(attachmentService.deleteAttachment(TENANT, "att-1", { userId: "u1" })).rejects.toThrow("commit failed");
    expect(rm).not.toHaveBeenCalled();
  });

  it("a file that cannot be removed does not turn the committed delete into an error", async () => {
    rm.mockRejectedValueOnce(new Error("EPERM"));

    await expect(attachmentService.deleteAttachment(TENANT, "att-1", { userId: "u1" })).resolves.toEqual({ id: "att-1" });
  });
});
