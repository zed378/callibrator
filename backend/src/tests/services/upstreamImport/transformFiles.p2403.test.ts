/**
 * P24-03 — services/upstreamImport/transformFiles.ts: the photo catalogue of the tenant's completed
 * image imports (their manifests, oldest first; a removed one skipped), the storage bound to the
 * tenant (facility keys by the real key rules, bytes in the fake store), and the clean-up after the
 * transform — the re-keyed originals after a commit, everything written after a rollback.
 *
 * Synthetic values only.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { FakeStorageModule } from "../../fixtures/fakeStorage";
import type * as TransformFilesModule from "../../../services/upstreamImport/transformFiles";

jest.mock("../../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../../fixtures/fakeStorage").createFakeStorage(),
);
const findAll = jest.fn();
jest.mock("../../../models", () => ({ UpstreamFileImport: { findAll: (...a: unknown[]) => findAll(...a) as unknown } }));
const mockDir = { value: "" };
jest.mock("../../../services/upstreamFileImport/workspace", () => ({
  importPaths: (id: string) => ({ manifest: `${mockDir.value}/${id}.jsonl` }),
}));
const warn = jest.fn();
jest.mock("../../../middlewares/activityLog.middleware", () => ({ logger: { warn: (...a: unknown[]) => warn(...a) as unknown } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks
const storage = require("../../../services/storage") as FakeStorageModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks
const { loadTransformFiles, manifestsOf, settleTransformFiles } = require("../../../services/upstreamImport/transformFiles") as typeof TransformFilesModule;

const TENANT = "a2403000-0000-4000-8000-0000000000a1";
const FAC = "a2403000-0000-4000-8000-0000000000b1";
const IMPORT_1 = "a2403000-0000-4000-8000-000000000101";
const IMPORT_2 = "a2403000-0000-4000-8000-000000000102";
const GONE = "a2403000-0000-4000-8000-000000000103";

beforeAll(() => {
  mockDir.value = fs.mkdtempSync(path.join(os.tmpdir(), "p2403-"));
  fs.writeFileSync(
    path.join(mockDir.value, `${IMPORT_1}.jsonl`),
    `${JSON.stringify({ sourcePath: "foto_depan/a.jpg", outcome: "ingested", detectedType: "jpeg", sourceSha256: "s", storedSha256: "h", storageKey: "k1" })}\n`,
  );
  fs.writeFileSync(
    path.join(mockDir.value, `${IMPORT_2}.jsonl`),
    `${JSON.stringify({ sourcePath: "foto_depan/a.jpg", outcome: "quarantined", reason: "virus_found" })}\n`,
  );
});

afterAll(() => {
  fs.rmSync(mockDir.value, { recursive: true, force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  storage.__reset();
  findAll.mockResolvedValue([{ id: IMPORT_1 }, { id: GONE }, { id: IMPORT_2 }]);
});

describe("P24-03 the transform's files", () => {
  it("reads the completed imports into the tenant, oldest first, at most 1,000; a removed manifest is skipped", async () => {
    expect(await manifestsOf(TENANT)).toHaveLength(2);
    expect(findAll).toHaveBeenCalledWith({
      where: { targetTenantId: TENANT, status: "completed" },
      attributes: ["id"],
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"],
      ],
      limit: 1000,
    });
  });

  it("the catalogue is the manifests' latest decision; keys carry the facility; bytes go to the tenant's storage", async () => {
    const files = await loadTransformFiles(TENANT);
    expect(storage.getTenantStorage).toHaveBeenCalledWith(TENANT);
    expect(Object.fromEntries(files.catalogue)).toEqual({ "foto_depan/a.jpg": { outcome: "quarantined", reason: "virus_found" } });
    const key = files.buildKey("x.jpg", FAC);
    expect(key).toBe(`t/${TENANT}/f/${FAC}/attachments/x.jpg`);
    expect(files.buildKey("x.jpg", null)).toBe(`t/${TENANT}/attachments/x.jpg`);
    await files.putObject(key, Buffer.from("bytes"), "image/jpeg");
    expect(storage.__objects.get(key)?.contentType).toBe("image/jpeg");
    expect(await files.readObject(key)).toEqual(Buffer.from("bytes"));
    await files.removeObject(key);
    expect(storage.__objects.has(key)).toBe(false);
    expect(files.newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect([files.created, files.superseded]).toEqual([[], []]);
  });

  it("settles: a commit removes the superseded originals, a rollback what was written; a failed removal is counted and logged", async () => {
    const files = await loadTransformFiles(TENANT);
    for (const name of ["old", "new"]) {
      await files.putObject(`t/${TENANT}/attachments/${name}.jpg`, Buffer.from(name), "image/jpeg");
    }
    files.superseded.push(`t/${TENANT}/attachments/old.jpg`);
    files.created.push(`t/${TENANT}/attachments/new.jpg`);
    expect(await settleTransformFiles(files, true)).toBe(0);
    expect([...storage.__objects.keys()]).toEqual([`t/${TENANT}/attachments/new.jpg`]);
    expect(await settleTransformFiles(files, false)).toBe(0);
    expect(storage.__objects.size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    const failing = { ...files, removeObject: () => Promise.reject(new Error("store down")) };
    expect(await settleTransformFiles(failing, false)).toBe(1);
    expect(warn).toHaveBeenCalledWith("Upstream transform: objects left behind", { committed: false, failed: 1 });
  });
});
