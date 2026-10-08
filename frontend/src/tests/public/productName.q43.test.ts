/**
 * Q-43 (ADR-098 §8.1) — "Device Calibrator" on every user-visible surface.
 *
 * The copy-truthfulness guard (copyTruthfulness.p1011) covers the PUBLIC pages.
 * This one covers the rest of what a user sees the product called: the
 * dashboard chrome (sidebar, top bar, layouts), every page under app/ and
 * every component, the dictionaries, the branding hooks and constants, the
 * certificate PDF's metadata, and the backend's user-facing names (the TOTP
 * issuer an authenticator app shows, the passkey prompt's relying-party name,
 * the GDPR export's controller line).
 *
 * "Callibrator" stays the CODENAME (repository, package, identifiers,
 * comments): comments are stripped before the scan, and lower-case identifiers
 * (`callibrator-…` keys) are not matched. "HDC" and "Hospital Device
 * Callibrator" are not used anywhere a person reads.
 */
import fs from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../..");
const BACKEND = path.resolve(SRC, "../../backend/src");

/** User-visible product-name forms Q-43 retired, and why. */
const RETIRED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bHDC\b/, why: "Q-43: \"HDC\" is not used" },
  { pattern: /Hospital Device Callibrator|Hospital Device Calibration Platform/i, why: "Q-43: the product is \"Device Calibrator\"" },
  { pattern: /\bCallibrator\b/, why: "Q-43: \"Callibrator\" is the codename only, never a name a user reads" },
];

/** Strip block and line comments (a line comment only where `//` is not part of a URL). */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "generated" ? [] : walk(full);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });

const FRONTEND_FILES = [
  ...walk(path.join(SRC, "app")),
  ...walk(path.join(SRC, "components")),
  ...walk(path.join(SRC, "i18n")),
  path.join(SRC, "constants/index.ts"),
  path.join(SRC, "hooks/useTenantBranding.ts"),
  path.join(SRC, "hooks/useAuthBrand.ts"),
  path.join(SRC, "lib/certificatePdf.ts"),
];
const BACKEND_FILES = ["services/mfa.service.ts", "services/webauthn.service.ts", "services/gdpr.service.ts"].map((f) => path.join(BACKEND, f));

const findings = (files: readonly string[]): string[] =>
  files.flatMap((file) => {
    const text = withoutComments(fs.readFileSync(file, "utf8"));
    return RETIRED.filter((r) => r.pattern.test(text)).map(
      (r) => `${path.relative(path.resolve(SRC, "../.."), file)}: ${String(r.pattern)} — ${r.why}`,
    );
  });

describe("Q-43 — the product name a user reads is \"Device Calibrator\"", () => {
  it("scanned the dashboard chrome and the rest of the app (a scan that finds nothing has not passed)", () => {
    const rel = FRONTEND_FILES.map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(rel).toEqual(expect.arrayContaining(["components/layouts/Sidebar.tsx", "components/layouts/TopBar.tsx", "app/(app)/dashboard/layout.tsx"]));
    expect(FRONTEND_FILES.length).toBeGreaterThan(100);
  });

  it("no retired name in the frontend's user-visible sources", () => {
    expect(findings(FRONTEND_FILES)).toEqual([]);
  });

  it("no retired name in the backend's user-facing names (TOTP issuer, passkey RP name, GDPR controller)", () => {
    expect(findings(BACKEND_FILES)).toEqual([]);
  });

  it("the sidebar names the product, and is not a second <h1> (ADR-090: one per page, in <main>)", () => {
    const sidebar = withoutComments(fs.readFileSync(path.join(SRC, "components/layouts/Sidebar.tsx"), "utf8"));
    expect(sidebar).toContain("Device Calibrator");
    expect(sidebar).not.toMatch(/<h1\b/);
  });

  it("the patterns catch what they must and spare the codename in comments and identifiers", () => {
    expect(RETIRED.some((r) => r.pattern.test("<h1>HDC</h1>"))).toBe(true);
    expect(RETIRED.some((r) => r.pattern.test('appName: "Hospital Device Callibrator"'))).toBe(true);
    expect(RETIRED.some((r) => r.pattern.test('const TOTP_ISSUER = "Callibrator";'))).toBe(true);
    expect(RETIRED.some((r) => r.pattern.test(withoutComments("// Callibrator codename\nconst k = \"callibrator-theme\";")))).toBe(false);
  });
});
