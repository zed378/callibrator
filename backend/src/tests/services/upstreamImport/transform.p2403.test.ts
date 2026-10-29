/**
 * P24-03 — the transform's step 9 (services/upstreamImport/transform/attachments.ts, photoFiles.ts)
 * over a statement double and an in-memory object store: the registry, the photo name and hash,
 * the manifest catalogue, the plan of every photo, what the step writes (objects under the device's
 * facility, the row, the replace, the audit rows, the mapping), what it quarantines, the runner's
 * per-folder accounting. The same statements run on PostgreSQL 18 in
 * migrations/upstreamTransform.p2403.live, with every step in order.
 *
 * Synthetic values and generated images only.
 */
import { createHash } from "crypto";
import type { Transaction } from "sequelize";
import type * as StepsModule from "../../../services/upstreamImport/transform/steps";
import type * as AuditRowsModule from "../../../services/upstreamImport/transform/auditRows";
import type * as RunnerModule from "../../../services/upstreamImport/transform/runner";
import type * as AttachmentsModule from "../../../services/upstreamImport/transform/attachments";
import type * as PhotoFilesModule from "../../../services/upstreamImport/transform/photoFiles";
import type * as DerivativesModule from "../../../services/devicePhoto/imageDerivatives";
import type { StepContext, TransformStep } from "../../../services/upstreamImport/transform/steps";
import type { LivePhoto, PhotoMapping, PhotoRow } from "../../../services/upstreamImport/transform/attachments";
import type { PhotoSource, TransformFiles } from "../../../services/upstreamImport/transform/photoFiles";
import { jpeg } from "../../fixtures/photoFixtures";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";

// The backend's jest transform does not hoist jest.mock: the modules under test are required after it.
const mockFault: { value: Error | null } = { value: null };
jest.mock("../../../services/devicePhoto/imageDerivatives", () => {
  const actual = jest.requireActual<typeof DerivativesModule>("../../../services/devicePhoto/imageDerivatives");
  return {
    ...actual,
    buildDerivatives: (type: "jpeg" | "png", buf: Buffer) => {
      if (mockFault.value !== null) {
        throw mockFault.value;
      }
      return actual.buildDerivatives(type, buf);
    },
  };
});
/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mock */
const { TRANSFORM_STEPS, isBuilt } = require("../../../services/upstreamImport/transform/steps") as typeof StepsModule;
const { STEP_AUDITED } = require("../../../services/upstreamImport/transform/auditRows") as typeof AuditRowsModule;
const { runTransform } = require("../../../services/upstreamImport/transform/runner") as typeof RunnerModule;
const { CERTIFICATE_SOURCE, PHOTO_FOLDERS, accountPhotos, photoHashOf, photoNameOf, planPhotos, runAttachments } = require("../../../services/upstreamImport/transform/attachments") as typeof AttachmentsModule;
const { catalogueOf } = require("../../../services/upstreamImport/transform/photoFiles") as typeof PhotoFilesModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const RUN = "a2403000-0000-4000-8000-0000000000f1";
const TENANT = "a2403000-0000-4000-8000-0000000000a1";
const FAC = "a2403000-0000-4000-8000-0000000000b1";
const DEVICE = "a2403000-0000-4000-8000-0000000000c1";
const DEVICE_2 = "a2403000-0000-4000-8000-0000000000c2";
const OLD = "a2403000-0000-4000-8000-0000000000d1";
const MANUAL = "a2403000-0000-4000-8000-0000000000d2";
const TX = { id: "tx" } as unknown as Transaction;
const ZONE = "Asia/Jakarta";

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

interface Call {
  text: string;
  bind: readonly unknown[];
  transaction: unknown;
}

const double = (rules: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    query: (text: string, options: SqlQueryOptions) => {
      const call = { text, bind: options.bind ?? [], transaction: options.transaction };
      calls.push(call);
      const rule = rules.find(([pattern]) => pattern.test(text));
      return Promise.resolve(rule ? rule[1](call) : []);
    },
  };
};

const context = (runner: SqlRunner, files?: TransformFiles): StepContext => ({
  runId: RUN,
  runner,
  transaction: TX,
  tenantId: TENANT,
  sourceZone: ZONE,
  ...(files ? { files } : {}),
});

/** An in-memory object store behind TransformFiles. */
const store = (catalogue: Map<string, PhotoSource>, objects: Map<string, Buffer> = new Map()) => {
  let n = 0;
  const files: TransformFiles & { objects: Map<string, Buffer> } = {
    objects,
    catalogue,
    buildKey: (name, facility) => (facility === null ? `t/${TENANT}/attachments/${name}` : `t/${TENANT}/f/${facility}/attachments/${name}`),
    readObject: (key) => {
      const bytes = objects.get(key);
      return bytes ? Promise.resolve(bytes) : Promise.reject(new Error("NoSuchKey"));
    },
    putObject: (key, bytes) => {
      objects.set(key, bytes);
      return Promise.resolve();
    },
    removeObject: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
    newId: () => `a2403000-0000-4000-8000-00000000e00${String((n += 1))}`,
    created: [],
    superseded: [],
  };
  return files;
};

const ingested = (key: string, bytes: Buffer, derivatives = false): PhotoSource => ({
  outcome: "ingested",
  storageKey: key,
  storedSha256: sha(bytes),
  type: "jpeg",
  derivatives,
});

describe("P24-03 the registry", () => {
  it("step 9 is built over the certificate index, audits itself and accounts the photo folders; every step is built", () => {
    const step = TRANSFORM_STEPS.find((s) => s.id === "attachments") as TransformStep;
    expect(step.sources).toEqual([CERTIFICATE_SOURCE]);
    expect(CERTIFICATE_SOURCE).toEqual({ table: "trx_inventory_file", legacyId: 's."id"::text' });
    expect(step.run).toBe(runAttachments);
    expect(step.account).toBe(accountPhotos);
    // P24-02h: step 10 accounts the device rows' own calibration dates; no other step accounts beyond its sources.
    expect(TRANSFORM_STEPS.filter((s) => s.account !== undefined).map((s) => s.id)).toEqual(["attachments", "calibration_records"]);
    expect(STEP_AUDITED.has("attachments")).toBe(true);
    expect(isBuilt(TRANSFORM_STEPS)).toBe(true);
    expect(PHOTO_FOLDERS).toEqual([
      { folder: "foto_depan", purpose: "device_front" },
      { folder: "foto_sn", purpose: "device_serial_plate" },
    ]);
  });
});

describe("P24-03 the photo name and hash", () => {
  it.each([
    ["https://old.example.test/uploads/foto_depan/abc.jpg", "abc.jpg"],
    ["http://10.0.0.1/public/uploads/foto_sn/x%20y.JPG?v=2#top", "x y.JPG"],
    ["  bare_name.png  ", "bare_name.png"],
    ["C:\\upload\\win.jpg", "win.jpg"],
    ["https://h/a/100%.jpg", "100%.jpg"],
    ["https://h/a/%2F.jpg", null],
    ["https://h/uploads/", null],
    ["..", null],
    [".", null],
    ["", null],
    [null, null],
  ])("%s → %s", (value, name) => {
    expect(photoNameOf(value)).toBe(name);
  });

  it("the hash is SHA-256 of the source path and the stored hash: the same file is unchanged, another is not", () => {
    expect(photoHashOf("foto_depan/a.jpg", "1".repeat(64))).toBe(sha(`foto_depan/a.jpg\n${"1".repeat(64)}`));
    expect(photoHashOf("foto_depan/a.jpg", "1".repeat(64))).not.toBe(photoHashOf("foto_depan/a.jpg", "2".repeat(64)));
  });
});

describe("P24-03 the catalogue of the manifests", () => {
  const line = (o: object): string => JSON.stringify(o);
  it("oldest first, the latest line of a path decides; a skip reuses the earlier ingest of the same hash; torn and foreign lines are skipped", () => {
    const first = [
      line({ sourcePath: "foto_depan/a.jpg", outcome: "ingested", detectedType: "jpeg", sourceSha256: "s1", storedSha256: "h1", storageKey: "k1" }),
      line({ sourcePath: "foto_depan/b.heic", outcome: "quarantined", reason: "heic_converter_unavailable", detectedType: "heic" }),
      line({ sourcePath: "foto_sn/c.png", outcome: "ingested", detectedType: "png", sourceSha256: "s3", storedSha256: "h3", storageKey: "k3" }),
      line({ sourcePath: "foto_sn/d.jpg", outcome: "ingested", detectedType: "heic", sourceSha256: "s4", storedSha256: "h4", storageKey: "k4" }),
      line({ sourcePath: "foto_sn/e.jpg", outcome: "ingested", detectedType: "jpeg", sourceSha256: "s5" }),
      line({ sourcePath: "foto_sn/f.jpg", outcome: "quarantined" }),
      line({ sourcePath: "foto_sn/i.jpg", outcome: "ingested", detectedType: "jpeg", sourceSha256: "s6", storageKey: "k6" }),
      line({ sourcePath: "foto_sn/j.jpg", outcome: "ingested", detectedType: "jpeg", storedSha256: "h7", storageKey: "k7" }),
      "5",
      line({ sourcePath: "foto_sn/k.jpg" }),
      '{"sourcePath": "foto_depan/torn.jpg", "outco',
      "null",
      line({ outcome: "ingested" }),
      "",
    ].join("\n");
    const second = [
      line({ sourcePath: "foto_depan/a.jpg", outcome: "skipped_present", detectedType: "jpeg", sourceSha256: "s1" }),
      // the ETL's HEIC conversion, re-imported under the same path with JPEG bytes (ADR-132 Am. 3)
      line({ sourcePath: "foto_depan/b.heic", outcome: "ingested", detectedType: "jpeg", sourceSha256: "s2", storedSha256: "h2", storageKey: "k2", derivatives: true }),
      line({ sourcePath: "foto_sn/c.png", outcome: "skipped_present", sourceSha256: "other" }),
      line({ sourcePath: "foto_sn/g.jpg", outcome: "skipped_present" }),
      line({ sourcePath: "foto_sn/h.jpg", outcome: "skipped_present", sourceSha256: "zz" }),
      line({ sourcePath: "foto_depan/a.jpg", outcome: "ingested", detectedType: "jpeg", sourceSha256: "s1b", storedSha256: "h1b", storageKey: "k1b" }),
      line({ sourcePath: "foto_depan/a.jpg", outcome: "skipped_present", sourceSha256: "s1" }),
    ].join("\n");
    const catalogue = catalogueOf([first, second]);
    expect(Object.fromEntries(catalogue)).toEqual({
      "foto_depan/a.jpg": { outcome: "ingested", storageKey: "k1", storedSha256: "h1", type: "jpeg", derivatives: false },
      "foto_depan/b.heic": { outcome: "ingested", storageKey: "k2", storedSha256: "h2", type: "jpeg", derivatives: true },
    });
  });
});

describe("P24-03 the plan", () => {
  const row = (values: Partial<PhotoRow>): PhotoRow => ({
    sourceRowNumber: "1",
    legacyId: "101",
    front: null,
    serial: null,
    deviceId: DEVICE,
    facilityId: FAC,
    ...values,
  });
  const a = Buffer.from("a");
  const catalogue = new Map<string, PhotoSource>([
    ["foto_depan/a.jpg", ingested("k/a", a)],
    ["foto_sn/a.jpg", ingested("k/sa", a)],
    ["foto_depan/h.heic", { outcome: "quarantined", reason: "heic_converter_unavailable" }],
    ["foto_depan/odd.jpg", { outcome: "quarantined", reason: "not_a_reason" as "virus_found" }],
  ]);

  it("decides every photo: no device, missing, refused by the ingest, unchanged, the operator's, a replace, a new one", () => {
    const rows = [
      row({ sourceRowNumber: "1", legacyId: "101", front: "https://h/u/a.jpg", serial: null, deviceId: null, facilityId: null }),
      row({ sourceRowNumber: "2", legacyId: "102", front: "https://h/u/", serial: "nope.jpg" }),
      row({ sourceRowNumber: "3", legacyId: "103", front: "h.heic", serial: null }),
      row({ sourceRowNumber: "4", legacyId: "104", front: "odd.jpg" }),
      row({ sourceRowNumber: "5", legacyId: "105", front: "a.jpg", serial: "a.jpg", deviceId: DEVICE }),
      row({ sourceRowNumber: "6", legacyId: "106", front: "a.jpg", serial: "a.jpg", deviceId: DEVICE_2, facilityId: null }),
    ];
    const mappings: PhotoMapping[] = [
      { folder: "foto_depan", legacyId: "105", targetId: OLD, rowHash: photoHashOf("foto_depan/a.jpg", sha(a)) },
      { folder: "foto_sn", legacyId: "105", targetId: OLD, rowHash: "0".repeat(64) },
      { folder: "foto_sn", legacyId: "106", targetId: OLD, rowHash: "0".repeat(64) },
    ];
    const live: LivePhoto[] = [
      { id: OLD, deviceId: DEVICE, purpose: "device_serial_plate", storageKey: "k/old" },
      { id: MANUAL, deviceId: DEVICE_2, purpose: "device_front", storageKey: "k/manual" },
    ];
    const plan = planPhotos(rows, mappings, live, catalogue);
    expect(plan.quarantine).toEqual([
      { sourceTable: "foto_depan", sourceRowNumber: "1", legacyId: "101", reason: "no_device" },
      { sourceTable: "foto_depan", sourceRowNumber: "2", legacyId: "102", reason: "file_missing" },
      { sourceTable: "foto_sn", sourceRowNumber: "2", legacyId: "102", reason: "file_missing" },
      { sourceTable: "foto_depan", sourceRowNumber: "3", legacyId: "103", reason: "heic_converter_unavailable" },
      { sourceTable: "foto_depan", sourceRowNumber: "4", legacyId: "104", reason: "ingest_failed" },
      { sourceTable: "foto_depan", sourceRowNumber: "6", legacyId: "106", reason: "photo_operator_managed" },
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.work).toEqual([
      expect.objectContaining({ folder: "foto_sn", purpose: "device_serial_plate", legacyId: "105", deviceId: DEVICE, replaces: live[0] }),
      expect.objectContaining({ folder: "foto_sn", purpose: "device_serial_plate", legacyId: "106", deviceId: DEVICE_2, facilityId: null, replaces: null }),
    ]);
    expect(plan.work[0]?.rowHash).toBe(photoHashOf("foto_sn/a.jpg", sha(a)));
  });
});

describe("P24-03 the step", () => {
  const photo = jpeg(48, 32);
  const tenantKey = (n: string): string => `t/${TENANT}/attachments/${n}.jpg`;

  beforeEach(() => {
    mockFault.value = null;
  });

  it("with no certificate index and no device table: nothing read, nothing written, no files needed", async () => {
    const runner = double([[/to_regclass/, () => [{ present: false }]]]);
    await runAttachments(context(runner));
    expect(runner.calls.filter((c) => !c.text.includes("to_regclass"))).toEqual([]);
  });

  it("quarantines every certificate-index row of the run certificate_archived_offline; a run naming no photo needs no files", async () => {
    const runner = double([[/to_regclass/, () => [{ present: true }]]]);
    await runAttachments(context(runner));
    const archive = runner.calls.find((c) => c.text.includes("'certificate_archived_offline'"));
    expect(archive?.text).toContain('FROM upstream_import."stg_trx_inventory_file" s');
    expect(archive?.text).toContain("ON CONFLICT DO NOTHING");
    expect(archive?.bind).toEqual([RUN]);
    const read = runner.calls.find((c) => c.text.includes("AS front"));
    expect(read?.text).toContain("m.source_table = 'trx_inventory'");
    expect(read?.text).toContain("d.tenant_id = $2 AND d.deleted_at IS NULL");
    expect(read?.bind).toEqual([RUN, TENANT]);
  });

  it("refuses a run naming photos when the transform was given no files", async () => {
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/AS front/, () => [{ sourceRowNumber: "1", legacyId: "1", front: "a.jpg", serial: null, deviceId: DEVICE, facilityId: FAC }]],
    ]);
    await expect(runAttachments(context(runner))).rejects.toMatchObject({ code: "TRANSFORM_FAILED" });
  });

  it("writes each photo under the device's facility with its derivatives, replaces the import's earlier photo, and quarantines what fails", async () => {
    const objects = new Map<string, Buffer>([
      [tenantKey("good"), photo],
      [tenantKey("bad"), Buffer.from("not the bytes")],
      [tenantKey("junk"), Buffer.from("ffd8ffe0 not a jpeg")],
    ]);
    const files = store(
      new Map<string, PhotoSource>([
        ["foto_depan/good.jpg", ingested(tenantKey("good"), photo)],
        ["foto_sn/good.jpg", ingested(tenantKey("good"), photo)],
        ["foto_depan/gone.jpg", ingested(tenantKey("gone"), photo)],
        ["foto_sn/bad.jpg", ingested(tenantKey("bad"), photo)],
        ["foto_depan/junk.jpg", ingested(tenantKey("junk"), Buffer.from("ffd8ffe0 not a jpeg"))],
      ]),
      objects,
    );
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [
        /AS front/,
        () => [
          { sourceRowNumber: "1", legacyId: "101", front: "good.jpg", serial: "good.jpg", deviceId: DEVICE, facilityId: FAC },
          { sourceRowNumber: "2", legacyId: "102", front: "gone.jpg", serial: "bad.jpg", deviceId: DEVICE_2, facilityId: FAC },
          { sourceRowNumber: "3", legacyId: "103", front: "junk.jpg", serial: null, deviceId: DEVICE_2, facilityId: FAC },
        ],
      ],
      [/FROM upstream_import\.id_map WHERE source_table = ANY/, () => [{ folder: "foto_sn", legacyId: "101", targetId: OLD, rowHash: "0".repeat(64) }]],
      [/FROM attachments/, () => [{ id: OLD, deviceId: DEVICE, purpose: "device_serial_plate", storageKey: "k/old" }]],
    ]);
    await runAttachments(context(runner, files));

    const facilityKeys = [...files.objects.keys()].filter((k) => k.startsWith(`t/${TENANT}/f/${FAC}/attachments/`)).sort();
    expect(facilityKeys).toEqual(
      ["e001.display.jpg", "e001.jpg", "e001.thumb.jpg", "e002.display.jpg", "e002.jpg", "e002.thumb.jpg"].map(
        (n) => `t/${TENANT}/f/${FAC}/attachments/a2403000-0000-4000-8000-00000000${n}`,
      ),
    );
    expect(files.objects.get(`t/${TENANT}/f/${FAC}/attachments/a2403000-0000-4000-8000-00000000e001.jpg`)).toEqual(photo);
    expect(files.created).toHaveLength(6);
    expect(files.superseded).toEqual([tenantKey("good"), tenantKey("good")]);

    const inserts = runner.calls.filter((c) => c.text.startsWith("INSERT INTO attachments"));
    expect(inserts.map((c) => c.bind)).toEqual([
      [
        "a2403000-0000-4000-8000-00000000e001",
        TENANT,
        "device",
        DEVICE,
        FAC,
        "device_front",
        "a2403000-0000-4000-8000-00000000e001.jpg",
        "device_front.jpg",
        "uploads/attachments",
        `t/${TENANT}/f/${FAC}/attachments/a2403000-0000-4000-8000-00000000e001.jpg`,
        "image/jpeg",
        photo.length,
        sha(photo),
      ],
      expect.arrayContaining(["a2403000-0000-4000-8000-00000000e002", "device_serial_plate", "device_serial_plate.jpg"]),
    ]);
    expect(inserts.every((c) => c.transaction === TX)).toBe(true);
    const replace = runner.calls.find((c) => c.text.startsWith("UPDATE attachments"));
    expect(replace?.text).toContain("SET is_deleted = true, updated_at = now() WHERE id = $1 AND tenant_id = $2 AND is_deleted = false");
    expect(replace?.bind).toEqual([OLD, TENANT]);
    const audits = runner.calls.filter((c) => c.text.startsWith("INSERT INTO audit_logs"));
    expect(audits.map((c) => [c.bind[2], c.bind[3]])).toEqual([
      ["CREATE", "a2403000-0000-4000-8000-00000000e001"],
      ["DELETE", OLD],
      ["CREATE", "a2403000-0000-4000-8000-00000000e002"],
    ]);
    expect(JSON.parse(audits[1]?.bind[5] as string)).toEqual({
      operation: "UPSTREAM_IMPORT",
      source: "skp_ipm",
      importRunId: RUN,
      sourceTable: "foto_sn",
      targetTable: "attachments",
      purpose: "device_serial_plate",
      replacedBy: "a2403000-0000-4000-8000-00000000e002",
    });
    expect(audits.every((c) => c.bind[1] === "system:upstream-transform" && c.bind[0] === TENANT && c.bind[4] === FAC)).toBe(true);

    const quarantine = runner.calls.find((c) => c.text.startsWith("INSERT INTO upstream_import.quarantine") && !c.text.includes("SELECT"));
    expect(quarantine?.bind).toEqual([
      RUN, "foto_depan", "2", "102", "file_missing",
      RUN, "foto_sn", "2", "102", "storage_verify_failed",
      RUN, "foto_depan", "3", "103", "image_undecodable",
    ]);
    const mapping = runner.calls.find((c) => c.text.startsWith("INSERT INTO upstream_import.id_map"));
    expect(mapping?.bind).toEqual([
      "foto_depan", "101", "attachments", "a2403000-0000-4000-8000-00000000e001", TENANT, FAC, RUN, photoHashOf("foto_depan/good.jpg", sha(photo)), null,
      "foto_sn", "101", "attachments", "a2403000-0000-4000-8000-00000000e002", TENANT, FAC, RUN, photoHashOf("foto_sn/good.jpg", sha(photo)), null,
    ]);
  });

  it("ADR-130 Am. 1: the ingest's derivatives are copied, never rebuilt; the tenant-scope copies are superseded with the original", async () => {
    // Any decode here would throw: the step must read the stored derivatives instead.
    mockFault.value = new Error("decoded although the ingest stored the derivatives");
    const display = Buffer.from("stored display");
    const thumb = Buffer.from("stored thumb");
    const files = store(
      new Map<string, PhotoSource>([["foto_depan/good.jpg", ingested(tenantKey("good"), photo, true)]]),
      new Map([
        [tenantKey("good"), photo],
        [`t/${TENANT}/attachments/good.display.jpg`, display],
        [`t/${TENANT}/attachments/good.thumb.jpg`, thumb],
      ]),
    );
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/AS front/, () => [{ sourceRowNumber: "1", legacyId: "101", front: "good.jpg", serial: null, deviceId: DEVICE, facilityId: FAC }]],
    ]);
    await runAttachments(context(runner, files));
    const at = (n: string): Buffer | undefined => files.objects.get(`t/${TENANT}/f/${FAC}/attachments/a2403000-0000-4000-8000-00000000${n}`);
    expect([at("e001.jpg"), at("e001.display.jpg"), at("e001.thumb.jpg")]).toEqual([photo, display, thumb]);
    expect(files.superseded).toEqual([tenantKey("good"), `t/${TENANT}/attachments/good.display.jpg`, `t/${TENANT}/attachments/good.thumb.jpg`]);
    expect(runner.calls.filter((c) => c.text.startsWith("INSERT INTO attachments"))).toHaveLength(1);
  });

  it("ADR-130 Am. 1: a manifest that names derivatives the storage no longer has falls back to building them", async () => {
    const files = store(
      new Map<string, PhotoSource>([["foto_depan/good.jpg", ingested(tenantKey("good"), photo, true)]]),
      new Map([[tenantKey("good"), photo]]),
    );
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/AS front/, () => [{ sourceRowNumber: "1", legacyId: "101", front: "good.jpg", serial: null, deviceId: DEVICE, facilityId: FAC }]],
    ]);
    await runAttachments(context(runner, files));
    const keys = [...files.objects.keys()].filter((k) => k.startsWith(`t/${TENANT}/f/${FAC}/`));
    expect(keys).toHaveLength(3);
    // Built here, so there is no tenant-scope derivative to supersede.
    expect(files.superseded).toEqual([tenantKey("good")]);
  });

  it("a derivative failure that is not an undecodable image fails the transform (the rollback removes the objects)", async () => {
    mockFault.value = new Error("encoder out of memory");
    const files = store(new Map<string, PhotoSource>([["foto_depan/good.jpg", ingested(tenantKey("good"), photo)]]), new Map([[tenantKey("good"), photo]]));
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/AS front/, () => [{ sourceRowNumber: "1", legacyId: "101", front: "good.jpg", serial: null, deviceId: DEVICE, facilityId: FAC }]],
    ]);
    await expect(runAttachments(context(runner, files))).rejects.toThrow("encoder out of memory");
  });

  it("accounts each photo folder: staged, mapped by this run, unchanged, unaccounted, quarantined by reason; no device table → zeros", async () => {
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/count\(\*\)::int AS staged/, (c) => (c.bind[1] === "foto_depan" ? [{ staged: 3, mapped: 1, unchanged: 1, unaccounted: 0 }] : [])],
      [/GROUP BY reason/, (c) => (c.bind[1] === "foto_depan" ? [{ reason: "file_missing", n: 1 }] : [])],
    ]);
    expect(await accountPhotos(context(runner))).toEqual([
      { table: "foto_depan", staged: 3, mapped: 1, unchanged: 1, quarantined: { file_missing: 1 }, unaccounted: 0 },
      { table: "foto_sn", staged: 0, mapped: 0, unchanged: 0, quarantined: {}, unaccounted: 0 },
    ]);
    const counted = runner.calls.find((c) => c.text.includes("AS staged"));
    expect(counted?.text).toContain("nullif(btrim(to_jsonb(s) ->> $2), '') IS NOT NULL");
    expect(counted?.text).toContain("LEFT JOIN upstream_import.id_map m ON m.source_table = $2");
    const none = double([[/to_regclass/, () => [{ present: false }]]]);
    expect((await accountPhotos(context(none))).map((c) => c.staged)).toEqual([0, 0]);
    expect(none.calls.some((c) => c.text.includes("AS staged"))).toBe(false);
  });
});

describe("P24-03 the runner's per-folder accounting", () => {
  const ROLE = "callibrator_transform";
  const db = { transaction: <T>(fn: (t: Transaction) => Promise<T>): Promise<T> => fn(TX) };
  const role = (): object[] => [{ currentUser: ROLE, superuser: false, canMap: true }];
  const accounted = (unaccounted: number): TransformStep => ({
    id: "photos",
    writes: ["attachments"],
    sources: [],
    run: () => Promise.resolve(),
    account: () => Promise.resolve([{ table: "foto_depan", staged: 2, mapped: 1, unchanged: 0, quarantined: { file_missing: 1 }, unaccounted }]),
  });

  it("puts the folders in the summary, passes the files to the steps, and fails TRANSFORM_INCOMPLETE on an unaccounted photo", async () => {
    const files = store(new Map());
    const seen: (TransformFiles | undefined)[] = [];
    const step: TransformStep = { ...accounted(0), run: (c) => Promise.resolve(void seen.push(c.files)) };
    const summary = await runTransform({ runId: RUN, db, runner: double([[/pg_roles/, role]]), role: ROLE, tenantId: TENANT, sourceZone: ZONE, files, steps: [step], now: () => 0 });
    expect(seen).toEqual([files]);
    expect(summary.steps).toEqual([{ step: "photos", durationMs: 0, sources: [{ table: "foto_depan", staged: 2, mapped: 1, unchanged: 0, quarantined: { file_missing: 1 } }] }]);
    await expect(
      runTransform({ runId: RUN, db, runner: double([[/pg_roles/, role]]), role: ROLE, tenantId: TENANT, sourceZone: ZONE, steps: [accounted(1)] }),
    ).rejects.toMatchObject({ code: "TRANSFORM_INCOMPLETE", message: "step photos: 1 staged row(s) of foto_depan are neither mapped nor quarantined" });
  });
});
