/**
 * P10-05 / P10-07 / P10-15 (ADR-098 §6, §8.4, §8.6) — the access-request
 * service end to end over the REAL models and tenant hooks (fixtures/memoryDb),
 * the REAL audit.service, tenant.service#createTenant (the ONE tenant-creation
 * path), user.service#assertIdentityFree (A-128) and invitation.service.
 *
 * Doubled: the database (memoryDb), the Redis cache calls createTenant makes,
 * and the email queue (observed, never sent). bcrypt runs at cost 4.
 *
 * Concurrency (two super admins approving at once) needs real row locks, which
 * memoryDb does not have: it is proven on PostgreSQL 18 in
 * accessRequest.p1005.live.test.ts.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsBarrel from "../../models";
import type * as Service from "../../services/accessRequest.service";
import type * as Invitation from "../../services/invitation.service";
import type * as Redis from "../../services/redis.service";
import type * as EmailQueue from "../../services/emailQueue.service";
import type * as AuditService from "../../services/audit.service";
import type { SubmitAccessRequestInput } from "../../validators/accessRequest.validator";
import type * as BcryptModule from "bcryptjs";
import type * as ConstantsModule from "../../constants";
import type * as PlatformTenantModule from "../../constants/platformTenant";
import { environment } from "../../config/env";

/** The process environment (config/env.ts); tests set variables on it, read per call. */
const penv = environment();

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
// The cache calls createTenant makes: tenant.service destructures them at load,
// so they are replaced here (a spy after load would not reach it).
jest.mock("../../services/redis.service", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../services/redis.service");
  return {
    ...actual,
    set: jest.fn(async () => Promise.resolve(true)),
    get: jest.fn(async () => Promise.resolve(null)),
    del: jest.fn(async () => Promise.resolve(true)),
    delPattern: jest.fn(async () => Promise.resolve(0)),
  };
});
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof BcryptModule>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
jest.requireActual<typeof ModelsBarrel>("../../models");
const svc = jest.requireActual<typeof Service>("../../services/accessRequest.service");
const invitation = jest.requireActual<typeof Invitation>("../../services/invitation.service");
const redis = jest.requireMock<typeof Redis>("../../services/redis.service");
const emailQueue = jest.requireActual<typeof EmailQueue>("../../services/emailQueue.service");
const auditService = jest.requireActual<typeof AuditService>("../../services/audit.service");
const bcrypt = jest.requireActual<typeof BcryptModule>("bcryptjs");
const { ROLE_IDS } = jest.requireActual<typeof ConstantsModule>("../../constants");
const { PLATFORM_TENANT_ID } = jest.requireActual<typeof PlatformTenantModule>(
  "../../constants/platformTenant",
);

const SUPER = "5a5a5a5a-0000-4000-8000-00000000005a";
const OTHER_SUPER = "5b5b5b5b-0000-4000-8000-00000000005b";
const ACTOR: Service.Actor = { userId: SUPER, ipAddress: "198.51.100.1", userAgent: "jest" };
const ORIGIN: Service.RequestOrigin = { ip: "203.0.113.9", userAgent: "Mozilla/5.0" };

const INPUT: SubmitAccessRequestInput = {
  organisationName: "RSUD Contoh Sejahtera",
  facilityType: "hospital",
  city: "Bandung",
  deviceCountBand: "500_1999",
  contactName: "Siti Rahma Wulandari",
  contactRole: "Kepala IPSRS",
  workEmail: "siti@rsud-contoh.go.id",
  whatsapp: "+6281234567890",
  needs: "Jadwal kalibrasi dan sertifikat.",
  consent: true,
  consentVersion: "2026-09-29",
  locale: "id",
  website: "",
};

let queued: Record<string, unknown>[];

beforeEach(() => {
  mdb.reset();
  mdb.seed("Tenant", {
    id: PLATFORM_TENANT_ID,
    name: "Platform",
    code: "PLATFORM",
    subdomain: "platform",
    email: "platform@example.test",
    status: "active",
  });
  mdb.seed("Role", [
    { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", roleLevel: 10 },
    { id: ROLE_IDS.HEALTCARE_ADMIN, name: "HEALTHCARE ADMIN", roleLevel: 8 },
    { id: ROLE_IDS.CALIBRATOR_ADMIN, name: "CALIBRATOR ADMIN", roleLevel: 8 },
  ]);
  for (const [id, name] of [
    [SUPER, "Andi"],
    [OTHER_SUPER, "Budi"],
  ] as const) {
    mdb.seed("User", {
      id,
      email: `${name.toLowerCase()}@platform.test`,
      username: name.toLowerCase(),
      password: "x",
      firstName: name,
      lastName: "Operator",
      roleId: ROLE_IDS.SUPER_ADMIN,
      tenantId: PLATFORM_TENANT_ID,
      status: "ACTIVE",
      isActive: true,
      isDeleted: false,
    });
  }
  // restoreMocks resets factory mocks between tests: state what they answer each time.
  (redis.set as jest.Mock).mockReset().mockResolvedValue(true);
  (redis.get as jest.Mock).mockReset().mockResolvedValue(null);
  (redis.del as jest.Mock).mockReset().mockResolvedValue(true);
  (redis.delPattern as jest.Mock).mockReset().mockResolvedValue(0);
  queued = [];
  jest.spyOn(emailQueue, "queueNotificationEmail").mockImplementation(async (params) => {
    queued.push(params);
    return Promise.resolve(true);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const requests = (): MemoryDbModule.Row[] => mdb.rows("AccessRequest");
const audits = (): MemoryDbModule.Row[] => mdb.rows("AuditLog");

const submitted = async (input: Partial<SubmitAccessRequestInput> = {}): Promise<string> => {
  expect(await svc.submitAccessRequest({ ...INPUT, ...input }, ORIGIN)).toBe("stored");
  const row = requests().at(-1);
  if (!row) {
    throw new Error("nothing stored");
  }
  return String(row["id"]);
};

const failure = async (promise: Promise<unknown>): Promise<{ status?: number; message?: string }> => {
  try {
    await promise;
  } catch (err) {
    return err as { status?: number; message?: string };
  }
  throw new Error("expected a refusal");
};

const PERSONAL = [INPUT.contactName, INPUT.workEmail, INPUT.whatsapp, "Siti", String(INPUT.needs)];

// ============================================================================
describe("P10-05 — the intake", () => {
  it("stores the request and its audit row in ONE transaction, the actor system:access-request-intake, under PLATFORM", async () => {
    const id = await submitted();
    const [row] = requests();
    expect(row).toMatchObject({
      id,
      status: "pending",
      workEmail: INPUT.workEmail,
      consentVersion: "2026-09-29",
      userAgent: "Mozilla/5.0",
    });
    // memoryDb omits NULL columns from a stored row.
    expect(row?.["provisionedTenantId"] ?? null).toBeNull();
    expect(row?.["decidedBy"] ?? null).toBeNull();
    expect(row?.["consentedAt"]).toBeTruthy();
    // The raw address is never stored: a pepper-mixed sha256 stands in.
    expect(row?.["sourceIpHash"]).toBe(svc.hashSourceIp(ORIGIN.ip));
    expect(JSON.stringify(row)).not.toContain(String(ORIGIN.ip));

    const [audit] = audits();
    expect(audit).toMatchObject({
      tenantId: PLATFORM_TENANT_ID,
      actorType: "system",
      actorName: "system:access-request-intake",
      action: "CREATE",
      resourceType: "AccessRequest",
      resourceId: id,
    });
    const writes = mdb.committed().filter((w) => w.model === "AccessRequest" || w.model === "AuditLog");
    expect(new Set(writes.map((w) => w.tx)).size).toBe(1);
    expect(writes[0]?.tx).not.toBeNull();
  });

  it("BR-P10-6: the audit row carries NO personal data (no name, address, phone or free text)", async () => {
    await submitted();
    const changes = JSON.stringify(audits()[0]?.["changes"]);
    for (const value of PERSONAL) {
      expect(changes).not.toContain(value);
    }
    expect(audits()[0]?.["changes"]).toEqual({
      after: { status: "pending", facilityType: "hospital", deviceCountBand: "500_1999" },
    });
  });

  it("a failed audit insert leaves NO request (A-41)", async () => {
    jest.spyOn(auditService, "logAction").mockRejectedValueOnce(new Error("audit insert failed"));
    await expect(svc.submitAccessRequest(INPUT, ORIGIN)).rejects.toThrow("audit insert failed");
    expect(requests()).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it("a filled honeypot stores nothing, audits nothing, notifies nobody", async () => {
    expect(await svc.submitAccessRequest({ ...INPUT, website: "http://spam.example" }, ORIGIN)).toBe("honeypot");
    expect(requests()).toHaveLength(0);
    expect(audits()).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("the per-address cap: a 4th request in 24 h from one work email is not stored", async () => {
    await submitted();
    await submitted();
    await submitted();
    expect(await svc.submitAccessRequest(INPUT, ORIGIN)).toBe("capped");
    expect(requests()).toHaveLength(3);
    // Another address is unaffected.
    await submitted({ workEmail: "lain@rsud-contoh.go.id" });
    expect(requests()).toHaveLength(4);
  });

  it("a request older than 24 h does not count toward the cap", async () => {
    await submitted();
    await submitted();
    await submitted();
    // Age every stored row by two days through the model (memoryDb rows are copies).
    await mdb.sequelize.models["AccessRequest"]?.update(
      { createdAt: new Date(Date.now() - 2 * 86400000) },
      { where: {}, silent: true },
    );
    expect(await svc.submitAccessRequest(INPUT, ORIGIN)).toBe("stored");
  });

  it("notifies the platform inbox AFTER commit with the organisation only — never the requester's details; never the requester", async () => {
    penv["ACCESS_REQUEST_NOTIFY_EMAIL"] = "ops@platform.test";
    penv["FRONTEND_URL"] = "https://app.example.test";
    try {
      await submitted();
    } finally {
      delete penv["ACCESS_REQUEST_NOTIFY_EMAIL"];
      delete penv["FRONTEND_URL"];
    }
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      email: "ops@platform.test",
      title: "New access request",
      actionUrl: "https://app.example.test/dashboard/access-requests",
    });
    const mail = JSON.stringify(queued[0]);
    for (const value of [INPUT.contactName, INPUT.workEmail, INPUT.whatsapp]) {
      expect(mail).not.toContain(value);
    }
  });

  it("with no public origin configured, the notification carries no link", async () => {
    const saved = { f: penv["FRONTEND_URL"], h: penv["HOST_URL"] };
    penv["ACCESS_REQUEST_NOTIFY_EMAIL"] = "ops@platform.test";
    delete penv["FRONTEND_URL"];
    delete penv["HOST_URL"];
    try {
      await submitted();
    } finally {
      delete penv["ACCESS_REQUEST_NOTIFY_EMAIL"];
      if (saved.f !== undefined) {
        penv["FRONTEND_URL"] = saved.f;
      }
      if (saved.h !== undefined) {
        penv["HOST_URL"] = saved.h;
      }
    }
    expect(queued[0]).toMatchObject({ actionUrl: null });
  });

  it("with no notify address configured, nothing is queued; a failing queue does not fail the intake", async () => {
    await submitted();
    expect(queued).toHaveLength(0);
    penv["ACCESS_REQUEST_NOTIFY_EMAIL"] = "ops@platform.test";
    jest.spyOn(emailQueue, "queueNotificationEmail").mockRejectedValueOnce(new Error("amqp down"));
    try {
      expect(await svc.submitAccessRequest({ ...INPUT, workEmail: "b@rs.test" }, ORIGIN)).toBe("stored");
    } finally {
      delete penv["ACCESS_REQUEST_NOTIFY_EMAIL"];
    }
  });
});

// ============================================================================
describe("P10-07 — the queue", () => {
  it("lists one status, newest first, with per-status counts and each row's duplicate count", async () => {
    const first = await submitted();
    await submitted({ organisationName: "Klinik B", workEmail: "b@klinik.test" });
    await submitted({ organisationName: "RSUD again" }); // same address as the first
    await svc.rejectAccessRequest(first, { id: first, reason: "Tidak lengkap", spam: false }, ACTOR);

    const pending = await svc.listAccessRequests({ status: "pending", page: 1, limit: 20 });
    expect(pending.rows.map((r) => r.organisationName)).toEqual(["RSUD again", "Klinik B"]);
    expect(pending.rows.find((r) => r.organisationName === "RSUD again")?.duplicateCount).toBe(1);
    expect(pending.rows.find((r) => r.organisationName === "Klinik B")?.duplicateCount).toBe(0);
    expect(pending.meta).toMatchObject({ total: 2, page: 1, limit: 20 });
    expect(pending.meta.counts).toEqual({ pending: 2, approved: 0, rejected: 1, spam: 0, expired: 0 });
    // Never the hashes.
    expect(JSON.stringify(pending.rows)).not.toContain("sourceIpHash");
  });

  it("pages", async () => {
    for (let i = 0; i < 3; i += 1) {
      await submitted({ workEmail: `p${String(i)}@rs.test` });
    }
    const page2 = await svc.listAccessRequests({ status: "pending", page: 2, limit: 2 });
    expect(page2.rows).toHaveLength(1);
    expect(page2.meta.total).toBe(3);
  });

  it("an empty queue is an empty list", async () => {
    expect((await svc.listAccessRequests({ status: "pending", page: 1, limit: 20 })).rows).toEqual([]);
  });

  it("the detail carries the decider's name, the tenant, the invitation state and the other requests of the address", async () => {
    const a = await submitted();
    const b = await submitted({ organisationName: "RSUD dup" });
    const result = await svc.approveAccessRequest(a, { id: a, tenantCode: "RSUDCS" }, ACTOR);
    const detail = await svc.getAccessRequest(a);
    expect(detail).toMatchObject({
      id: a,
      status: "approved",
      decidedBy: { id: SUPER, name: "Andi Operator" },
      provisionedTenant: { code: "RSUDCS", name: INPUT.organisationName },
      adminUserId: result.adminUser.id,
      invitation: { resendable: true, acceptedAt: null },
    });
    expect((detail["duplicates"] as { id: string }[]).map((d) => d.id)).toEqual([b]);
    expect(JSON.stringify(detail)).not.toContain("invitationTokenHash");
  });

  it("a pending request's detail has no decider and no tenant; a request with no user agent stores none", async () => {
    expect(await svc.submitAccessRequest(INPUT, { ip: null, userAgent: null })).toBe("stored");
    const id = String(requests()[0]?.["id"]);
    expect(requests()[0]?.["userAgent"] ?? null).toBeNull();
    expect(await svc.getAccessRequest(id)).toMatchObject({ decidedBy: null, provisionedTenant: null, status: "pending" });
  });

  it("an unknown id is 404", async () => {
    expect(await failure(svc.getAccessRequest("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"))).toMatchObject({ status: 404 });
  });
});

// ============================================================================
describe("P10-05 — approval creates the tenant, its first administrator and the invitation, in one transaction", () => {
  it("creates exactly one tenant THROUGH createTenant, the administrator with no usable password, and APPROVE + CREATE rows", async () => {
    const id = await submitted();
    const result = await svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR);

    const tenants = mdb.rows("Tenant").filter((t) => t["id"] !== PLATFORM_TENANT_ID);
    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({ code: "RSUDCS", name: INPUT.organisationName, city: "Bandung", email: INPUT.workEmail });

    const admin = mdb.rows("User").find((u) => u["email"] === INPUT.workEmail);
    expect(admin).toMatchObject({
      tenantId: tenants[0]?.["id"],
      roleId: ROLE_IDS.HEALTCARE_ADMIN,
      firstName: "Siti",
      lastName: "Rahma Wulandari",
      isEmailVerified: false,
      mustChangePassword: false,
      passwordOneTime: false,
    });
    // A bcrypt hash of random bytes nobody holds (Q-45): no temporary password.
    expect(String(admin?.["password"])).toMatch(/^\$2[aby]\$/);

    const [request] = requests();
    expect(request).toMatchObject({
      status: "approved",
      decidedBy: SUPER,
      provisionedTenantId: tenants[0]?.["id"],
      adminUserId: admin?.["id"],
    });
    expect(request?.["invitationTokenHash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(String(request?.["invitationExpiresAt"])).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);

    const rows = audits().filter((a) => a["actorType"] === "user");
    expect(rows.map((r) => [r["action"], r["resourceType"], r["tenantId"]]).sort()).toEqual(
      [
        ["APPROVE", "AccessRequest", PLATFORM_TENANT_ID],
        ["CREATE", "Tenant", PLATFORM_TENANT_ID],
        ["CREATE", "User", tenants[0]?.["id"]],
      ].sort(),
    );
    const approve = rows.find((r) => r["action"] === "APPROVE");
    expect(approve?.["changes"]).toEqual({
      before: { status: "pending" },
      after: { status: "approved", provisionedTenantId: tenants[0]?.["id"], adminUserId: admin?.["id"] },
    });
    // One transaction for every write of the approval.
    const writes = mdb.committed().filter((w) => ["Tenant", "User", "AccessRequest", "AuditLog"].includes(w.model));
    const approvalTx = writes.find((w) => w.model === "Tenant")?.tx;
    expect(approvalTx).not.toBeNull();
    expect(writes.filter((w) => w.tx === approvalTx).map((w) => w.model).sort()).toEqual(
      ["AccessRequest", "AuditLog", "AuditLog", "AuditLog", "Tenant", "User"].sort(),
    );

    expect(result).toMatchObject({
      adminUser: { id: admin?.["id"], email: INPUT.workEmail },
      invitationSent: true,
      request: { status: "approved" },
    });
    // Never the token.
    expect(JSON.stringify(result)).not.toMatch(/invitation\?token=/);
  });

  it("sends the invitation AFTER commit, in the requester's language, with a link on the configured origin — no credential", async () => {
    penv["FRONTEND_URL"] = "https://app.example.test/";
    let id: string;
    try {
      id = await submitted();
      await svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR);
    } finally {
      delete penv["FRONTEND_URL"];
    }
    expect(queued).toHaveLength(1);
    const mail = queued[0] ?? {};
    expect(mail).toMatchObject({ email: INPUT.workEmail, title: "Undangan ke Device Calibrator", firstName: "Siti" });
    expect(String(mail["actionUrl"])).toMatch(/^https:\/\/app\.example\.test\/invitation\?token=[A-Za-z0-9_-]{43}$/);
    const token = decodeURIComponent(String(mail["actionUrl"]).split("token=")[1] ?? "");
    expect(requests()[0]?.["invitationTokenHash"]).toBe(svc.invitationTokenHash(token));
    expect(requests()[0]?.["invitationSentAt"]).toBeTruthy();
    expect(String(mail["message"])).not.toMatch(/password:|kata sandi:/i);
  });

  it("an English request gets the English invitation; a calibration lab's admin gets the calibrator-admin role", async () => {
    const id = await submitted({ locale: "en", facilityType: "calibration_lab" });
    await svc.approveAccessRequest(id, { id, tenantCode: "LABX" }, ACTOR);
    expect(queued[0]).toMatchObject({ title: "Your invitation to Device Calibrator" });
    expect(mdb.rows("User").find((u) => u["email"] === INPUT.workEmail)?.["roleId"]).toBe(ROLE_IDS.CALIBRATOR_ADMIN);
  });

  it("a failed invitation email does not undo the approval; the queue offers a resend", async () => {
    jest.spyOn(emailQueue, "queueNotificationEmail").mockResolvedValueOnce(false);
    const id = await submitted();
    const result = await svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR);
    expect(result.invitationSent).toBe(false);
    expect(requests()[0]).toMatchObject({ status: "approved", invitationSentAt: null });
    expect(await svc.getAccessRequest(id)).toMatchObject({ invitation: { resendable: true, sentAt: null } });
  });

  it("an already-approved or rejected request answers 409 with a STATE explanation", async () => {
    const id = await submitted();
    await svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR);
    const again = await failure(svc.approveAccessRequest(id, { id, tenantCode: "OTHER" }, { ...ACTOR, userId: OTHER_SUPER }));
    expect(again.status).toBe(409);
    expect(again.message).toMatch(/^This request was already approved on \d{4}-\d{2}-\d{2} by Andi Operator; only a pending request can be decided\.$/);

    const r = await submitted({ workEmail: "r@rs.test" });
    await svc.rejectAccessRequest(r, { id: r, reason: "Bukan faskes", spam: true }, ACTOR);
    const spam = await failure(svc.approveAccessRequest(r, { id: r, tenantCode: "X1" }, ACTOR));
    expect(spam).toMatchObject({ status: 409 });
    expect(spam.message).toContain("already marked as spam on");
    expect(mdb.rows("Tenant").filter((t) => t["id"] !== PLATFORM_TENANT_ID)).toHaveLength(1);
  });

  it("a taken tenant code answers createTenant's 409, and the WHOLE approval rolls back — the request stays pending", async () => {
    mdb.seed("Tenant", { id: "7e7e7e7e-0000-4000-8000-00000000007e", name: "Existing", code: "RSUDCS", subdomain: "x", email: "x@x.test", status: "active" });
    const id = await submitted();
    const before = { users: mdb.rows("User").length, audits: audits().length };
    const err = await failure(svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR));
    expect(err).toMatchObject({ status: 409, message: "Tenant code already exists" });
    expect(requests()[0]).toMatchObject({ status: "pending" });
    expect(requests()[0]?.["provisionedTenantId"] ?? null).toBeNull();
    expect(requests()[0]?.["decidedBy"] ?? null).toBeNull();
    expect(mdb.rows("User")).toHaveLength(before.users);
    expect(audits()).toHaveLength(before.audits);
    expect(mdb.rows("Tenant")).toHaveLength(2);
    expect(queued).toHaveLength(0);
  });

  it("an address that already has an account answers 409 with a state explanation; nothing is created", async () => {
    mdb.seed("User", {
      id: "6c6c6c6c-0000-4000-8000-00000000006c",
      email: "SITI@rsud-contoh.go.id",
      username: "siti",
      password: "x",
      firstName: "S",
      lastName: "R",
      tenantId: PLATFORM_TENANT_ID,
      isDeleted: false,
    });
    const id = await submitted();
    const err = await failure(svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR));
    expect(err).toMatchObject({ status: 409, message: svc.ADDRESS_TAKEN });
    expect(requests()[0]?.["status"]).toBe("pending");
    expect(mdb.rows("Tenant")).toHaveLength(1);
    // And no cache entry for a tenant that never committed (afterCommit, not inline).
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("the admin's username avoids a taken one", async () => {
    mdb.seed("User", {
      id: "6d6d6d6d-0000-4000-8000-00000000006d",
      email: "other@x.test",
      username: "siti",
      password: "x",
      firstName: "S",
      lastName: "R",
      tenantId: PLATFORM_TENANT_ID,
      isDeleted: false,
    });
    const id = await submitted();
    await svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS", adminFirstName: "Siti", adminLastName: "W" }, ACTOR);
    const admin = mdb.rows("User").find((u) => u["email"] === INPUT.workEmail);
    expect(admin?.["username"]).toMatch(/^siti\d{1,4}$/);
    expect(admin).toMatchObject({ firstName: "Siti", lastName: "W" });
  });

  it("a decided row without a decision date, or a decider with no name, still explains itself", async () => {
    mdb.seed("User", {
      id: "7a7a7a7a-0000-4000-8000-00000000007a",
      email: "noname@platform.test",
      username: "noname",
      password: "x",
      firstName: "",
      lastName: "",
      roleId: ROLE_IDS.SUPER_ADMIN,
      tenantId: PLATFORM_TENANT_ID,
      isDeleted: false,
    });
    const [row] = mdb.seed("AccessRequest", {
      id: "7b7b7b7b-0000-4000-8000-00000000007b",
      organisationName: "X",
      facilityType: "other",
      city: "Y",
      deviceCountBand: "unknown",
      contactName: "Z",
      workEmail: "z@z.test",
      whatsapp: "+6281234567890",
      locale: "en",
      consentVersion: "v",
      consentedAt: new Date(),
      status: "rejected",
      decidedBy: "7a7a7a7a-0000-4000-8000-00000000007a",
      sourceIpHash: "0".repeat(64),
    });
    const id = String(row?.["id"]);
    const err = await failure(svc.approveAccessRequest(id, { id, tenantCode: "ZZ" }, ACTOR));
    expect(err.message).toBe(
      "This request was already rejected on an unknown date by noname; only a pending request can be decided.",
    );
    // A decider whose account is gone: the detail keeps the id, the name is null.
    await mdb.sequelize.models["AccessRequest"]?.update(
      { decidedBy: "7c7c7c7c-0000-4000-8000-00000000007c" },
      { where: { id } },
    );
    expect(await svc.getAccessRequest(id)).toMatchObject({
      decidedBy: { id: "7c7c7c7c-0000-4000-8000-00000000007c", name: null },
    });
  });

  it("an EXPIRED request (decided by nobody) answers 409 naming no decider", async () => {
    const id = await submitted();
    await svc.runAccessRequestRetention(new Date(Date.now() + 91 * 86400000));
    const err = await failure(svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR));
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/^This request was already expired on \d{4}-\d{2}-\d{2}; only a pending request can be decided\.$/);
  });

  it("when no free username can be derived, the approval is a 409 and rolls back", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the same module object the service holds
    const userService = require("../../services/user.service") as { assertIdentityFree: (f: string) => Promise<void> };
    jest.spyOn(userService, "assertIdentityFree").mockImplementation(async (field: string) => {
      if (field === "username") {
        throw Object.assign(new Error("Username already used"), { status: 409 });
      }
      return Promise.resolve();
    });
    const id = await submitted();
    const err = await failure(svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR));
    expect(err).toMatchObject({ status: 409 });
    expect(err.message).toContain("No free username");
    expect(requests()[0]?.["status"]).toBe("pending");
    expect(mdb.rows("Tenant")).toHaveLength(1);
  });

  it("an unexpected failure of the identity check propagates as itself (not disguised as a 409)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the same module object the service holds
    const userService = require("../../services/user.service") as { assertIdentityFree: (f: string) => Promise<void> };
    const spy = jest.spyOn(userService, "assertIdentityFree").mockRejectedValueOnce(new Error("connection reset"));
    const id = await submitted();
    await expect(svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR)).rejects.toThrow("connection reset");
    spy.mockReset().mockImplementation(async (field: string) => {
      if (field === "username") {
        throw new Error("connection reset again");
      }
      return Promise.resolve();
    });
    await expect(svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR)).rejects.toThrow("connection reset again");
    expect(requests()[0]?.["status"]).toBe("pending");
  });

  it("the tenant cache is written only after the commit", async () => {
    const id = await submitted();
    await svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR);
    await new Promise((resolve) => setImmediate(resolve));
    expect(redis.set).toHaveBeenCalled();
  });

  it("an unknown id is 404 and writes nothing", async () => {
    const err = await failure(
      svc.approveAccessRequest("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", { id: "x", tenantCode: "X1" }, ACTOR),
    );
    expect(err).toMatchObject({ status: 404 });
    expect(audits()).toHaveLength(0);
  });
});

// ============================================================================
describe("P10-05 — rejection", () => {
  it("rejects with the reason, audited as UPDATE with status only; spam marks spam", async () => {
    const id = await submitted();
    const row = await svc.rejectAccessRequest(id, { id, reason: "Di luar cakupan", spam: false }, ACTOR);
    expect(row.status).toBe("rejected");
    expect(requests()[0]).toMatchObject({ status: "rejected", decidedBy: SUPER, decisionNote: "Di luar cakupan" });
    const audit = audits().find((a) => a["action"] === "UPDATE");
    expect(audit).toMatchObject({ tenantId: PLATFORM_TENANT_ID, userId: SUPER, resourceId: id });
    expect(audit?.["changes"]).toEqual({ before: { status: "pending" }, after: { status: "rejected" } });

    const s = await submitted({ workEmail: "s@rs.test" });
    expect((await svc.rejectAccessRequest(s, { id: s, reason: "bot", spam: true }, ACTOR)).status).toBe("spam");
  });

  it("a decided request cannot be rejected (409), an unknown one is 404", async () => {
    const id = await submitted();
    await svc.rejectAccessRequest(id, { id, reason: "x", spam: false }, ACTOR);
    expect(await failure(svc.rejectAccessRequest(id, { id, reason: "y", spam: false }, ACTOR))).toMatchObject({ status: 409 });
    expect(
      await failure(svc.rejectAccessRequest("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", { id: "x", reason: "y", spam: false }, ACTOR)),
    ).toMatchObject({ status: 404 });
  });
});

// ============================================================================
describe("P10-15 — the invitation", () => {
  const approveAndToken = async (): Promise<{ id: string; token: string }> => {
    const id = await submitted();
    await svc.approveAccessRequest(id, { id, tenantCode: "RSUDCS" }, ACTOR);
    const url = String(queued.at(-1)?.["actionUrl"]);
    return { id, token: decodeURIComponent(url.split("token=")[1] ?? "") };
  };

  it("sets the password, verifies the address, spends the token and audits — once", async () => {
    const { id, token } = await approveAndToken();
    await invitation.acceptInvitation(token, "Str0ngPassw0rd", { ipAddress: "1.2.3.4", userAgent: "jest" });
    const admin = mdb.rows("User").find((u) => u["email"] === INPUT.workEmail) ?? {};
    expect(await bcrypt.compare("Str0ngPassw0rd", String(admin["password"]))).toBe(true);
    expect(admin).toMatchObject({ isEmailVerified: true, mustChangePassword: false, passwordOneTime: false });
    expect(requests()[0]).toMatchObject({ invitationTokenHash: null });
    expect(requests()[0]?.["invitationAcceptedAt"]).toBeTruthy();
    const row = audits().find((a) => (a["changes"] as { operation?: string } | null)?.operation === "INVITATION_ACCEPTED");
    expect(row).toMatchObject({ tenantId: admin["tenantId"], userId: admin["id"], resourceType: "User" });
    expect(JSON.stringify(row)).not.toContain("Str0ngPassw0rd");
    expect(JSON.stringify(row)).not.toContain(token);

    // Single use.
    const again = await failure(invitation.acceptInvitation(token, "An0therPassw0rd", { ipAddress: null, userAgent: null }));
    expect(again).toMatchObject({ status: 400, message: invitation.INVITATION_INVALID });
    // The queue no longer offers a resend, and a resend is refused with a state explanation.
    expect(await svc.getAccessRequest(id)).toMatchObject({ invitation: { resendable: false } });
    expect(await failure(svc.resendInvitation(id, ACTOR))).toMatchObject({ status: 409 });
  });

  it("an expired, unknown or wrong-purpose token is the ONE 400", async () => {
    const { token } = await approveAndToken();
    await mdb.sequelize.models["AccessRequest"]?.update(
      { invitationExpiresAt: new Date(Date.now() - 1000) },
      { where: {} },
    );
    const expired = await failure(invitation.acceptInvitation(token, "Str0ngPassw0rd", { ipAddress: null, userAgent: null }));
    const unknown = await failure(invitation.acceptInvitation("A".repeat(43), "Str0ngPassw0rd", { ipAddress: null, userAgent: null }));
    // A JWT-shaped (activation/access) token is not an invitation: it never matches a stored hash.
    const jwtShaped = await failure(
      invitation.acceptInvitation("eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJhY3RpdmF0aW9uIn0.sig", "Str0ngPassw0rd", {
        ipAddress: null,
        userAgent: null,
      }),
    );
    for (const err of [expired, unknown, jwtShaped]) {
      expect(err).toEqual(expect.objectContaining({ status: 400, message: invitation.INVITATION_INVALID }));
    }
  });

  it("a failed audit insert rolls the acceptance back: the password is unchanged, the token still unspent", async () => {
    const { token } = await approveAndToken();
    const before = mdb.rows("User").find((u) => u["email"] === INPUT.workEmail)?.["password"];
    jest.spyOn(auditService, "logAction").mockRejectedValueOnce(new Error("audit insert failed"));
    await expect(invitation.acceptInvitation(token, "Str0ngPassw0rd", { ipAddress: null, userAgent: null })).rejects.toThrow(
      "audit insert failed",
    );
    expect(mdb.rows("User").find((u) => u["email"] === INPUT.workEmail)?.["password"]).toBe(before);
    expect(requests()[0]?.["invitationTokenHash"]).toBe(svc.invitationTokenHash(token));
  });

  it("an account suspended since the approval cannot be activated by the link", async () => {
    const { token } = await approveAndToken();
    await mdb.sequelize.models["User"]?.update({ status: "SUSPENDED" }, { where: { email: INPUT.workEmail }, skipTenantScope: true });
    expect(await failure(invitation.acceptInvitation(token, "Str0ngPassw0rd", { ipAddress: null, userAgent: null }))).toMatchObject({
      status: 400,
    });
  });

  it("a resend mints a new token and invalidates the old one, audited", async () => {
    const { id, token: old } = await approveAndToken();
    const result = await svc.resendInvitation(id, ACTOR);
    expect(result.invitationSent).toBe(true);
    const fresh = decodeURIComponent(String(queued.at(-1)?.["actionUrl"]).split("token=")[1] ?? "");
    expect(fresh).not.toBe(old);
    expect(await failure(invitation.acceptInvitation(old, "Str0ngPassw0rd", { ipAddress: null, userAgent: null }))).toMatchObject({
      status: 400,
    });
    await invitation.acceptInvitation(fresh, "Str0ngPassw0rd", { ipAddress: null, userAgent: null });
    expect(
      audits().some((a) => (a["changes"] as { operation?: string } | null)?.operation === "INVITATION_REISSUED"),
    ).toBe(true);
  });

  it("a pending request has no invitation to resend (409)", async () => {
    const id = await submitted();
    expect(await failure(svc.resendInvitation(id, ACTOR))).toMatchObject({ status: 409 });
  });
});

// ============================================================================
describe("Q-42 — retention and erasure", () => {
  const ageTo = async (id: string, values: Record<string, unknown>): Promise<void> => {
    await mdb.sequelize.models["AccessRequest"]?.update(values, { where: { id }, silent: true });
  };

  it("a pending request older than 90 days expires; decided ones older than 12 months are deleted; approved ones stay", async () => {
    const now = new Date("2027-12-01T00:00:00Z");
    const old = await submitted({ workEmail: "old@rs.test" });
    const fresh = await submitted({ workEmail: "fresh@rs.test" });
    const rejectedOld = await submitted({ workEmail: "rej@rs.test" });
    const rejectedNew = await submitted({ workEmail: "rej2@rs.test" });
    const approved = await submitted({ workEmail: "ok@rs.test" });
    await svc.rejectAccessRequest(rejectedOld, { id: rejectedOld, reason: "x", spam: false }, ACTOR);
    await svc.rejectAccessRequest(rejectedNew, { id: rejectedNew, reason: "x", spam: false }, ACTOR);
    await svc.approveAccessRequest(approved, { id: approved, tenantCode: "OKT" }, ACTOR);
    await ageTo(old, { createdAt: new Date("2027-08-01T00:00:00Z") });
    await ageTo(fresh, { createdAt: new Date("2027-11-20T00:00:00Z") });
    await ageTo(rejectedOld, { decidedAt: new Date("2026-11-01T00:00:00Z") });
    await ageTo(rejectedNew, { decidedAt: new Date("2027-06-01T00:00:00Z") });
    await ageTo(approved, { decidedAt: new Date("2025-01-01T00:00:00Z") });

    expect(await svc.runAccessRequestRetention(now)).toEqual({ expired: 1, purged: 1 });
    const byId = new Map(requests().map((r) => [r["id"], r]));
    expect(byId.get(old)).toMatchObject({ status: "expired" });
    expect(byId.get(fresh)).toMatchObject({ status: "pending" });
    expect(byId.has(rejectedOld)).toBe(false);
    expect(byId.get(rejectedNew)).toMatchObject({ status: "rejected" });
    expect(byId.get(approved)).toMatchObject({ status: "approved" });

    const rows = audits().filter((a) => a["actorName"] === "system:access-request-retention");
    expect(rows.map((r) => r["action"]).sort()).toEqual(["DELETE", "UPDATE"]);
    for (const row of rows) {
      expect(row["tenantId"]).toBe(PLATFORM_TENANT_ID);
      expect(JSON.stringify(row["changes"])).not.toContain("@rs.test");
    }
    // An expired row is itself deleted 12 months after its expiry.
    // A year on: `fresh` expires now; `old` (expired a year ago) and `rejectedNew` are deleted.
    expect(await svc.runAccessRequestRetention(new Date("2028-12-02T00:00:00Z"))).toEqual({ expired: 1, purged: 2 });
    expect(requests().map((r) => r["id"]).sort()).toEqual([fresh, approved].sort());
  });

  it("a run with nothing due writes nothing", async () => {
    await submitted();
    expect(await svc.runAccessRequestRetention()).toEqual({ expired: 0, purged: 0 });
    expect(audits().filter((a) => a["actorName"] === "system:access-request-retention")).toHaveLength(0);
  });

  it("an erasure by address deletes what never became a tenant and masks an approved request, audited", async () => {
    const pending = await submitted();
    const approved = await submitted({ organisationName: "RS approved" });
    await submitted({ workEmail: "someone-else@rs.test" });
    await svc.approveAccessRequest(approved, { id: approved, tenantCode: "RSAP" }, ACTOR);

    expect(await svc.eraseAccessRequestsByEmail(" SITI@rsud-contoh.go.id ", ACTOR)).toEqual({ deleted: 1, masked: 1 });
    const left = new Map(requests().map((r) => [r["id"], r]));
    expect(left.has(pending)).toBe(false);
    expect(left.get(approved)).toMatchObject({ contactName: "[erased]", whatsapp: "+0", status: "approved" });
    expect(JSON.stringify(requests())).not.toContain(INPUT.workEmail);
    expect(requests()).toHaveLength(2);
    const row = audits().find((a) => (a["changes"] as { operation?: string } | null)?.operation === "ACCESS_REQUESTS_ERASED");
    expect(row).toMatchObject({ userId: SUPER, tenantId: PLATFORM_TENANT_ID });
    expect(JSON.stringify(row)).not.toContain(INPUT.workEmail);
    // Nothing held for an unknown address: no rows, no audit row.
    const count = audits().length;
    expect(await svc.eraseAccessRequestsByEmail("nobody@x.test", ACTOR)).toEqual({ deleted: 0, masked: 0 });
    expect(audits()).toHaveLength(count);
  });
});

describe("pure helpers", () => {
  it("hashSourceIp: no address hashes a fixed placeholder, never an empty key", () => {
    expect(svc.hashSourceIp(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.hashSourceIp(null)).not.toBe(svc.hashSourceIp("203.0.113.9"));
  });

  it("splitName, usernameBase", () => {
    expect(svc.splitName("   ")).toEqual({ firstName: "", lastName: "" });
    expect(svc.usernameBase("no-at-sign")).toBe("noatsign");
    expect(svc.splitName("Ada")).toEqual({ firstName: "Ada", lastName: "Ada" });
    expect(svc.splitName("  Ada   King  Lovelace ")).toEqual({ firstName: "Ada", lastName: "King Lovelace" });
    expect(svc.usernameBase("a.b@x.test")).toBe("abadmin");
    expect(svc.usernameBase("Siti.Rahma+ops@x.test")).toBe("sitirahmaops");
  });

  it("an invitation token is 256 bits, and only its hash is kept", () => {
    const { token, hash } = svc.newInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(svc.invitationTokenHash(token));
    expect(hash).not.toContain(token);
  });
});
