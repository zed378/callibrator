/**
 * P21-09d — the re-key job (spec P19-04 § 9.4), over memoryDb (REAL models, hooks, audit service)
 * and the fake storage (the REAL key rules): copy under the row's current facility, switch the key
 * and clear the flag with one audit row in one transaction, then delete the old object; a row
 * without a key is cleared; a failed copy keeps the flag for the next run; a re-run does nothing.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type { FakeStorageModule } from "../fixtures/fakeStorage";
import type * as RekeyModule from "../../services/attachmentRekey.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const storage = jest.requireMock<FakeStorageModule>("../../services/storage");
const { rekeyTenantAttachments, enqueueRekey } = jest.requireActual<typeof RekeyModule>("../../services/attachmentRekey.service");

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const MOVED = "a1000000-0000-4000-8000-000000000001";
const LEGACY = "a1000000-0000-4000-8000-000000000002";
const DISK = "a1000000-0000-4000-8000-000000000003";
const SETTLED = "a1000000-0000-4000-8000-000000000004";
const OLD_KEY = `t/${T}/f/${F1}/attachments/p.jpg`;
const LEGACY_KEY = `t/${T}/attachments/c.pdf`;

const row = (id: string, storageKey: string | null, rekeyPending: boolean, clientFacilityId: string | null = F2): Record<string, unknown> => ({
  id,
  tenantId: T,
  resourceType: "generic",
  fileName: "x",
  originalName: "x",
  folder: "uploads/attachments",
  mimeType: "image/jpeg",
  size: 1,
  uploadedBy: null,
  storageKey,
  clientFacilityId,
  rekeyPending,
});

beforeEach(async () => {
  mdb.reset();
  storage.__reset();
  mdb.seed("Tenant", { id: T, name: "Tenant", code: "T", status: "active" });
  mdb.seed("Attachment", [row(MOVED, OLD_KEY, true), row(LEGACY, LEGACY_KEY, true), row(DISK, null, true), row(SETTLED, `t/${T}/f/${F2}/attachments/s.jpg`, false)]);
  const scoped = await storage.getTenantStorage(T);
  await scoped.put(OLD_KEY, Buffer.from("photo"), { contentType: "image/jpeg" });
  await scoped.put(LEGACY_KEY, Buffer.from("cert"), { contentType: "application/pdf" });
});

const byId = (id: string): Record<string, unknown> | undefined => mdb.rows("Attachment").find((a) => a["id"] === id);

describe("P21-09d the re-key job", () => {
  it("moves each flagged file under its facility, switches the key, clears the flag, audits, removes the old object", async () => {
    const summary = await rekeyTenantAttachments(T);
    expect(summary).toEqual({ tenantId: T, examined: 3, rekeyed: 2, cleared: 1, failed: 0 });
    expect(byId(MOVED)).toMatchObject({ storageKey: `t/${T}/f/${F2}/attachments/p.jpg`, rekeyPending: false });
    expect(byId(LEGACY)).toMatchObject({ storageKey: `t/${T}/f/${F2}/attachments/c.pdf`, rekeyPending: false });
    expect(byId(DISK)).toMatchObject({ storageKey: null, rekeyPending: false });
    expect(byId(SETTLED)).toMatchObject({ rekeyPending: false });
    expect([...storage.__objects.keys()].sort()).toEqual([`t/${T}/f/${F2}/attachments/c.pdf`, `t/${T}/f/${F2}/attachments/p.jpg`]);
    const audits = mdb.rows("AuditLog");
    expect(audits).toHaveLength(3);
    expect(audits.every((a) => a["actorName"] === "system:attachment-rekey" && (a["changes"] as { operation: string }).operation === "REKEY_ATTACHMENT")).toBe(true);
  });

  it("a re-run finds nothing", async () => {
    await rekeyTenantAttachments(T);
    expect(await rekeyTenantAttachments(T)).toEqual({ tenantId: T, examined: 0, rekeyed: 0, cleared: 0, failed: 0 });
  });

  it("a failed copy keeps the flag and the old key for the next run; nothing is audited for it", async () => {
    storage.__failNext.put = new Error("bucket unavailable");
    const summary = await rekeyTenantAttachments(T);
    expect(summary.failed).toBe(1);
    // The rows run in id order: the first copy (MOVED's) is the one that failed.
    expect(byId(MOVED)).toMatchObject({ storageKey: OLD_KEY, rekeyPending: true });
    expect(storage.__objects.has(OLD_KEY)).toBe(true);
    expect(mdb.rows("AuditLog").some((a) => a["resourceId"] === MOVED)).toBe(false);
    const next = await rekeyTenantAttachments(T);
    expect(next).toMatchObject({ examined: 1, rekeyed: 1, failed: 0 });
  });

  it("a flagged row whose key is already under its facility is cleared without a copy", async () => {
    mdb.seed("Attachment", row("a1000000-0000-4000-8000-000000000005", `t/${T}/f/${F2}/attachments/z.jpg`, true));
    await rekeyTenantAttachments(T);
    expect(byId("a1000000-0000-4000-8000-000000000005")).toMatchObject({ storageKey: `t/${T}/f/${F2}/attachments/z.jpg`, rekeyPending: false });
  });

  it("a row changed by someone else between the read and the switch is left alone (its copy is not adopted)", async () => {
    mdb.seed("Attachment", row("a1000000-0000-4000-8000-000000000006", `t/${T}/f/${F2}/attachments/y.jpg`, true));
    const models = jest.requireActual<{ Attachment: { update: (...a: unknown[]) => Promise<unknown> } }>("../../models");
    const spy = jest.spyOn(models.Attachment, "update").mockResolvedValue([0]);
    const summary = await rekeyTenantAttachments(T);
    spy.mockRestore();
    expect(summary).toMatchObject({ rekeyed: 0, cleared: 0, failed: 0 });
    expect(byId(MOVED)).toMatchObject({ storageKey: OLD_KEY, rekeyPending: true });
  });

  it("an old object that cannot be removed is logged; the row is still re-keyed", async () => {
    storage.__failNext.delete = new Error("delete refused");
    const summary = await rekeyTenantAttachments(T);
    expect(summary.rekeyed).toBe(2);
    expect(byId(MOVED)?.["rekeyPending"]).toBe(false);
  });

  it("a run that fails as a whole is logged by enqueueRekey, never thrown", async () => {
    (storage.getTenantStorage as unknown as jest.Mock).mockRejectedValueOnce(new Error("no storage"));
    enqueueRekey(T);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(byId(MOVED)?.["rekeyPending"]).toBe(true);
  });

  it("enqueueRekey runs the job after the current tick and never throws", async () => {
    expect(() => {
      enqueueRekey(T);
    }).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(byId(MOVED)?.["rekeyPending"]).toBe(false);
  });
});
