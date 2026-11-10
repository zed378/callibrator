/**
 * P24-04 (ADR-133 Am. 6) — `./backend import-key provision | status | revoke`.
 *
 * REAL: the CLI's `main`, the import-key service, the ApiKey, User and Tenant models and the tenant
 * hooks over memoryDb, the audit service and `apiKey.service#revokeApiKey`. Mocked: only
 * `utils/env.util` (it reads backend/.env) and the database handle's `close`. Synthetic data only.
 *
 * Fail-before: without the command, `./backend import-key` was not recognised and started the server;
 * the only caller of `provisionImportKey` was the development dry-run script, so a deployment had no
 * way to give a tenant its import key (the transform failed IMPORT_KEY_MISSING).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as CliModule from "../../scripts/importKey";
import type * as DispatchModule from "../../scripts/cliDispatch";
import type * as ApiKeyServiceModule from "../../services/apiKey.service";
import type * as ImportKeyServiceModule from "../../services/upstreamImport/importKey";
import { seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { environment } from "../../config/env";

jest.mock("../../utils/env.util", () => ({}));
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the config mock, as every memoryDb test */
const cli = require("../../scripts/importKey") as typeof CliModule;
const dispatch = require("../../scripts/cliDispatch") as typeof DispatchModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const SIGN_OFF = "2099-01-01";
const penv = environment();
const ORIGINAL_GATE = penv["UPSTREAM_REAL_DATA_ALLOWED"];

let world: IpmWorld;
let closeSpy: jest.SpyInstance;
let out: string[];
let err: string[];

/** The operator's e-mail, as routeClient's seedTenants derives it (`<username>@<tenant id prefix>.test`). */
const emailOf = (p: { username: string }, tenantId: string): string => `${p.username}@${tenantId.slice(0, 8)}.test`;
const keys = (): Record<string, unknown>[] => mdb.rows("ApiKey");
const audits = (operation: string): Record<string, unknown>[] =>
  mdb.rows("AuditLog").filter((a) => (a["changes"] as { operation?: string } | null)?.operation === operation);

const run = async (...args: string[]): Promise<number> => cli.main(args);
const provisionArgs = (over: Partial<Record<"tenant" | "user" | "sign-off" | "data-class", string>> = {}): string[] => {
  const flags = { tenant: world.tenantA, user: emailOf(world.admin, world.tenantA), "sign-off": SIGN_OFF, "data-class": "synthetic", ...over };
  return ["provision", ...Object.entries(flags).flatMap(([k, v]) => (v === "" ? [] : [`--${k}`, v]))];
};

beforeEach(() => {
  mdb.reset();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("TenantSettings", { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" });
  delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
  out = [];
  err = [];
  jest.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  jest.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  closeSpy = jest.spyOn(mdb.sequelize, "close").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_GATE === undefined) {
    delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
  } else {
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = ORIGINAL_GATE;
  }
});

describe("import-key provision", () => {
  it("creates the key as the named operator, audited, and prints its prefix and expiry — never anything secret", async () => {
    expect(await run(...provisionArgs())).toBe(0);

    expect(keys()).toEqual([
      expect.objectContaining({ tenantId: world.tenantA, name: "upstream-import", scopes: ["calibration:write"], createdBy: world.admin.id }),
    ]);
    expect(audits("IMPORT_KEY_CREATE")).toEqual([expect.objectContaining({ tenantId: world.tenantA, userId: world.admin.id, action: "CREATE" })]);
    const text = out.join("");
    expect(text).toMatch(/Import key created for .*: cbk_[0-9a-f]{8}… \(calibration:write\), expires 2099-04-01\. Recorded by /);
    expect(text).not.toContain(String(keys()[0]?.["keyHash"]));
    expect(err).toEqual([]);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("takes the operator by username as well as by e-mail", async () => {
    expect(await run(...provisionArgs({ user: world.admin.username }))).toBe(0);
    expect(keys()).toHaveLength(1);
  });

  it("a second provision says the key is usable and writes nothing", async () => {
    await run(...provisionArgs());
    out.length = 0;
    expect(await run(...provisionArgs())).toBe(0);
    expect(out.join("")).toMatch(/already has a usable import key: cbk_/);
    expect(out.join("")).toMatch(/Nothing was written\./);
    expect(keys()).toHaveLength(1);
    expect(audits("IMPORT_KEY_CREATE")).toHaveLength(1);
  });

  it("refuses a run declared real while UPSTREAM_REAL_DATA_ALLOWED is off (exit 1), and writes nothing", async () => {
    expect(await run(...provisionArgs({ "data-class": "real" }))).toBe(1);
    expect(err.join("")).toMatch(/Refused: .*UPSTREAM_REAL_DATA_ALLOWED is off/);
    expect(keys()).toHaveLength(0);
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
    expect(await run(...provisionArgs({ "data-class": "real" }))).toBe(0);
    expect(keys()).toHaveLength(1);
  });

  it("refuses a sign-off whose + 90 days is past (exit 1)", async () => {
    expect(await run(...provisionArgs({ "sign-off": "2020-01-01" }))).toBe(1);
    expect(err.join("")).toMatch(/already be expired/);
    expect(keys()).toHaveLength(0);
  });

  it.each([
    ["an unknown e-mail", "nobody@cli.test"],
    ["an operator of ANOTHER tenant", ""],
  ])("refuses %s (exit 1, 404 wording), and creates no key", async (_why, user) => {
    const other = user || emailOf(world.other, world.tenantB);
    expect(await run(...provisionArgs({ user: other }))).toBe(1);
    expect(err.join("")).toMatch(/Refused: No active user of this tenant/);
    expect(keys()).toHaveLength(0);
  });

  it("refuses a tenant id that no tenant has (exit 1)", async () => {
    expect(await run(...provisionArgs({ tenant: "d1000000-0000-4000-8000-00000000dead" }))).toBe(1);
    expect(err.join("")).toMatch(/Refused: No tenant has that id\./);
  });

  it.each([
    ["no --tenant", { tenant: "" }, /--tenant must be/],
    ["a --tenant that is not a UUID", { tenant: "not-a-uuid" }, /--tenant must be/],
    ["no --user", { user: "" }, /--user is required/],
    ["no --sign-off", { "sign-off": "" }, /--sign-off is required/],
    ["no --data-class", { "data-class": "" }, /--data-class is required/],
    ["a --data-class that is neither", { "data-class": "demo" }, /--data-class is required/],
  ])("exit 2 with the usage for %s", async (_why, over, message) => {
    expect(await run(...provisionArgs(over))).toBe(2);
    expect(err.join("")).toMatch(message);
    expect(err.join("")).toContain("usage: import-key provision");
    expect(keys()).toHaveLength(0);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("import-key status", () => {
  it("says so when the tenant has no key, then lists the usable one", async () => {
    expect(await run("status", "--tenant", world.tenantA)).toBe(0);
    expect(out.join("")).toMatch(/has no live import key\./);

    await run(...provisionArgs());
    out.length = 0;
    expect(await run("status", "--tenant", world.tenantA)).toBe(0);
    expect(out.join("")).toMatch(/: cbk_[0-9a-f]{8}… \(calibration:write\), expires 2099-04-01/);
    expect(out.join("")).toMatch(/A usable import key exists\./);
  });

  it("says when a live key can no longer record (expired), and changes nothing", async () => {
    mdb.seed("ApiKey", { id: "a9000000-0000-4000-8000-0000000000e1", tenantId: world.tenantA, name: "upstream-import", keyPrefix: "cbk_expired1", keyHash: "e".repeat(64), scopes: ["calibration:write"], expiresAt: new Date("2000-01-01"), isActive: true, isDeleted: false });
    const before = JSON.stringify(mdb.rows("ApiKey"));
    expect(await run("status", "--tenant", world.tenantA)).toBe(0);
    expect(out.join("")).toMatch(/expires 2000-01-01/);
    expect(out.join("")).toMatch(/None of these can record any more/);
    expect(JSON.stringify(mdb.rows("ApiKey"))).toBe(before);
  });

  it("shows `never` for a key with no expiry", async () => {
    mdb.seed("ApiKey", { id: "a9000000-0000-4000-8000-0000000000e2", tenantId: world.tenantA, name: "upstream-import", keyPrefix: "cbk_noexpiry", keyHash: "n".repeat(64), scopes: ["calibration:write"], expiresAt: null, isActive: true, isDeleted: false });
    expect(await run("status", "--tenant", world.tenantA)).toBe(0);
    expect(out.join("")).toMatch(/expires never/);
  });

  it("does not show another tenant's key", async () => {
    await run(...provisionArgs({ tenant: world.tenantB, user: emailOf(world.other, world.tenantB) }));
    out.length = 0;
    expect(await run("status", "--tenant", world.tenantA)).toBe(0);
    expect(out.join("")).toMatch(/has no live import key\./);
  });

  it("exit 2 without --tenant", async () => {
    expect(await run("status")).toBe(2);
  });
});

describe("import-key revoke", () => {
  it("revokes the tenant's live keys as the operator (audited), leaves tenant B's, and passes the runbook check", async () => {
    await run(...provisionArgs());
    await run(...provisionArgs({ tenant: world.tenantB, user: emailOf(world.other, world.tenantB) }));
    out.length = 0;

    expect(await run("revoke", "--tenant", world.tenantA, "--user", emailOf(world.admin, world.tenantA))).toBe(0);
    expect(out.join("")).toMatch(/1 import key\(s\) of .* revoked by .*Runbook check \(no live import key\): ok\./);
    expect(audits("API_KEY_REVOKE")).toEqual([expect.objectContaining({ tenantId: world.tenantA, userId: world.admin.id })]);

    out.length = 0;
    await run("status", "--tenant", world.tenantA);
    expect(out.join("")).toMatch(/has no live import key\./);
    out.length = 0;
    await run("status", "--tenant", world.tenantB);
    expect(out.join("")).toMatch(/A usable import key exists\./);
  });

  it("with nothing to revoke it says 0 and the check is ok", async () => {
    expect(await run("revoke", "--tenant", world.tenantA, "--user", emailOf(world.admin, world.tenantA))).toBe(0);
    expect(out.join("")).toMatch(/0 import key\(s\) of .* revoked/);
  });

  it("refuses an operator of another tenant (exit 1) and revokes nothing", async () => {
    await run(...provisionArgs());
    expect(await run("revoke", "--tenant", world.tenantA, "--user", emailOf(world.other, world.tenantB))).toBe(1);
    expect(keys().every((k) => k["isActive"] === true)).toBe(true);
  });

  it("exit 2 without --user", async () => {
    expect(await run("revoke", "--tenant", world.tenantA)).toBe(2);
    expect(err.join("")).toMatch(/--user is required/);
  });

  it("reports FAILED and exits 1 if a live key remains after the revocation", async () => {
    await run(...provisionArgs());
    const service = jest.requireActual<typeof ApiKeyServiceModule>("../../services/apiKey.service");
    // The revocation silently does nothing: the check must not be fooled by the count of keys it tried.
    jest.spyOn(service, "revokeApiKey").mockResolvedValue(undefined as never);
    out.length = 0;
    expect(await run("revoke", "--tenant", world.tenantA, "--user", emailOf(world.admin, world.tenantA))).toBe(1);
    expect(out.join("")).toMatch(/Runbook check \(no live import key\): FAILED/);
    expect(err.join("")).toMatch(/Refused: A live import key remains/);
  });
});

describe("import-key — the subcommand and the dispatcher", () => {
  it.each([[[]], [["frobnicate"]], [["toString"]]])("%j is not a subcommand: exit 2 with the usage, nothing run", async (args) => {
    expect(await cli.main(args)).toBe(2);
    expect(err.join("")).toContain("usage: import-key provision");
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("a thrown non-Error is reported as its text", async () => {
    const service = jest.requireActual<typeof ImportKeyServiceModule>("../../services/upstreamImport/importKey");
    jest.spyOn(service, "importKeyStatus").mockRejectedValue("plain string");
    expect(await run("status", "--tenant", world.tenantA)).toBe(1);
    expect(err.join("")).toMatch(/Refused: plain string/);
  });

  it("readFlag: the value after the flag, or '' when the flag is absent or last", () => {
    expect(cli.readFlag(["--a", "1", "--b"], "a")).toBe("1");
    expect(cli.readFlag(["--a", "1", "--b"], "b")).toBe("");
    expect(cli.readFlag(["--a", "1"], "z")).toBe("");
  });

  it("the compiled binary recognises `import-key`, and `import-key` alone is a usage exit (2), not the server", async () => {
    expect(dispatch.cliCommandFrom(["node", "index.js", "import-key", "status"])).toBe("import-key");
    await expect(dispatch.runCliCommand(["node", "index.js", "import-key"])).resolves.toBe(2);
  });
});
