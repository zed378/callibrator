/**
 * P21-09d — G-20 (spec P19-04 § 9.2; AM-18, F-3, FT-62): no cache key shares tenant DATA across
 * facilities.
 *
 * Every file in services/ that builds a Redis key (`redis.get/set/del(` or a `cacheKeys.*` builder)
 * is on the reviewed list below, classified:
 *
 *  - `facility-scoped` — caches figures over facility-scoped rows; its key MUST take the facility
 *    scope from the context (the dashboard: `…:all:` vs `…:f:<id>:`, tests/services/
 *    dashboardCache.twoFacility);
 *  - `not-facility-data` — caches something that is not facility rows (roles are global and the
 *    permission caches hold no bound-ness, FT-62; a session or a login challenge is one principal's;
 *    a tenant row is the tenant's own) — with the reason.
 *
 * A new file caching anything fails here until it is classified. The bite case plants one.
 */
import fs from "fs";
import path from "path";

const SERVICES = path.join(__dirname, "../../services");

type Kind = "facility-scoped" | "not-facility-data";
const REVIEWED: Readonly<Record<string, { kind: Kind; reason: string }>> = {
  "dashboardCache.service.ts": { kind: "facility-scoped", reason: "the dashboard's tenant figures: `dashboardCacheKey` appends `facilityScopeSegment()` from the context" },
  "admin.service.ts": { kind: "not-facility-data", reason: "the tenant row by id / code (tenant-level settings, no facility rows)" },
  "tenant.service.ts": { kind: "not-facility-data", reason: "the tenant row and its settings (tenant-level, no facility rows)" },
  "auth.service.ts": { kind: "not-facility-data", reason: "one user's row for sign-in and its session list (the principal's own)" },
  "menuGroup.service.ts": { kind: "not-facility-data", reason: "a ROLE's permission matrix: roles are global; bound-ness is applied after the cache (FT-62)" },
  "roles.service.ts": { kind: "not-facility-data", reason: "a ROLE's permission matrix (global); the ceiling is applied after the cache (FT-62)" },
  "userPermission.service.ts": { kind: "not-facility-data", reason: "one user's override matrix; the binding operation clears it (spec § 10.1)" },
  "userFacilityBinding.service.ts": { kind: "not-facility-data", reason: "clears one user's permission cache after a binding change" },
  "session.service.ts": { kind: "not-facility-data", reason: "one session's liveness, by session id" },
  "oidcProvider.service.ts": { kind: "not-facility-data", reason: "an authorization code / consent of one principal" },
  "passkeyLogin.service.ts": { kind: "not-facility-data", reason: "a WebAuthn login challenge (pre-auth)" },
  "webauthn.service.ts": { kind: "not-facility-data", reason: "a WebAuthn registration challenge of one user" },
  "rabbitmq.service.ts": { kind: "not-facility-data", reason: "a job-queue bookkeeping key, no tenant data" },
};

const KEY_USE = /\bredis\.(?:get|set|setex|del|delPattern|incr)\(|\bcacheKeys\.[A-Za-z]+/;

const cachingFiles = (dir: string, base = dir): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {return cachingFiles(full, base);}
    if (!e.name.endsWith(".ts") || e.name.endsWith(".d.ts") || e.name === "redis.service.ts") {return [];}
    return KEY_USE.test(fs.readFileSync(full, "utf8")) ? [path.relative(base, full).split(path.sep).join("/")] : [];
  });

const unclassified = (found: readonly string[]): string[] => found.filter((f) => !Object.hasOwn(REVIEWED, f));

describe("G-20 — cache keys and the facility dimension", () => {
  const found = cachingFiles(SERVICES);

  it("every service that builds a Redis key is classified", () => {
    expect(unclassified(found)).toEqual([]);
  });

  it("every classified file still caches (the list only holds what exists)", () => {
    expect(Object.keys(REVIEWED).filter((f) => !found.includes(f))).toEqual([]);
  });

  it("every facility-scoped cache takes the scope from the context", () => {
    for (const [file, entry] of Object.entries(REVIEWED)) {
      if (entry.kind !== "facility-scoped") {continue;}
      const text = fs.readFileSync(path.join(SERVICES, file), "utf8");
      expect({ file, scoped: text.includes("tenantStorage.getStore()") && text.includes("facilityScopeSegment()") }).toEqual({ file, scoped: true });
    }
  });

  it("bites (fail-before): a new caching service is unclassified", () => {
    expect(unclassified([...found, "deviceStats.service.ts"])).toEqual(["deviceStats.service.ts"]);
  });
});
