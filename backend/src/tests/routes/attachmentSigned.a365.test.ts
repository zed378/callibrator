/**
 * A-365 (F-1 of docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md § 9) — signed
 * attachment links: a bounded lifetime, a token bound to the tenant and to
 * the principal that minted it, and a redemption that re-checks the row.
 *
 * Before A-365: `POST /:id/signed-url` took `expiresInSec` from the body with
 * no upper bound and no schema (a link could live for years); the token was
 * `<exp>.<hmac(id.exp)>`, bound to neither tenant nor principal; and
 * `GET /:id/signed` loaded the row by primary key alone, so a link outlived its
 * issuer's account and followed the row wherever it went.
 *
 * REAL router, validate, dynamicAccess, controller, attachment service and the
 * REAL models with their tenant hooks (fixtures/memoryDb). Doubled: the bytes
 * (the stored file exists; sendStoredFile answers with the path it would serve).
 *
 * Fail-before: every "400" case (the route had no schema and the service
 * accepted any positive number), "a token naming the old shape is refused",
 * and every redemption "404" case (the row was found by id alone and the
 * issuer and tenant were never read) — the redemption-after-move case answered
 * 200 with tenant B's file.
 *
 * @two-tenant api/attachments.route.ts GET /:id/signed
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as FileResponse from "../../utils/fileResponse.util";
import type * as RouteModule from "../../routes/api/attachments.route";
import type * as ModelsModule from "../../models";
import type * as ServiceModule from "../../services/attachment.service";
import { environment } from "../../config/env";
import { toTenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../utils/fileResponse.util", () => ({
  ...jest.requireActual<typeof FileResponse>("../../utils/fileResponse.util"),
  sendStoredFile: (res: { status: (c: number) => { json: (b: unknown) => unknown } }, absPath: string) => {
    res.status(200).json({ served: absPath });
    return Promise.resolve();
  },
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/attachments.route");
const models = jest.requireActual<typeof ModelsModule>("../../models");

const ATTACHMENT_A = "a1000000-0000-4000-8000-000000000365";
const ATTACHMENT_B = "b1000000-0000-4000-8000-000000000365";
const STORED_NAME = "a365-signed.pdf";

interface LinkAnswer {
  data: { url: string; token: string; expiresAt: string; expiresInSec: number } | null;
}

let owner: Principal;
let other: Principal;
let tenantB: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV = environment();

const attachmentRow = (id: string, tenantId: string, uploadedBy: string) => ({
  id,
  tenantId,
  resourceType: "generic",
  fileName: STORED_NAME,
  originalName: "calibration-report.pdf",
  folder: "uploads/attachments",
  mimeType: "application/pdf",
  size: 1024,
  uploadedBy,
});

/** Mint a link through the real route, as `who`. */
const mint = async (who: Principal, id: string, body: Record<string, unknown> = {}) => {
  as(who);
  return call(router, "POST", `/${id}/signed-url`, { body });
};

const tokenOf = async (who: Principal, id: string): Promise<string> => {
  const res = await mint(who, id);
  expect(res.status).toBe(200);
  return (res.body as LinkAnswer).data?.token ?? "";
};

const redeem = (id: string, token: string) => {
  as(null);
  return call(router, "GET", `/${id}/signed`, { query: { token } });
};

/** The body of a 404 with the id masked, for "indistinguishable" checks. */
const shapeOf = (body: unknown): string => JSON.stringify(body);

beforeEach(() => {
  for (const k of ["ATTACHMENT_URL_MAX_TTL_SEC", "ATTACHMENT_URL_TTL_SEC"]) {
    savedEnv[k] = ENV[k];
    Reflect.deleteProperty(ENV, k);
  }
  mdb.reset();
  grantAllMenus();
  const realExists = fs.existsSync.bind(fs);
  jest.spyOn(fs, "existsSync").mockImplementation((p) => String(p).endsWith(STORED_NAME) || realExists(p));
  const fx = twoTenants();
  owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  tenantB = fx.tenantB.id;
  seedTenants(mdb, fx, [owner, other]);
  mdb.seed("Attachment", attachmentRow(ATTACHMENT_A, fx.tenantA.id, owner.id));
  mdb.seed("Attachment", attachmentRow(ATTACHMENT_B, fx.tenantB.id, other.id));
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) {
      Reflect.deleteProperty(ENV, k);
    } else {
      ENV[k] = v;
    }
  }
  jest.restoreAllMocks();
});

describe("A-365 — the lifetime of a signed link is bounded", () => {
  it("no lifetime takes the default, 300 s", async () => {
    const res = await mint(owner, ATTACHMENT_A);
    expect(res.status).toBe(200);
    expect((res.body as LinkAnswer).data?.expiresInSec).toBe(300);
  });

  it("a lifetime at the default cap (900 s) is accepted", async () => {
    const res = await mint(owner, ATTACHMENT_A, { expiresInSec: 900 });
    expect(res.status).toBe(200);
    expect((res.body as LinkAnswer).data?.expiresInSec).toBe(900);
  });

  it.each([
    ["above the cap", 901],
    ["an hour (what the kanban card used to ask for)", 3600],
    ["years", 10 * 365 * 24 * 3600],
    ["below the 30 s floor", 29],
    ["zero", 0],
    ["negative", -5],
    ["fractional", 120.5],
    ["a numeric string", "600"],
  ])("%s → 400, and no link is minted", async (_label, expiresInSec) => {
    const res = await mint(owner, ATTACHMENT_A, { expiresInSec });
    expect(res.status).toBe(400);
    expect((res.body as LinkAnswer).data).toBeNull();
  });

  it("the cap is configurable (ATTACHMENT_URL_MAX_TTL_SEC) and read per request", async () => {
    ENV["ATTACHMENT_URL_MAX_TTL_SEC"] = "120";
    expect((await mint(owner, ATTACHMENT_A, { expiresInSec: 300 })).status).toBe(400);
    expect((await mint(owner, ATTACHMENT_A, { expiresInSec: 120 })).status).toBe(200);
    // The default never exceeds the cap.
    const res = await mint(owner, ATTACHMENT_A);
    expect((res.body as LinkAnswer).data?.expiresInSec).toBe(120);
  });

  it("no configuration lifts the cap above one hour", async () => {
    ENV["ATTACHMENT_URL_MAX_TTL_SEC"] = "999999";
    expect((await mint(owner, ATTACHMENT_A, { expiresInSec: 3600 })).status).toBe(200);
    expect((await mint(owner, ATTACHMENT_A, { expiresInSec: 3601 })).status).toBe(400);
  });
});

describe("A-365 — redemption re-checks the row, its tenant and the issuer", () => {
  it("a fresh link for a live row serves the file without a session", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    const res = await redeem(ATTACHMENT_A, token);
    expect(res.status).toBe(200);
    expect((res.body as { served: string }).served).toMatch(/a365-signed\.pdf$/);
  });

  it("the token names the tenant and the issuer it was minted for", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    const [, tenant, issuer] = token.split(".");
    expect(tenant).toBe(owner.tenantId);
    expect(issuer).toBe(`u${owner.id}`);
  });

  it("two tenants: a link minted in tenant A stops working once the row is in tenant B — 404, as for a deleted row", async () => {
    const tokenMoved = await tokenOf(owner, ATTACHMENT_A);
    await models.Attachment.update({ tenantId: toTenantId(tenantB) }, { where: { id: ATTACHMENT_A } });
    const moved = await redeem(ATTACHMENT_A, tokenMoved);
    expect(moved.status).toBe(404);

    // Restore, then delete: the same answer, byte for byte.
    await models.Attachment.update({ tenantId: toTenantId(owner.tenantId) }, { where: { id: ATTACHMENT_A } });
    const tokenDeleted = await tokenOf(owner, ATTACHMENT_A);
    await models.Attachment.update({ isDeleted: true }, { where: { id: ATTACHMENT_A } });
    const deleted = await redeem(ATTACHMENT_A, tokenDeleted);
    expect(deleted.status).toBe(404);
    expect(shapeOf(moved.body)).toBe(shapeOf(deleted.body));
  });

  it("two tenants: tenant B's file cannot be reached with tenant A's link (the signature binds the id) — 403", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    const res = await redeem(ATTACHMENT_B, token);
    expect(res.status).toBe(403);
  });

  it("a tampered token is refused: the tenant segment rewritten to tenant B", async () => {
    const [exp, , issuer, sig] = (await tokenOf(owner, ATTACHMENT_A)).split(".");
    const res = await redeem(ATTACHMENT_A, [exp, tenantB, issuer, sig].join("."));
    expect(res.status).toBe(403);
  });

  it("a tampered token is refused: the expiry pushed forward", async () => {
    const [exp, tenant, issuer, sig] = (await tokenOf(owner, ATTACHMENT_A)).split(".");
    const res = await redeem(ATTACHMENT_A, [String(Number(exp) + 86400), tenant, issuer, sig].join("."));
    expect(res.status).toBe(403);
  });

  it("a token of the pre-A-365 shape `<exp>.<hmac(id.exp)>` is refused, however long it was meant to live", async () => {
    const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
    const secret = ENV["ATTACHMENT_URL_SECRET"] ?? ENV["CERT_SIGNING_SECRET"] ?? "";
    const sig = crypto.createHmac("sha256", secret).update(`${ATTACHMENT_A}.${String(exp)}`).digest("hex");
    const res = await redeem(ATTACHMENT_A, `${String(exp)}.${sig}`);
    expect(res.status).toBe(403);
  });

  it("an expired link is refused (403) before any row is read", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    const exp = Number(token.split(".")[0]);
    jest.spyOn(Date, "now").mockReturnValue((exp + 1) * 1000);
    const res = await redeem(ATTACHMENT_A, token);
    expect(res.status).toBe(403);
  });

  it("a link whose issuer was deactivated stops working — 404", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    await models.User.update({ isActive: false }, { where: { id: owner.id } });
    expect((await redeem(ATTACHMENT_A, token)).status).toBe(404);
  });

  it("a link whose issuer was suspended stops working — 404", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    await models.User.update({ status: "SUSPENDED" }, { where: { id: owner.id } });
    expect((await redeem(ATTACHMENT_A, token)).status).toBe(404);
  });

  it("a link whose tenant was suspended stops working — 404", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    await models.Tenant.update({ status: "suspended" }, { where: { id: owner.tenantId } });
    expect((await redeem(ATTACHMENT_A, token)).status).toBe(404);
  });
});

describe("A-365 — the service's other callers and principals", () => {
  const KEY = "c1000000-0000-4000-8000-000000000365";
  const service = jest.requireActual<typeof ServiceModule>("../../services/attachment.service");

  const seedKey = (over: Record<string, unknown> = {}): void => {
    mdb.seed("ApiKey", {
      id: KEY,
      tenantId: owner.tenantId,
      name: "integration",
      keyPrefix: "cal_a365",
      keyHash: "0".repeat(64),
      scopes: ["equipment:read"],
      isActive: true,
      expiresAt: null,
      ...over,
    });
  };
  const keyToken = async (): Promise<string> =>
    (await service.generateSignedUrl(owner.tenantId, ATTACHMENT_A, { issuer: { apiKeyId: KEY } })).token;

  it("a link minted by an API key names the key, and works while the key is live", async () => {
    seedKey();
    const token = await keyToken();
    expect(token.split(".")[2]).toBe(`k${KEY}`);
    expect((await redeem(ATTACHMENT_A, token)).status).toBe(200);
  });

  it("a key with an expiry still ahead keeps its link working", async () => {
    seedKey({ expiresAt: new Date(Date.now() + 86_400_000) });
    expect((await redeem(ATTACHMENT_A, await keyToken())).status).toBe(200);
  });

  it.each([
    ["revoked (inactive)", { isActive: false }],
    ["expired", { expiresAt: new Date(Date.now() - 1000) }],
  ])("a link whose key was %s stops working — 404", async (_label, over) => {
    seedKey(over);
    expect((await redeem(ATTACHMENT_A, await keyToken())).status).toBe(404);
  });

  it("a link whose key is gone stops working — 404", async () => {
    expect((await redeem(ATTACHMENT_A, await keyToken())).status).toBe(404);
  });

  it("no principal, no link — 401", async () => {
    await expect(service.generateSignedUrl(owner.tenantId, ATTACHMENT_A, {})).rejects.toMatchObject({ status: 401 });
    await expect(service.generateSignedUrl(owner.tenantId, ATTACHMENT_A)).rejects.toMatchObject({ status: 401 });
  });

  it("a deleted tenant ends its links — 404", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    await models.Tenant.update({ isDeleted: true }, { where: { id: owner.tenantId } });
    expect((await redeem(ATTACHMENT_A, token)).status).toBe(404);
  });

  it("a tenant row without a status is not refused for it", async () => {
    const token = await tokenOf(owner, ATTACHMENT_A);
    await models.Tenant.update({ status: null }, { where: { id: owner.tenantId } });
    expect((await redeem(ATTACHMENT_A, token)).status).toBe(200);
  });

  it.each([
    ["a non-numeric expiry", (t: string[]) => ["soon", t[1], t[2], t[3]]],
    ["an empty tenant", (t: string[]) => [t[0], "", t[2], t[3]]],
    ["an issuer of no known kind", (t: string[]) => [t[0], t[1], `x${owner.id}`, t[3]]],
    ["an empty signature", (t: string[]) => [t[0], t[1], t[2], ""]],
  ])("a token with %s is refused (403)", async (_label, mangle) => {
    const parts = (await tokenOf(owner, ATTACHMENT_A)).split(".");
    expect((await redeem(ATTACHMENT_A, mangle(parts).join("."))).status).toBe(403);
  });

  it("a token claiming a lifetime beyond the hard ceiling is refused even before its signature is checked", () => {
    const exp = Math.floor(Date.now() / 1000) + 3601;
    expect(service._verifySignedToken(ATTACHMENT_A, `${String(exp)}.${owner.tenantId}.u${owner.id}.${"0".repeat(64)}`)).toBe(false);
  });
});
