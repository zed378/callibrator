/**
 * A-325 — the pkg base binary the image uses is pinned to what the installed
 * pkg-fetch expects, by tag, name AND sha256.
 *
 * backend/Dockerfile fetches the ~80 MB Node base binary in its own `pkg-base`
 * stage (retried, timed out, checksum-verified) and hands it to pkg through
 * PKG_CACHE_PATH, so a flaky download can no longer fail or stall the build.
 * The pins are ARG defaults in that stage. If a pkg-fetch upgrade moves the
 * release tag, the newest node26 it knows, or that binary's sha256, pkg would
 * miss the pre-fetched file and download again (the A-325 failure back), or the
 * checksum would stop matching. This guard makes the upgrade fail here instead.
 *
 * The expected values come from pkg-fetch itself: its version (the tag is
 * v<major>.<minor>, places.js#tagFromVersion), `satisfyingNodeVersion` for the
 * Dockerfile's own `--targets nodeNN-<platform>-<arch>`, and its
 * expected-shas.json.
 */
import fs from "node:fs";
import path from "node:path";

interface PkgFetch {
  satisfyingNodeVersion(range: string): string;
}

const DOCKERFILE = fs.readFileSync(path.join(__dirname, "..", "..", "..", "Dockerfile"), "utf8");
const PKG_FETCH_DIR = path.dirname(require.resolve("@yao-pkg/pkg-fetch/package.json"));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the installed pkg-fetch, read as data
const pkgFetch = require("@yao-pkg/pkg-fetch") as PkgFetch;
const pkgFetchVersion = (JSON.parse(fs.readFileSync(path.join(PKG_FETCH_DIR, "package.json"), "utf8")) as { version: string }).version;
const expectedShas = JSON.parse(fs.readFileSync(path.join(PKG_FETCH_DIR, "lib-es5", "expected-shas.json"), "utf8")) as Record<string, string>;

/** An ARG default in the pkg-base stage. */
const arg = (name: string): string => {
  const match = new RegExp(`^ARG ${name}=(\\S+)$`, "m").exec(DOCKERFILE);
  if (!match?.[1]) {
    throw new Error(`backend/Dockerfile declares no default for ARG ${name}`);
  }
  return match[1];
};

/** The `--targets nodeNN-<platform>-<arch>` the pkg step builds for. */
const target = (): { major: string; platform: string; arch: string } => {
  const match = /--targets node(\d+)-(\w+)-(\w+)/.exec(DOCKERFILE);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error("backend/Dockerfile's pkg step names no --targets nodeNN-<platform>-<arch>");
  }
  return { major: match[1], platform: match[2], arch: match[3] };
};

describe("A-325 — the pkg base binary is pinned to pkg-fetch's own expectation", () => {
  const { major, platform, arch } = target();
  const [mj, mn] = pkgFetchVersion.split(".");
  const tag = `v${String(mj)}.${String(mn)}`;
  const nodeVersion = pkgFetch.satisfyingNodeVersion(`v${major}`);
  const name = `node-${nodeVersion}-${platform}-${arch}`;

  it("the release tag is pkg-fetch's", () => {
    expect(arg("PKG_BASE_TAG")).toBe(tag);
  });

  it("the binary is the one pkg will ask for (newest known node for the target)", () => {
    expect(arg("PKG_BASE_NAME")).toBe(name);
  });

  it("the sha256 is the one pkg-fetch expects for that binary", () => {
    expect(expectedShas[name]).toMatch(/^[0-9a-f]{64}$/);
    expect(arg("PKG_BASE_SHA256")).toBe(expectedShas[name]);
  });

  it("the pkg step reads the pre-fetched cache, and the stage refuses a mismatch", () => {
    expect(DOCKERFILE).toMatch(/COPY --from=pkg-base \/pkg-cache (\S+)\nRUN PKG_CACHE_PATH=\1 npx --no-install pkg /);
    expect(DOCKERFILE).toContain("sha256sum -c -");
  });
});
