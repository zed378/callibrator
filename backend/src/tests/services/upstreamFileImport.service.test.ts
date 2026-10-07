/**
 * The rsync image import's service end to end over the REAL models and tenant hooks
 * (fixtures/memoryDb), the REAL audit, KMS, batch-job (inline), notification, ingest and
 * workspace code — on SYNTHETIC files in a temporary work directory.
 *
 * Doubled: the network edge only — the host's address (resolveSource), the key scan, the dry-run
 * listing and the transfer (connection.ts: a double that writes synthetic files where rsync
 * would) — the tenant storage (an in-memory ScopedStorage), and the e-mail send (observed).
 * The tools themselves are proven by the live check (scripts/upstream/rsync-live-check.sh).
 *
 * THE CREDENTIAL LIFECYCLE is asserted, not assumed: encrypted at rest and bound to its row, never
 * in an answer, an audit row, a log line or a notification, and erased in the transaction that
 * ends the import — on completion, failure and cancel alike.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsBarrel from "../../models";
import type * as Service from "../../services/upstreamFileImport.service";
import type * as Connection from "../../services/upstreamFileImport/connection";
import type * as HostGuard from "../../services/upstreamFileImport/hostGuard";
import type * as KmsModule from "../../services/kms.service";
import type * as ChannelsModule from "../../services/notificationChannels.service";
import type * as BatchJobModule from "../../services/batchJob.service";
import type * as PlatformTenantModule from "../../constants/platformTenant";
import type * as ConstantsModule from "../../constants";
import type * as ActivityLog from "../../middlewares/activityLog.middleware";
import type * as IngestModule from "../../services/upstreamFileImport/ingest";
import { fingerprintOf } from "../../services/upstreamFileImport/hostKeys";
import { syntheticJpeg, syntheticPng, syntheticShellScript } from "../support/syntheticImages";
import { environment } from "../../config/env";

const penv = environment();
// Read at load by batchJob.service: jobs run in-process, no broker.
penv["BATCH_JOBS_INLINE"] = "true";
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "rsync-svc-"));
penv["UPSTREAM_FILE_IMPORT_DIR"] = WORK;

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/upstreamFileImport/connection", () => {
  const actual = jest.requireActual<typeof Connection>("../../services/upstreamFileImport/connection");
  return { ...actual, scanHostKeys: jest.fn(), listRemote: jest.fn(), transferRemote: jest.fn() };
});
jest.mock("../../services/upstreamFileImport/hostGuard", () => {
  const actual = jest.requireActual<typeof HostGuard>("../../services/upstreamFileImport/hostGuard");
  return { ...actual, resolveSource: jest.fn() };
});

/** The in-memory tenant storage (what a ScopedStorage answers); `failPuts` makes every put throw. */
const objects = new Map<string, Buffer>();
const storageState = { failPuts: false };
jest.mock("../../services/storage", () => ({
  getTenantStorage: (tenantId: string) =>
    Promise.resolve({
      buildKey: ({ domain, name }: { domain: string; name: string }) => `t/${tenantId}/${domain}/${name}`,
      put: (key: string, body: Buffer) => {
        if (storageState.failPuts) {
          return Promise.reject(new Error("storage unavailable"));
        }
        objects.set(key, Buffer.from(body));
        return Promise.resolve();
      },
      get: (key: string) => Promise.resolve(Readable.from([objects.get(key) ?? Buffer.alloc(0)])),
      delete: (key: string) => {
        objects.delete(key);
        return Promise.resolve();
      },
    }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
jest.requireActual<typeof ModelsBarrel>("../../models");
const svc = jest.requireActual<typeof Service>("../../services/upstreamFileImport.service");
const connection = jest.requireMock<typeof Connection>("../../services/upstreamFileImport/connection");
const hostGuard = jest.requireMock<typeof HostGuard>("../../services/upstreamFileImport/hostGuard");
const kms = jest.requireActual<typeof KmsModule>("../../services/kms.service");
const channels = jest.requireActual<typeof ChannelsModule>("../../services/notificationChannels.service");
const batchJobs = jest.requireActual<typeof BatchJobModule>("../../services/batchJob.service");
const { PLATFORM_TENANT_ID } = jest.requireActual<typeof PlatformTenantModule>("../../constants/platformTenant");
const { ROLE_IDS } = jest.requireActual<typeof ConstantsModule>("../../constants");
const { logger } = jest.requireActual<typeof ActivityLog>("../../middlewares/activityLog.middleware");

const SUPER = "5a5a5a5a-0000-4000-8000-00000000005a";
const TARGET = "7c7c7c7c-0000-4000-8000-00000000007c";
const SUSPENDED = "7d7d7d7d-0000-4000-8000-00000000007d";
const ACTOR: Service.Actor = { userId: SUPER, ipAddress: "198.51.100.1", userAgent: "jest" };
const PASSWORD = "Pw-PROBE-7f3a9c";
const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nKEYPROBE7f3a9c\n-----END OPENSSH PRIVATE KEY-----\n";
const HOST_KEY = Buffer.from("synthetic-host-key").toString("base64");
const FP = fingerprintOf(HOST_KEY);
const OTHER_KEY = Buffer.from("another-host-key").toString("base64");

/** Every secret-shaped value this suite uses: none may appear anywhere outside the ciphertext. */
const SECRETS = [PASSWORD, "KEYPROBE7f3a9c"];

const SOURCE = {
  host: "test-ssh",
  port: 2222,
  username: "importer",
  authMethod: "password" as const,
  password: PASSWORD,
  remotePath: "/srv/uploads",
  fileClasses: ["front", "serial"] as ("front" | "serial")[],
  syntheticSource: true,
};

let emails: { channels: unknown; recipientEmail: unknown; title: unknown; message: unknown }[];
let logged: string[];

beforeEach(() => {
  mdb.reset();
  objects.clear();
  storageState.failPuts = false;
  svc.resetCheckSlots();
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
  penv["RSYNC_ALLOWED_HOSTS"] = "test-ssh";
  mdb.seed("Tenant", [
    { id: PLATFORM_TENANT_ID, name: "Platform", code: "PLATFORM", subdomain: "platform", email: "p@example.test", status: "active" },
    { id: TARGET, name: "Provider", code: "PROV", subdomain: "prov", email: "prov@example.test", status: "active" },
    { id: SUSPENDED, name: "Sleepy", code: "SLP", subdomain: "slp", email: "s@example.test", status: "suspended" },
  ]);
  mdb.seed("Role", [{ id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", roleLevel: 10 }]);
  mdb.seed("User", {
    id: SUPER,
    email: "andi@platform.test",
    username: "andi",
    password: "x",
    firstName: "Andi",
    lastName: "Operator",
    roleId: ROLE_IDS.SUPER_ADMIN,
    tenantId: PLATFORM_TENANT_ID,
    status: "ACTIVE",
    isActive: true,
    isDeleted: false,
  });
  (hostGuard.resolveSource as jest.Mock).mockReset().mockResolvedValue({ address: "172.18.0.4", allowListed: true });
  (connection.scanHostKeys as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ok: true, keys: [{ type: "ssh-ed25519", key: HOST_KEY, fingerprint: FP }] });
  (connection.listRemote as jest.Mock).mockReset().mockImplementation((_s: unknown, remoteDir: string) =>
    Promise.resolve(remoteDir.endsWith("foto_depan") ? { ok: true, files: 3, bytes: 9000 } : { ok: true, files: 1, bytes: 3000 }),
  );
  (connection.transferRemote as jest.Mock).mockReset().mockImplementation(writeSyntheticFiles);
  emails = [];
  jest.spyOn(channels, "dispatch").mockImplementation((notification, options) => {
    const n = notification as unknown as { title: unknown; message: unknown };
    const o = options as { channels?: unknown; recipientEmail?: unknown };
    emails.push({ channels: o.channels, recipientEmail: o.recipientEmail, title: n.title, message: n.message });
    return Promise.resolve({});
  });
  logged = [];
  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
      return logger;
    }));
  }
});

afterAll(() => {
  fs.rmSync(WORK, { recursive: true, force: true });
  delete penv["UPSTREAM_FILE_IMPORT_DIR"];
  delete penv["RSYNC_ALLOWED_HOSTS"];
});

/** What the transfer double writes: the synthetic files a class folder would hold. */
const writeSyntheticFiles = (
  _session: unknown,
  options: { localDir: string; onProgress: (p: { bytes: number; files: number }) => void },
): Promise<{ ok: true; files: number; bytes: number }> => {
  const files: [string, Buffer][] = options.localDir.endsWith("foto_depan")
    ? [
      ["d1.jpg", syntheticJpeg({ gps: true, seed: 1 })],
      ["d2.png", syntheticPng({ text: true, seed: 2 })],
      ["sub/run.sh", syntheticShellScript()],
    ]
    : [["s1.jpg", syntheticJpeg({ seed: 3 })]];
  let bytes = 0;
  for (const [name, content] of files) {
    const file = path.join(options.localDir, ...name.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    bytes += content.length;
  }
  options.onProgress({ bytes, files: files.length });
  return Promise.resolve({ ok: true, files: files.length, bytes });
};

const imports = (): MemoryDbModule.Row[] => mdb.rows("UpstreamFileImport");
const audits = (): MemoryDbModule.Row[] => mdb.rows("AuditLog");
const notifications = (): MemoryDbModule.Row[] => mdb.rows("Notification");

/** Wait until the import reaches a terminal status (the inline job runs detached). */
const settled = async (id: string, timeoutMs = 15_000): Promise<MemoryDbModule.Row> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = imports().find((r) => r["id"] === id);
    const jobsRunning = mdb.rows("BatchJob").some((j) => j["status"] === "PENDING" || j["status"] === "PROCESSING");
    if (row && ["completed", "failed", "cancelled"].includes(String(row["status"])) && !jobsRunning) {
      // The job's own finally (scratch disposal) runs right after its batch-job row settles.
      await new Promise((resolve) => setTimeout(resolve, 50));
      return row;
    }
    if (Date.now() > deadline) {
      throw new Error(`import ${id} did not settle: ${String(row?.["status"])}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** Nothing outside the ciphertext column holds a secret: rows, answers, audits, notifications, logs, mails. */
const assertNoSecretAnywhere = (...answers: unknown[]): void => {
  const haystacks = [
    JSON.stringify(answers),
    JSON.stringify(audits()),
    JSON.stringify(notifications()),
    JSON.stringify(emails),
    logged.join("\n"),
    JSON.stringify(imports().map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "secretCiphertext")))),
  ];
  for (const secret of SECRETS) {
    for (const haystack of haystacks) {
      expect(haystack).not.toContain(secret);
    }
  }
};

const startOk = (over: Partial<Parameters<typeof svc.startImport>[0]> = {}) =>
  svc.startImport({ ...SOURCE, confirmedFingerprint: FP, targetTenantId: TARGET, bandwidthLimitKbps: null, ...over }, ACTOR);

// ---------------------------------------------------------------------------

describe("checkConnection", () => {
  it("without a fingerprint: the host keys only (no login), audited without the credential", async () => {
    const answer = await svc.checkConnection(SOURCE, ACTOR);
    expect(answer).toEqual({
      status: "host_key_unconfirmed",
      hostKeys: [{ type: "ssh-ed25519", fingerprint: FP }],
      confirmedHostKey: null,
      classes: {},
      estimate: null,
    });
    expect(connection.listRemote).not.toHaveBeenCalled();
    const audit = audits().at(-1);
    expect(audit).toMatchObject({ tenantId: PLATFORM_TENANT_ID, userId: SUPER, action: "UPDATE", resourceType: "UpstreamFileImport" });
    expect(audit?.["changes"]).toMatchObject({ operation: "UPSTREAM_CONNECTION_CHECK", host: "test-ssh", outcome: "host_key_unconfirmed" });
    assertNoSecretAnywhere(answer);
  });

  it("with the confirmed fingerprint: logs in and estimates each class", async () => {
    const answer = await svc.checkConnection({ ...SOURCE, confirmedFingerprint: FP }, ACTOR);
    expect(answer).toMatchObject({
      status: "ok",
      confirmedHostKey: { type: "ssh-ed25519", fingerprint: FP },
      classes: { front: { status: "ok", files: 3, bytes: 9000 }, serial: { status: "ok", files: 1, bytes: 3000 } },
      estimate: { files: 4, bytes: 12000, classes: { front: { files: 3, bytes: 9000 }, serial: { files: 1, bytes: 3000 } } },
    });
    const [session, remoteDir] = (connection.listRemote as jest.Mock).mock.calls[0] as [{ env: Record<string, string> }, string];
    expect(remoteDir).toBe("/srv/uploads/foto_depan");
    expect(session.env["SSHPASS"]).toBe(PASSWORD);
    assertNoSecretAnywhere(answer);
  });

  it("a fingerprint the server does not present → host_key_mismatch, no login", async () => {
    const answer = await svc.checkConnection({ ...SOURCE, confirmedFingerprint: fingerprintOf(OTHER_KEY) }, ACTOR);
    expect(answer.status).toBe("host_key_mismatch");
    expect(connection.listRemote).not.toHaveBeenCalled();
  });

  it("a scan failure is the answer's status", async () => {
    (connection.scanHostKeys as jest.Mock).mockResolvedValue({ ok: false, error: "unreachable" });
    expect((await svc.checkConnection(SOURCE, ACTOR)).status).toBe("unreachable");
  });

  it("a missing class folder is reported per class; a login failure ends the check", async () => {
    (connection.listRemote as jest.Mock).mockImplementation((_s: unknown, dir: string) =>
      Promise.resolve(dir.endsWith("foto_sn") ? { ok: false, error: "path_not_found" } : { ok: false, error: "path_not_readable" }),
    );
    const answer = await svc.checkConnection({ ...SOURCE, confirmedFingerprint: FP }, ACTOR);
    expect(answer.status).toBe("path_not_readable");
    expect(answer.classes).toEqual({ front: { status: "path_not_readable", files: 0, bytes: 0 }, serial: { status: "path_not_found", files: 0, bytes: 0 } });

    (connection.listRemote as jest.Mock).mockResolvedValue({ ok: false, error: "auth_failed" });
    const failed = await svc.checkConnection({ ...SOURCE, confirmedFingerprint: FP, remotePath: "/" }, ACTOR);
    expect(failed).toMatchObject({ status: "auth_failed", classes: {}, estimate: null });
    expect(((connection.listRemote as jest.Mock).mock.calls.at(-1) as unknown[] | undefined)?.[1]).toBe("/foto_depan");
  });

  it("key authentication carries the key (to a 0600 file), never a password", async () => {
    await svc.checkConnection({ ...SOURCE, authMethod: "key", password: undefined, privateKey: KEY, confirmedFingerprint: FP }, ACTOR);
    const [session] = (connection.listRemote as jest.Mock).mock.calls[0] as [{ env: Record<string, string>; sshCommand: string }];
    expect(session.env).not.toHaveProperty("SSHPASS");
    expect(session.sshCommand).toMatch(/-i \S+id_source$/);
    // The scratch (and the key file in it) is gone once the check answers.
    expect(fs.readdirSync(path.join(WORK, "runs"))).toEqual([]);
    assertNoSecretAnywhere();
  });

  it("the DPIA gate: a real source is refused 403 while the gate is off; allowed when on", async () => {
    await expect(svc.checkConnection({ ...SOURCE, syntheticSource: false }, ACTOR)).rejects.toMatchObject({ status: 403 });
    expect(connection.scanHostKeys).not.toHaveBeenCalled();
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
    await expect(svc.checkConnection({ ...SOURCE, syntheticSource: false }, ACTOR)).resolves.toMatchObject({ status: "host_key_unconfirmed" });
  });

  it("is rate-limited per operator: one at a time, ten per ten minutes", async () => {
    const release = svc.takeCheckSlot(SUPER);
    await expect(svc.checkConnection(SOURCE, ACTOR)).rejects.toMatchObject({ status: 429 });
    release();
    for (let i = 0; i < svc.CHECK_LIMIT - 1; i += 1) {
      await svc.checkConnection(SOURCE, ACTOR);
    }
    await expect(svc.checkConnection(SOURCE, ACTOR)).rejects.toMatchObject({ status: 429 });
    // The window slides.
    expect(() => svc.takeCheckSlot(SUPER, Date.now() + svc.CHECK_WINDOW_MS + 1)).not.toThrow();
  });
});

describe("startImport → the job → completed", () => {
  it("stores the credential encrypted and bound to the row, runs, ingests, erases the credential, notifies", async () => {
    const view = await startOk({ bandwidthLimitKbps: 4096 });
    expect(view).toMatchObject({
      status: "pending",
      targetTenantId: TARGET,
      fileClasses: ["front", "serial"],
      hostKeyFingerprint: FP,
      credentialStored: true,
      bandwidthLimitKbps: 4096,
      estimate: { files: 4, bytes: 12000 },
    });
    expect(view).not.toHaveProperty("secretCiphertext");
    expect(JSON.stringify(view)).not.toContain(PASSWORD);

    // At rest: a KMS envelope, not the password; it opens only under its own row's id.
    const stored = imports()[0] as MemoryDbModule.Row;
    const ciphertext = String(stored["secretCiphertext"]);
    expect(kms.isEnvelope(ciphertext)).toBe(true);
    expect(ciphertext).not.toContain(PASSWORD);
    expect(kms.decryptData(`upstream-file-import:${view.id}`, ciphertext)).toBe(PASSWORD);
    expect(() => kms.decryptData("upstream-file-import:another-row", ciphertext)).toThrow();

    const row = await settled(view.id);
    expect(row).toMatchObject({ status: "completed", secretCiphertext: null });
    expect(row["errorCode"] ?? null).toBeNull();
    expect(row["secretErasedAt"]).toBeInstanceOf(Date);
    expect(row["summary"]).toMatchObject({
      filesCopied: 4,
      ingested: 3,
      skippedPresent: 0,
      metadataStripped: 2,
      quarantined: 1,
      quarantinedByReason: { file_type_refused: 1 },
      failed: 0,
    });
    // The transfer got the bandwidth limit, the pinned key and the class folders.
    const [session, options] = (connection.transferRemote as jest.Mock).mock.calls[0] as [
      { input: { pinned: { key: string } } },
      { remoteDir: string; bandwidthLimitKbps: number },
    ];
    expect(session.input.pinned.key).toBe(HOST_KEY);
    expect(options).toMatchObject({ remoteDir: "/srv/uploads/foto_depan", bandwidthLimitKbps: 4096 });

    // Storage: three objects in the TARGET tenant, UUID-named.
    expect([...objects.keys()].every((k) => k.startsWith(`t/${TARGET}/attachments/`))).toBe(true);
    expect(objects.size).toBe(3);

    // The batch job, in the target tenant, completed with the ingested count.
    const job = mdb.rows("BatchJob")[0];
    expect(job).toMatchObject({ tenantId: TARGET, userId: SUPER, type: "upstream-file-import", status: "COMPLETED", processedItems: 3 });

    // Audit: CREATE then COMPLETED, platform tenant, the credential erasure recorded.
    const ops = audits()
      .filter((a) => a["resourceType"] === "UpstreamFileImport")
      .map((a) => (a["changes"] as { operation: string }).operation);
    expect(ops).toEqual(["UPSTREAM_FILE_IMPORT_START", "UPSTREAM_FILE_IMPORT_COMPLETED"]);
    expect(audits().find((a) => (a["changes"] as { operation?: string }).operation === "UPSTREAM_FILE_IMPORT_COMPLETED")?.["changes"]).toMatchObject({
      credentialErased: true,
      before: { status: "ingesting" },
      after: { status: "completed" },
    });

    // The notification: in-app AND e-mail, to the requester, counts only.
    const note = notifications().at(-1);
    expect(note).toMatchObject({ tenantId: PLATFORM_TENANT_ID, userId: SUPER, type: "SYSTEM", title: "Impor foto selesai / Image import completed" });
    expect(String(note?.["message"])).toMatch(/Files copied: 4[\s\S]*Ingested: 3[\s\S]*Skipped \(already present\): 0[\s\S]*Quarantined: 1 — file_type_refused 1[\s\S]*Failed: 0[\s\S]*Duration:/);
    expect(String(note?.["message"])).not.toMatch(/d1\.jpg|run\.sh|foto_|srv/);
    expect(emails).toEqual([expect.objectContaining({ channels: ["realtime", "email"], recipientEmail: "andi@platform.test" })]);

    // The manifest exists for the ETL; staging is empty; the run scratch is gone.
    const manifest = fs.readFileSync(path.join(WORK, "manifests", `${view.id}.jsonl`), "utf8");
    expect(manifest.split("\n").filter(Boolean)).toHaveLength(4);
    expect(fs.existsSync(path.join(WORK, "staging"))).toBe(true);
    expect(fs.readdirSync(path.join(WORK, "staging"))).toEqual([]);
    expect(fs.readdirSync(path.join(WORK, "runs"))).toEqual([]);

    assertNoSecretAnywhere(view, await svc.getImport(view.id), await svc.listImports({ page: 1, limit: 20 }));
  });

  it("a second import of the same source skips what the first ingested (path and hash)", async () => {
    const first = await startOk();
    await settled(first.id);
    const second = await startOk();
    const row = await settled(second.id);
    expect(row["summary"]).toMatchObject({ ingested: 0, skippedPresent: 3, quarantined: 1 });
    expect(objects.size).toBe(3);
  });

  it("a torn manifest line or a removed manifest is tolerated (that file is ingested again, never lost)", async () => {
    const first = await startOk();
    await settled(first.id);
    const manifestPath = path.join(WORK, "manifests", `${first.id}.jsonl`);
    const lines = fs.readFileSync(manifestPath, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(manifestPath, `${lines.slice(1).join("\n")}\n{"torn\n\n`);
    const second = await startOk();
    expect((await settled(second.id))["summary"]).toMatchObject({ skippedPresent: 2, ingested: 1 });
    fs.rmSync(path.join(WORK, "manifests"), { recursive: true, force: true });
    const third = await startOk();
    expect((await settled(third.id))["summary"]).toMatchObject({ skippedPresent: 0, ingested: 3 });
  });
});

describe("startImport — refusals", () => {
  it("an unknown tenant is 404; an inactive one 409", async () => {
    await expect(startOk({ targetTenantId: "8e8e8e8e-0000-4000-8000-00000000008e" })).rejects.toMatchObject({ status: 404 });
    await expect(startOk({ targetTenantId: SUSPENDED })).rejects.toMatchObject({ status: 409 });
  });

  it("a check that does not pass is a 409 with the state explained; nothing is stored", async () => {
    (connection.scanHostKeys as jest.Mock).mockResolvedValue({ ok: true, keys: [{ type: "ssh-ed25519", key: OTHER_KEY, fingerprint: fingerprintOf(OTHER_KEY) }] });
    await expect(startOk()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/host key/) as unknown });
    (connection.scanHostKeys as jest.Mock).mockResolvedValue({ ok: false, error: "transfer_failed" });
    await expect(startOk()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/transfer_failed/) as unknown });
    expect(imports()).toEqual([]);
  });

  it("one live import per source and tenant", async () => {
    mdb.seed("UpstreamFileImport", {
      id: "9a9a9a9a-0000-4000-8000-00000000009a",
      targetTenantId: TARGET,
      requestedBy: SUPER,
      status: "transferring",
      host: "test-ssh",
      port: 2222,
      username: "importer",
      remotePath: "/srv/uploads",
      includeFront: true,
      includeSerial: false,
      authMethod: "password",
      hostKeyType: "ssh-ed25519",
      hostKey: HOST_KEY,
      hostKeyFingerprint: FP,
      syntheticSource: true,
      batchJobId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(startOk()).rejects.toMatchObject({ status: 409 });
  });

  it("a job that cannot be queued ends the import failed (credential erased) and answers 503", async () => {
    jest.spyOn(batchJobs, "createJob").mockRejectedValueOnce(new Error("broker down"));
    await expect(startOk()).rejects.toMatchObject({ status: 503 });
    expect(imports()[0]).toMatchObject({ status: "failed", errorCode: "job_not_queued", secretCiphertext: null });
    expect(notifications().at(-1)).toMatchObject({ title: "Impor foto gagal / Image import failed" });
  });
});

describe("the job — failure and cancel", () => {
  it("a transfer failure fails the import with its code, erases the credential and notifies", async () => {
    (connection.transferRemote as jest.Mock).mockResolvedValue({ ok: false, error: "auth_failed" });
    const view = await startOk();
    const row = await settled(view.id);
    expect(row).toMatchObject({ status: "failed", errorCode: "auth_failed", secretCiphertext: null });
    expect(String(notifications().at(-1)?.["message"])).toMatch(/^Reason: auth_failed/);
    expect(mdb.rows("BatchJob")[0]).toMatchObject({ status: "FAILED" });
    assertNoSecretAnywhere();
  });

  it("the DPIA gate is re-checked when the job starts: a queued real import is refused", async () => {
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
    const view = await startOk({ syntheticSource: false });
    delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
    const row = await settled(view.id);
    expect(row).toMatchObject({ status: "failed", errorCode: "source_refused", secretCiphertext: null });
  });

  it("an unexpected error is internal_error (logged without the credential)", async () => {
    (connection.transferRemote as jest.Mock).mockRejectedValue(new Error("boom"));
    const row = await settled((await startOk()).id);
    expect(row).toMatchObject({ status: "failed", errorCode: "internal_error" });
    expect(logged.join("\n")).toContain("boom");
    assertNoSecretAnywhere();
  });

  it("a credential that cannot be read fails the import (credential_unavailable)", async () => {
    jest.spyOn(kms, "decryptData").mockReturnValueOnce(null);
    const row = await settled((await startOk({ authMethod: "key", password: undefined, privateKey: KEY })).id);
    expect(row).toMatchObject({ status: "failed", errorCode: "credential_unavailable" });
  });

  it("key authentication runs with the key", async () => {
    const row = await settled((await startOk({ authMethod: "key", password: undefined, privateKey: KEY })).id);
    expect(row).toMatchObject({ status: "completed", secretCiphertext: null });
    const [session] = (connection.transferRemote as jest.Mock).mock.calls[0] as [{ env: Record<string, string> }];
    expect(session.env).not.toHaveProperty("SSHPASS");
    assertNoSecretAnywhere();
  });

  it("a cancel during the transfer stops the run within seconds: cancelled, credential erased, staging kept for a re-run", async () => {
    (connection.transferRemote as jest.Mock).mockImplementation(
      (_s: unknown, options: { signal: AbortSignal; localDir: string }) =>
        new Promise((resolve) => {
          fs.mkdirSync(options.localDir, { recursive: true });
          fs.writeFileSync(path.join(options.localDir, "partial.jpg"), syntheticJpeg());
          options.signal.addEventListener("abort", () => { resolve({ ok: false, error: "cancelled" }); });
        }),
    );
    const view = await startOk();
    for (let i = 0; i < 200 && imports()[0]?.["status"] !== "transferring"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const requested = await svc.cancelImport(view.id, ACTOR);
    expect(requested).toMatchObject({ status: "transferring", cancelRequested: true });
    // A second request changes nothing.
    await expect(svc.cancelImport(view.id, ACTOR)).resolves.toMatchObject({ cancelRequested: true });
    const row = await settled(view.id, 20_000);
    expect(row).toMatchObject({ status: "cancelled", secretCiphertext: null, cancelledBy: SUPER });
    expect(row["errorCode"] ?? null).toBeNull();
    expect(notifications().at(-1)).toMatchObject({ title: "Impor foto dibatalkan / Image import cancelled" });
    const staged = fs.readdirSync(path.join(WORK, "staging"));
    expect(staged).toHaveLength(1);
    const ops = audits().map((a) => (a["changes"] as { operation?: string }).operation);
    expect(ops).toEqual(expect.arrayContaining(["UPSTREAM_FILE_IMPORT_CANCEL_REQUESTED", "UPSTREAM_FILE_IMPORT_CANCELLED"]));
  }, 30_000);

  it("an ingest that stops (a cancel between files) ends the import cancelled", async () => {
    const ingest = jest.requireActual<typeof IngestModule>("../../services/upstreamFileImport/ingest");
    jest.spyOn(ingest, "ingestStaged").mockResolvedValueOnce({ ...ingest.emptyCounts(), processed: 1, ingested: 1, stopped: true });
    const row = await settled((await startOk()).id);
    expect(row).toMatchObject({ status: "cancelled", secretCiphertext: null });
    expect(row["summary"]).toMatchObject({ ingested: 1 });
  });

  it("a pending import is cancelled at once; the job then does nothing", async () => {
    // Hold the job: the link wait finds no row until it is cancelled.
    const create = jest.spyOn(batchJobs, "createJob").mockImplementationOnce((tenantId, userId, type, total) =>
      jest.requireActual<typeof BatchJobModule>("../../services/batchJob.service").createJob(tenantId, userId, type, total),
    );
    jest.spyOn(batchJobs, "runJob").mockImplementationOnce(() => Promise.resolve({ job: null, ran: false }));
    const view = await startOk();
    expect(create).toHaveBeenCalled();
    const cancelled = await svc.cancelImport(view.id, ACTOR);
    expect(cancelled).toMatchObject({ status: "cancelled", credentialStored: false, cancelRequested: true });
    expect(imports()[0]).toMatchObject({ cancelledBy: SUPER, secretCiphertext: null });
    // The job, when it finally runs, finds nothing to do.
    await expect(svc.runImportJob({ id: String(imports()[0]?.["batchJobId"]) })).resolves.toEqual({ processedItems: 0 });
  });

  it("cancel: unknown 404; already ended 409", async () => {
    await expect(svc.cancelImport("8e8e8e8e-0000-4000-8000-00000000008e", ACTOR)).rejects.toMatchObject({ status: 404 });
    const row = await settled((await startOk()).id);
    await expect(svc.cancelImport(String(row["id"]), ACTOR)).rejects.toMatchObject({ status: 409 });
  });

  it("a pending cancel racing the job's claim falls through to a cancel request", async () => {
    const models = jest.requireActual<typeof ModelsBarrel>("../../models");
    const RACE = "9b9b9b9b-0000-4000-8000-00000000009b";
    mdb.seed("UpstreamFileImport", {
      id: RACE,
      targetTenantId: TARGET,
      requestedBy: SUPER,
      status: "pending",
      host: "h",
      port: 22,
      username: "u",
      remotePath: "/p",
      includeFront: true,
      includeSerial: false,
      authMethod: "password",
      secretCiphertext: "v2:x",
      hostKeyType: "ssh-ed25519",
      hostKey: HOST_KEY,
      hostKeyFingerprint: FP,
      syntheticSource: true,
      batchJobId: "1e1e1e1e-0000-4000-8000-00000000001e",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mdb.seed("BatchJob", { id: "1e1e1e1e-0000-4000-8000-00000000001e", tenantId: TARGET, type: "upstream-file-import", status: "PROCESSING" });
    const realFind = models.UpstreamFileImport.findByPk.bind(models.UpstreamFileImport);
    jest.spyOn(models.UpstreamFileImport, "findByPk").mockImplementationOnce(async (...args: Parameters<typeof realFind>) => {
      const row = await realFind(...args);
      // The job claims it between the read and the conditional end.
      await models.UpstreamFileImport.update({ status: "transferring" }, { where: { id: RACE } });
      return row;
    });
    const answer = await svc.cancelImport(RACE, ACTOR);
    expect(answer).toMatchObject({ status: "transferring", cancelRequested: true, credentialStored: true });
  });

  it("the job refuses a batch job no import is linked to", async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] });
    const assertion = expect(svc.runImportJob({ id: "0f0f0f0f-0000-4000-8000-00000000000f" })).rejects.toThrow("No upstream file import is linked");
    await jest.advanceTimersByTimeAsync(31_000);
    jest.useRealTimers();
    await assertion;
  });
});

describe("the job — edges", () => {
  it("a storage that refuses every put: each file quarantined ingest_failed, nothing left behind", async () => {
    storageState.failPuts = true;
    const row = await settled((await startOk()).id);
    expect(row).toMatchObject({ status: "completed" });
    expect(row["summary"]).toMatchObject({ ingested: 0, quarantinedByReason: { ingest_failed: 3, file_type_refused: 1 } });
    expect(objects.size).toBe(0);
  });

  it("a file the ingest cannot read stays in staging (counted failed), and staging is kept", async () => {
    const realLstat = fs.promises.lstat.bind(fs.promises);
    let refused = false;
    jest.spyOn(fs.promises, "lstat").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (!refused && String(file).endsWith("s1.jpg")) {
        refused = true;
        return Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" }));
      }
      return (realLstat as (f: fs.PathLike, ...r: unknown[]) => Promise<fs.Stats>)(file, ...rest);
    }));
    const row = await settled((await startOk()).id);
    expect(row["summary"]).toMatchObject({ failed: 1, ingested: 2 });
    const staging = path.join(WORK, "staging");
    const [source] = fs.readdirSync(staging);
    expect(fs.existsSync(path.join(staging, String(source), "foto_sn", "s1.jpg"))).toBe(true);
  });

  it("clean-up that fails never fails the import", async () => {
    jest.spyOn(fs.promises, "rm").mockRejectedValue(new Error("busy"));
    const row = await settled((await startOk()).id);
    expect(row["status"]).toBe("completed");
  });

  it("a cancel that lands as the last transfer finishes stops before the ingest", async () => {
    const models = jest.requireActual<typeof ModelsBarrel>("../../models");
    (connection.transferRemote as jest.Mock).mockImplementation(async (s: unknown, options: Parameters<typeof writeSyntheticFiles>[1] & { signal: AbortSignal }) => {
      const answer = await writeSyntheticFiles(s, options);
      if (options.localDir.endsWith("foto_sn")) {
        // One watcher poll passes with nothing requested; then the operator cancels, and the next poll
        // sees it — while the transfer itself still "succeeds".
        await new Promise((resolve) => setTimeout(resolve, 2_300));
        await models.UpstreamFileImport.update({ cancelRequestedAt: new Date() }, { where: {} });
        await new Promise<void>((resolve) => {
          options.signal.addEventListener("abort", () => { resolve(); });
        });
      }
      return answer;
    });
    const row = await settled((await startOk()).id, 20_000);
    expect(row).toMatchObject({ status: "cancelled" });
    expect(row["summary"]).toMatchObject({ filesCopied: 4, ingested: 0 });
  }, 30_000);

  it("a queued row without an estimate still runs (progress counts files only)", async () => {
    const JOB = "1f1f1f1f-0000-4000-8000-00000000001f";
    const ID = "8f8f8f8f-0000-4000-8000-00000000008f";
    mdb.seed("BatchJob", { id: JOB, tenantId: TARGET, type: "upstream-file-import", status: "PROCESSING" });
    mdb.seed("UpstreamFileImport", {
      id: ID,
      targetTenantId: TARGET,
      requestedBy: SUPER,
      batchJobId: JOB,
      status: "pending",
      host: "test-ssh",
      port: 2222,
      username: "importer",
      remotePath: "/srv/uploads",
      includeFront: false,
      includeSerial: true,
      authMethod: "password",
      secretCiphertext: kms.encryptData(`upstream-file-import:${ID}`, PASSWORD),
      hostKeyType: "ssh-ed25519",
      hostKey: HOST_KEY,
      hostKeyFingerprint: FP,
      syntheticSource: true,
      estimate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(svc.runImportJob({ id: JOB })).resolves.toEqual({ processedItems: 1 });
    expect(imports().find((r) => r["id"] === ID)).toMatchObject({ status: "completed", secretCiphertext: null });
  });

  it("cancelRequested: a failed read answers \"not yet\"; quietly swallows a rejection", async () => {
    const models = jest.requireActual<typeof ModelsBarrel>("../../models");
    jest.spyOn(models.UpstreamFileImport, "findByPk").mockRejectedValueOnce(new Error("db down"));
    await expect(svc.cancelRequested("8f8f8f8f-0000-4000-8000-00000000008f")).resolves.toBe(false);
    expect(() => { svc.quietly(Promise.reject(new Error("ignored"))); }).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("list, detail and reconciliation", () => {
  it("lists newest first with paging in meta; 404 for an unknown id", async () => {
    const a = await startOk();
    await settled(a.id);
    const page = await svc.listImports({ page: 1, limit: 1 });
    expect(page.meta).toEqual({ total: 1, page: 1, limit: 1, totalPages: 1 });
    expect(page.rows[0]?.id).toBe(a.id);
    await expect(svc.getImport("8e8e8e8e-0000-4000-8000-00000000008e")).rejects.toMatchObject({ status: 404 });
  });

  it("a live import whose batch job ended (a dead worker) is failed on read: worker_interrupted", async () => {
    const view = await startOk();
    await settled(view.id);
    const live = {
      ...imports()[0],
      id: "9c9c9c9c-0000-4000-8000-00000000009c",
      status: "transferring",
      secretCiphertext: kms.encryptData("upstream-file-import:9c9c9c9c-0000-4000-8000-00000000009c", PASSWORD),
      finishedAt: null,
      summary: null,
    };
    mdb.seed("UpstreamFileImport", live);
    expect(await svc.getImport(live.id)).toMatchObject({ status: "failed", errorCode: "worker_interrupted", credentialStored: false });
  });

  it("a live import whose batch job is still running is left alone", async () => {
    mdb.seed("BatchJob", { id: "1d1d1d1d-0000-4000-8000-00000000001d", tenantId: TARGET, type: "upstream-file-import", status: "PROCESSING" });
    mdb.seed("UpstreamFileImport", {
      id: "9d9d9d9d-0000-4000-8000-00000000009d",
      targetTenantId: TARGET,
      requestedBy: SUPER,
      batchJobId: "1d1d1d1d-0000-4000-8000-00000000001d",
      status: "transferring",
      host: "h",
      port: 22,
      username: "u",
      remotePath: "/p",
      includeFront: true,
      includeSerial: true,
      authMethod: "password",
      hostKeyType: "ssh-ed25519",
      hostKey: HOST_KEY,
      hostKeyFingerprint: FP,
      syntheticSource: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect((await svc.getImport("9d9d9d9d-0000-4000-8000-00000000009d")).status).toBe("transferring");
  });

  it("a pending import never linked to a job is failed after five minutes: job_not_queued", async () => {
    const base = {
      targetTenantId: TARGET,
      requestedBy: null,
      batchJobId: null,
      status: "pending",
      host: "h",
      port: 22,
      username: "u",
      remotePath: "/p",
      includeFront: true,
      includeSerial: false,
      authMethod: "password",
      hostKeyType: "ssh-ed25519",
      hostKey: HOST_KEY,
      hostKeyFingerprint: FP,
      syntheticSource: true,
      updatedAt: new Date(),
    };
    mdb.seed("UpstreamFileImport", [
      { ...base, id: "9e9e9e9e-0000-4000-8000-00000000009e", createdAt: new Date(Date.now() - 6 * 60 * 1000) },
      { ...base, id: "9f9f9f9f-0000-4000-8000-00000000009f", createdAt: new Date() },
    ]);
    const page = await svc.listImports({ page: 1, limit: 20 });
    const byId = Object.fromEntries(page.rows.map((r) => [r.id, r.status]));
    expect(byId).toEqual({ "9e9e9e9e-0000-4000-8000-00000000009e": "failed", "9f9f9f9f-0000-4000-8000-00000000009f": "pending" });
    // requestedBy null: nobody to notify, and nothing breaks.
    expect(notifications()).toEqual([]);
  });
});

describe("notification helpers and configuration", () => {
  it("formats bytes and durations as people read them", () => {
    expect(svc.formatBytes(512)).toBe("512 B");
    expect(svc.formatBytes(1536)).toBe("1.5 KB");
    expect(svc.formatBytes(91 * 1024 ** 3)).toBe("91.0 GB");
    expect(svc.formatBytes(5 * 1024 ** 5)).toBe("5120.0 TB");
    expect(svc.formatDuration(4_000)).toBe("4 s");
    expect(svc.formatDuration(125_000)).toBe("2 min 5 s");
    expect(svc.formatDuration(3 * 3600_000 + 60_000)).toBe("3 h 1 min");
  });

  it("a message without a summary reads as zeros; a failure without a code has no reason line", () => {
    const text = svc.notificationMessage("failed", null, null);
    expect(text).toMatch(/^Files copied: 0/);
    expect(svc.notificationMessage("completed", null, "ignored")).not.toMatch(/Reason/);
  });

  it("the requester without a tenant is not notified (logged), and a failing notification never fails the import", async () => {
    const models = jest.requireActual<typeof ModelsBarrel>("../../models");
    const unbound: unknown = { id: SUPER, tenantId: null };
    jest.spyOn(models.User, "findByPk").mockResolvedValue(unbound as never);
    const row = await settled((await startOk()).id);
    expect(row["status"]).toBe("completed");
    expect(notifications()).toEqual([]);
    expect(logged.join("\n")).toContain("no tenant to be notified");
  });

  it("a notification that throws is logged, not raised", async () => {
    const models = jest.requireActual<typeof ModelsBarrel>("../../models");
    jest.spyOn(models.User, "findByPk").mockRejectedValue(new Error("db down"));
    const row = await settled((await startOk()).id);
    expect(row["status"]).toBe("completed");
    expect(logged.join("\n")).toContain("could not be sent");
  });

  it("answers the page's configuration", () => {
    penv["RSYNC_ALLOWED_HOSTS"] = "a,b";
    expect(svc.getImportConfig()).toEqual({
      realDataAllowed: false,
      allowListedHostCount: 2,
      heicConversion: false,
      fileClasses: [
        { name: "front", folder: "foto_depan" },
        { name: "serial", folder: "foto_sn" },
      ],
    });
    expect(svc.importWorkDir()).toBe(path.resolve(WORK));
  });

  it("toView names every field and never the ciphertext", async () => {
    const view = await startOk();
    expect(Object.keys(view).sort()).toEqual(
      [
        "authMethod", "bandwidthLimitKbps", "batchJobId", "cancelRequested", "createdAt", "credentialStored", "errorCode",
        "estimate", "fileClasses", "finishedAt", "host", "hostKeyFingerprint", "hostKeyType", "id", "port", "progress",
        "remotePath", "requestedBy", "secretErasedAt", "startedAt", "status", "summary", "syntheticSource",
        "targetTenantId", "updatedAt", "username",
      ].sort(),
    );
    await settled(view.id);
  });
});
