/**
 * P21-09e — G-08 (spec P19-04 § 17; threat model § 11): every facility-ACCESSIBLE route that names a
 * row by a path parameter has its two-facility test.
 *
 *  1. Each entry of FACILITY_ACCESSIBLE_ROUTES whose path has a `:param` is named by an
 *     `@two-facility <route file> <METHOD> <path>` marker in a test file that also asserts a 404 —
 *     or is a `selfParam` route (the gate refuses any id but the caller's own before the handler,
 *     id-independently: middlewares/facilityRouteIndex.parity), listed below with that reason.
 *  2. Every marker names a marked route (a marker on an unmarked route proves nothing: it is 403).
 *  3. A `boundGate` names a middleware that is in its route's chain (A-5's `boundUploadGate`).
 *
 * The bite cases plant an unmarked `:id` entry and a stale marker.
 */
import fs from "fs";
import path from "path";
import { loadRouteChains, type RouteChain } from "../fixtures/routeChains";
import { FACILITY_ACCESSIBLE_ROUTES, type FacilityAccessibleRoute } from "../../constants/facilityAccess";

const routes: RouteChain[] = loadRouteChains();
const TESTS = path.join(__dirname, "..");
const MARKER = /@two-facility\s+(\S+)\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/g;

type Entries = Readonly<Record<string, Readonly<Record<string, FacilityAccessibleRoute>>>>;

const testSources = (): { file: string; text: string }[] =>
  (fs.readdirSync(TESTS, { recursive: true }) as string[])
    .filter((f) => /\.test\.(ts|js)$/.test(f))
    .map((f) => ({ file: f.split(path.sep).join("/"), text: fs.readFileSync(path.join(TESTS, f), "utf8") }))
    .filter((t) => !t.file.endsWith("twoFacilityRoutes.guard.test.ts"));

const markersOf = (sources: readonly { file: string; text: string }[]): Map<string, string> => {
  const out = new Map<string, string>();
  for (const { file, text } of sources) {
    for (const m of text.matchAll(MARKER)) {
      if (text.includes("404")) {
        out.set(`${m[1] ?? ""} ${m[2] ?? ""} ${m[3] ?? ""}`, file);
      }
    }
  }
  return out;
};

/** The marked `:param` routes with neither a marker nor a selfParam. */
const uncovered = (entries: Entries, markers: ReadonlyMap<string, string>): string[] =>
  Object.entries(entries).flatMap(([file, keyed]) =>
    Object.entries(keyed)
      .filter(([key, entry]) => key.includes("/:") && entry.selfParam === undefined && !markers.has(`${file} ${key}`))
      .map(([key]) => `${file} ${key}`),
  );

/** Markers naming a route that is not marked facility-accessible. */
const stale = (entries: Entries, markers: ReadonlyMap<string, string>): string[] =>
  [...markers.keys()].filter((id) => {
    const [file, method, p] = id.split(" ");
    return !entries[file ?? ""]?.[`${method ?? ""} ${p ?? ""}`];
  });

const fnName = (fn: unknown): string => (typeof fn === "function" ? fn.name : "");

describe("G-08 — every marked :id route has its two-facility test", () => {
  const markers = markersOf(testSources());

  it("every marked route with a path parameter is covered by an @two-facility marker (or is a selfParam route)", () => {
    expect(uncovered(FACILITY_ACCESSIBLE_ROUTES, markers)).toEqual([]);
  });

  it("every @two-facility marker names a marked route", () => {
    expect(stale(FACILITY_ACCESSIBLE_ROUTES, markers)).toEqual([]);
  });

  it("every marked route exists in the mounted route table", () => {
    const keys = new Set(routes.map((r) => `${r.file} ${r.key}`));
    const missing = Object.entries(FACILITY_ACCESSIBLE_ROUTES).flatMap(([file, keyed]) =>
      Object.keys(keyed).filter((key) => !keys.has(`${file} ${key}`)).map((key) => `${file} ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it("a boundGate names a middleware in its route's chain", () => {
    for (const [file, keyed] of Object.entries(FACILITY_ACCESSIBLE_ROUTES)) {
      for (const [key, entry] of Object.entries(keyed)) {
        if (!entry.boundGate) {continue;}
        const route = routes.find((r) => r.file === file && r.key === key);
        expect({ route: `${file} ${key}`, inChain: Boolean(route?.chain.some((fn) => fnName(fn) === entry.boundGate)) }).toEqual({ route: `${file} ${key}`, inChain: true });
      }
    }
  });

  it("bites (fail-before): an unmarked-by-test :id entry and a stale marker are found", () => {
    const planted: Entries = { ...FACILITY_ACCESSIBLE_ROUTES, "api/vendor.route.ts": { "GET /:vendorId": { kind: "read", reason: "planted" } } };
    expect(uncovered(planted, markers)).toEqual(["api/vendor.route.ts GET /:vendorId"]);
    const withStale = new Map(markers).set("api/vendor.route.ts DELETE /:vendorId", "planted.test.ts");
    expect(stale(FACILITY_ACCESSIBLE_ROUTES, withStale)).toEqual(["api/vendor.route.ts DELETE /:vendorId"]);
  });
});
