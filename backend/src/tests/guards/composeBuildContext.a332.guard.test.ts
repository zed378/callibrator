/**
 * A-332 — the image build context is declared in ONE compose file.
 *
 * `deploy/compose/docker-compose.dev.yml` and `docker-compose.vm.yml` used to
 * restate `build.context: ../..`. An overlay's value wins, so a build that
 * pointed the base file at another tree (a frozen snapshot, a release checkout)
 * was silently pointed back at the live working tree: an image claim could come
 * from an unintended tree, and on 2026-09-30 one did (the P9-12 baseline's first
 * snapshot builds).
 *
 * Now `docker-compose.yml` declares `context: ${BUILD_CONTEXT:-../..}` for the
 * backend and frontend, and no other compose file declares a build context or
 * a Dockerfile. This guard reads every compose file under deploy/compose.
 */
import fs from "node:fs";
import path from "node:path";

const COMPOSE_DIR = path.join(__dirname, "..", "..", "..", "..", "deploy", "compose");
const files = fs.readdirSync(COMPOSE_DIR).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
const read = (file: string): string => fs.readFileSync(path.join(COMPOSE_DIR, file), "utf8");

describe("A-332 — one compose file declares the build context", () => {
  it("found the compose files (a scan that finds nothing is not a pass)", () => {
    expect(files).toContain("docker-compose.yml");
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("no overlay declares a build context or a Dockerfile", () => {
    const offenders = files
      .filter((f) => f !== "docker-compose.yml")
      .flatMap((f) =>
        read(f)
          .split(/\r?\n/)
          .map((line, i) => ({ f, line: i + 1, text: line }))
          .filter(({ text }) => /^\s+(context|dockerfile):/.test(text)),
      )
      .map(({ f, line, text }) => `${f}:${String(line)}: ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("the base file routes every build context through BUILD_CONTEXT", () => {
    const contexts = read("docker-compose.yml")
      .split(/\r?\n/)
      .filter((line) => /^\s+context:/.test(line))
      .map((line) => line.trim());
    expect(contexts.length).toBeGreaterThanOrEqual(2);
    for (const context of contexts) {
      expect(context).toBe("context: ${BUILD_CONTEXT:-../..}");
    }
  });
});
