/**
 * P6-02 (ADR-077) — every directory the packaged backend writes under its
 * storage root exists, owned by the app user, in the runtime image.
 *
 * The image runs as uid 997 under a root-owned /app. `storagePath("<dir>", …)`
 * (utils/storagePath.util.js) resolves under APP_STORAGE_PATH=/app, so a
 * top-level directory the Dockerfile does not create and chown cannot be
 * created at runtime: the first write fails EACCES. `exports` was missing, and
 * every POST /gdpr/export answered 500 on the live stack — filed until then as
 * an environment failure ("no provider configured").
 *
 * The directory list is read from the SOURCE (every `storagePath("<dir>"`
 * call outside the tests), not from the Dockerfile, so a new writer with no
 * directory fails here.
 */
const fs = require("fs");
const path = require("path");

const BACKEND = path.resolve(__dirname, "../../..");
const SRC = path.join(BACKEND, "src");

const sourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "tests" ? [] : sourceFiles(full);
    }
    return /\.(js|ts)$/.test(entry.name) ? [full] : [];
  });

const writtenRoots = () => {
  const roots = new Set();
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/storagePath\(\s*["'`]([A-Za-z0-9_.-]+)/g)) {
      roots.add(match[1]);
    }
  }
  return [...roots].sort();
};

/** The runtime stage's `RUN mkdir -p … && chown -R app:app …` instruction. */
const runtimeDirInstruction = () => {
  const dockerfile = fs.readFileSync(path.join(BACKEND, "Dockerfile"), "utf8").replace(/\\\r?\n/g, " ");
  const runtime = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
  const line = runtime.split(/\r?\n/).find((l) => /^RUN mkdir -p .*chown -R app:app/.test(l));
  if (!line) {
    throw new Error("no `RUN mkdir -p … && chown -R app:app …` in the runtime stage");
  }
  const [mkdirPart, chownPart] = line.split("&&");
  const words = (s) => s.trim().split(/\s+/).filter((w) => w.startsWith("/app/"));
  return { created: words(mkdirPart), owned: words(chownPart) };
};

describe("P6-02 — the runtime image creates every storagePath root", () => {
  it("finds the roots the backend writes (sanity: the scan is not empty)", () => {
    expect(writtenRoots()).toEqual(expect.arrayContaining(["exports", "uploads", "backup"]));
  });

  it.each(writtenRoots())("/app/%s is created and owned by the app user", (root) => {
    const { created, owned } = runtimeDirInstruction();
    const under = (list) => list.some((d) => d === `/app/${root}` || d.startsWith(`/app/${root}/`));

    expect(under(created)).toBe(true);
    expect(owned).toContain(`/app/${root}`);
  });
});
