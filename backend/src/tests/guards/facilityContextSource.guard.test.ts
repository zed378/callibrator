/**
 * P21-09 — G-16 of docs/SECURITY/15 § 11 (spec MEMORY/specs/P19-04-client-facilities.md § 7.1;
 * AM-2): the facility context has ONE writer per entry path, and it is derived from the loaded
 * row only.
 *
 *  1. `tenantStorage.run(` is called only by the four known context writers: the HTTP request
 *     (tenantContext.middleware), the socket (config/socket — its handler wrapper runs the
 *     context its handshake built), jobs (utils/jobContext) and the super admin's home-tenant
 *     context (denyPlatformAuthoring — never a bound principal). A fifth is a new entry path
 *     that must be reviewed for the facility fields.
 *  2. Only tenantContext.middleware (`facilityContextOf`) and config/socket (which spreads it) name
 *     `facilityBound` outside the hooks and the services that READ it — no other module builds a
 *     context with a facility.
 *  3. No source reads a facility from request input: no `x-…facility…` header, and no
 *     `req.body/query/params.clientFacilityId` reaches a context.
 *
 * Fail-before: the `bites` case plants a fifth writer.
 */
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "../..");
const files = (): { rel: string; text: string }[] =>
  (fs.readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => path.join(SRC, f))
    .filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith(".d.ts"))
    .filter((f) => !f.includes(`${path.sep}tests${path.sep}`))
    .map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") }));

const WRITERS = ["config/socket.ts", "middlewares/denyPlatformAuthoring.middleware.ts", "middlewares/tenantContext.middleware.ts", "utils/jobContext.util.ts"];
/** The modules that may name `facilityBound`: the writer, the socket, and the readers. */
const FACILITY_BOUND_NAMERS = [
  "config/socket.ts",
  "middlewares/facilityRouteGate.middleware.ts",
  "middlewares/tenantContext.middleware.ts",
  "routes/api/auth.openapi.ts",
  // P21-09c (P18-03 § 13): `GET /menu-groups/my-permissions` answers `facilityBound` — a RESPONSE
  // field derived from the loaded user row (effectivePermission#isBound), never a context.
  "routes/api/menuGroups.openapi.ts",
  "services/menuGroup.service.ts",
  "services/auth.service.ts",
  "services/calibrationDevices.service.ts",
  "services/clientFacilityAdmin.service.ts",
  "services/userFacilityBinding.service.ts",
  "utils/tenantScope.util.ts",
  // P21-09d / e: read the context's flag (the raw-SQL clause, the cache key, the signed-link issuer,
  // the move's unbound check, the display redaction, the bound upload gate) — never build one.
  "middlewares/boundUploadGate.middleware.ts",
  "services/user.service.ts",
  "services/attachment.service.ts",
  "services/dashboardCache.service.ts",
  "services/deviceMove.service.ts",
  "services/personDisplay.service.ts",
  "utils/facilityPredicate.util.ts",
  // P21-03: the IPM discard reads the flag (an administrator's discard is unbound only).
  "services/ipmSession.service.ts",
  // P21-04: the void (unbound administrators only) and the countersignature (an unbound IPSRS only for the self facility).
  "services/ipmSignature.service.ts",
  "services/ipmSubmit.service.ts",
  // P21-02a: the contract chosen by the principal's binding (validateScoped) and the device reads'
  // provider-only keys (deviceReads#viewerIsBound) — both read the flag, never build a context.
  "middlewares/validation.middleware.ts",
  "services/deviceReads.service.ts",
  // P21-06: the recap facts name the facility for provider staff only (calibrationRecap#recapFacts).
  "services/calibrationRecap.service.ts",
];
/** The readers among them: they read the context's flag and never build one. */
const READERS = [
  "middlewares/facilityRouteGate.middleware.ts",
  "services/calibrationDevices.service.ts",
  "services/clientFacilityAdmin.service.ts",
  "services/userFacilityBinding.service.ts",
  "utils/tenantScope.util.ts",
  "middlewares/boundUploadGate.middleware.ts",
  "services/user.service.ts",
  "services/attachment.service.ts",
  "services/dashboardCache.service.ts",
  "services/deviceMove.service.ts",
  "services/personDisplay.service.ts",
  "utils/facilityPredicate.util.ts",
  "services/ipmSession.service.ts",
  "services/ipmSignature.service.ts",
  "services/ipmSubmit.service.ts",
  "middlewares/validation.middleware.ts",
  "services/deviceReads.service.ts",
  "services/calibrationRecap.service.ts",
];

const writersIn = (sources: { rel: string; text: string }[]): string[] =>
  sources.filter((s) => s.text.includes("tenantStorage.run(")).map((s) => s.rel).sort();

describe("G-16 — the facility context's writers", () => {
  const sources = files();

  it("tenantStorage.run is called only by the four reviewed entry paths", () => {
    expect(writersIn(sources)).toEqual(WRITERS);
  });

  it("only the writer and the socket build `facilityBound`; the rest only read it", () => {
    const namers = sources.filter((s) => /\bfacilityBound\b/.test(s.text)).map((s) => s.rel).sort();
    expect(namers.filter((n) => !FACILITY_BOUND_NAMERS.includes(n))).toEqual([]);
    // auth.service, menuGroup.service and their contracts name it as a RESPONSE field of "who am I" (from the user row), never a context.
    for (const reader of READERS) {
      const text = sources.find((s) => s.rel === reader)?.text ?? "";
      expect(text).not.toMatch(/facilityBound\s*:/);
    }
  });

  it("no source reads a facility from a header", () => {
    expect(sources.filter((s) => /headers\[["']x-[a-z-]*facility/i.test(s.text)).map((s) => s.rel)).toEqual([]);
  });

  it("bites: a fifth writer is found", () => {
    expect(writersIn([...sources, { rel: "services/rogue.service.ts", text: "tenantStorage.run({ tenantId, facilityBound: false }, fn)" }])).toContain(
      "services/rogue.service.ts",
    );
  });
});
