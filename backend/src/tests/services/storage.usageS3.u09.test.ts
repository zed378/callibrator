/**
 * U-09 (2026-10-05) — storage usage on S3: the defect the live run found.
 *
 * `ScopedStorage.usage()` (GET /api/v1/storage/usage, the quota/metering
 * input) listed with `limit: Number.MAX_SAFE_INTEGER`, which the S3 driver
 * sent as `MaxKeys`. Every real S3 server refuses it — SeaweedFS "Argument
 * maxKeys must be an integer between 0 and 2147483647", Versity S3 Gateway
 * "Provided 9007199254740991 not an integer or within integer range" (AWS's
 * own wording) — so usage on an S3 tenant failed on every call. And had it
 * been accepted, S3 answers at most 1000 keys per page and usage() read only
 * the first page: a tenant with 2,500 objects would have been counted as 1,000.
 * The doubles in storage.index.test.js pinned the bad limit as the contract.
 *
 * Fail-before: against the code before the fix, "sends a MaxKeys S3 accepts"
 * saw 9007199254740991, and "counts every page" rejected with the server's
 * InvalidArgument (with the limit alone fixed, it counted 1000 of 2500).
 *
 * The S3 server here is a stand-in for `client.send` that behaves as the live
 * servers did (storage.s3.u09.live.test.ts runs the same path against them):
 * MaxKeys above 2^31-1 is an InvalidArgument, and a page holds at most 1000.
 */
import { ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import S3Driver from "../../services/storage/s3.driver";
import storage from "../../services/storage";

const TENANT = "a0900000-0000-4000-8000-0000000000c3";

const newDriver = (): S3Driver =>
  new S3Driver({
    bucket: "u09-unit",
    endpoint: "http://127.0.0.1:1",
    endpointTrusted: true,
    accessKeyId: "AKIAU09UNIT",
    secretAccessKey: "u09-unit-secret",
  });

/** An in-memory bucket answering ListObjectsV2 and HeadObject the way S3 does. */
const emulateS3 = (driver: S3Driver, objectKeys: string[], size: number): jest.SpyInstance => {
  const sorted = [...objectKeys].sort();
  return jest.spyOn(driver.client, "send").mockImplementation(((command: unknown) => {
    if (command instanceof ListObjectsV2Command) {
      const { Prefix = "", MaxKeys = 1000, ContinuationToken } = command.input;
      if (!Number.isInteger(MaxKeys) || MaxKeys < 0 || MaxKeys > 2147483647) {
        return Promise.reject(Object.assign(
          new Error(`Provided ${String(MaxKeys)} not an integer or within integer range`),
          { name: "InvalidArgument", $metadata: { httpStatusCode: 400 } },
        ));
      }
      const matching = sorted.filter((k) => k.startsWith(Prefix));
      const start = ContinuationToken ? Number(ContinuationToken) : 0;
      const pageSize = Math.min(MaxKeys, 1000);
      const page = matching.slice(start, start + pageSize);
      const next = start + page.length;
      const truncated = next < matching.length;
      return Promise.resolve({
        Contents: page.map((Key) => ({ Key })),
        IsTruncated: truncated,
        NextContinuationToken: truncated ? String(next) : undefined,
      });
    }
    if (command instanceof HeadObjectCommand) {
      return Promise.resolve({ ContentLength: size });
    }
    return Promise.reject(new Error("unexpected command"));
  }) as never);
};

/** The command of the spied send's first call. */
const firstCommand = (send: jest.SpyInstance): ListObjectsV2Command =>
  (send.mock.calls as unknown[][])[0]?.[0] as ListObjectsV2Command;

describe("U-09 — storage usage on an S3 tenant", () => {
  it("sends a MaxKeys S3 accepts when a caller asks for 'everything'", async () => {
    const driver = newDriver();
    const send = emulateS3(driver, [], 0);
    await driver.list(`t/${TENANT}/`, { limit: Number.MAX_SAFE_INTEGER });
    expect(firstCommand(send).input.MaxKeys).toBe(1000);
  });

  it("keeps a smaller limit as given", async () => {
    const driver = newDriver();
    const send = emulateS3(driver, [], 0);
    await driver.list(`t/${TENANT}/`, { limit: 2 });
    expect(firstCommand(send).input.MaxKeys).toBe(2);
  });

  it("counts every page, not the first 1000", async () => {
    const driver = newDriver();
    const objectKeys = Array.from({ length: 2500 }, (_, i) => `t/${TENANT}/attachments/f-${String(i).padStart(5, "0")}.bin`);
    emulateS3(driver, [...objectKeys, "t/someone-else/attachments/x.bin"], 4);
    const scoped = new storage.ScopedStorage(driver, TENANT);
    await expect(scoped.usage()).resolves.toEqual({ bytes: 10000, objects: 2500 });
  });

  it("follows the driver's cursor and passes it back", async () => {
    const list = jest.fn()
      .mockResolvedValueOnce({ keys: ["a", "b"], cursor: "page-2" })
      .mockResolvedValueOnce({ keys: ["c"], cursor: null });
    const stat = jest.fn().mockResolvedValue({ size: 10 });
    // A driver with only what usage() calls.
    const partialDriver = { name: "s3", list, stat };
    const scoped = new storage.ScopedStorage(partialDriver as never, TENANT);
    await expect(scoped.usage("attachments")).resolves.toEqual({ bytes: 30, objects: 3 });
    expect(list).toHaveBeenNthCalledWith(1, `t/${TENANT}/attachments/`, { limit: Number.MAX_SAFE_INTEGER });
    expect(list).toHaveBeenNthCalledWith(2, `t/${TENANT}/attachments/`, { limit: Number.MAX_SAFE_INTEGER, cursor: "page-2" });
  });
});
