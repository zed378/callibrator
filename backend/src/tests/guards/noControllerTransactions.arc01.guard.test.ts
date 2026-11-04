/**
 * ARC-01 (the 2026-11 audit) — a transaction opens in a service, never in a
 * controller.
 *
 * `session.controller` and `sso.controller` opened their own transactions,
 * which put the commit-or-roll-back of a revocation and its audit row (A-324),
 * or of a sign-in's session and its LOGIN row (A-60), in a layer that cannot be
 * tested without Express. They moved to `sessionAdmin.service` and
 * `ssoSession.service`. This guard fails when any controller under
 * src/controllers opens a transaction again.
 */
import fs from "fs";
import path from "path";

const CONTROLLERS = path.join(__dirname, "../../controllers");

/** Remove comments, so a sentence ABOUT a transaction is not one. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("ARC-01 — no controller opens a transaction", () => {
  const files = fs.readdirSync(CONTROLLERS).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));

  it("reads every controller (not vacuous)", () => {
    expect(files).toEqual(expect.arrayContaining(["session.controller.ts", "sso.controller.ts"]));
    expect(files.length).toBeGreaterThan(30);
  });

  it("no controller calls .transaction(", () => {
    const offenders = files.filter((f) => /\.transaction\s*\(/.test(code(fs.readFileSync(path.join(CONTROLLERS, f), "utf8"))));
    expect(offenders).toEqual([]);
  });
});
