/**
 * A-332 — the image build context is declared in ONE compose file.
 * ADR-123 — the deployable compose path PULLS the published images.
 *
 * `deploy/compose/docker-compose.dev.yml` and `docker-compose.vm.yml` used to
 * restate `build.context: ../..`. An overlay's value wins, so a build that
 * pointed the base file at another tree (a frozen snapshot, a release checkout)
 * was silently pointed back at the live working tree: an image claim could come
 * from an unintended tree, and on 2026-09-30 one did (the P9-12 baseline's first
 * snapshot builds).
 *
 * Since ADR-123 (2026-10-06) that one file is `docker-compose.build.yml`, the
 * overlay that builds from source (dev, E2E). It declares
 * `context: ${BUILD_CONTEXT:-../..}` for the backend, the frontend and the
 * backup image, and no other compose file declares a build context or a
 * Dockerfile. The base file and the vm, staging and prod overlays declare no
 * build at all: they pull `zed378/calibration-*` from Docker Hub, and the VM
 * deploys with `pull` + `up -d`. A local build is tagged `callibrator/*`, never
 * a registry name, so it can neither shadow a pulled image nor be pushed as one.
 * This guard reads every compose file under deploy/compose.
 */
import fs from "node:fs";
import path from "node:path";

const COMPOSE_DIR = path.join(__dirname, "..", "..", "..", "..", "deploy", "compose");
const BUILD_OVERLAY = "docker-compose.build.yml";
const files = fs.readdirSync(COMPOSE_DIR).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
const read = (file: string): string => fs.readFileSync(path.join(COMPOSE_DIR, file), "utf8");
const lines = (file: string): string[] => read(file).split(/\r?\n/);

describe("A-332 — one compose file declares the build context", () => {
  it("found the compose files (a scan that finds nothing is not a pass)", () => {
    expect(files).toContain("docker-compose.yml");
    expect(files).toContain(BUILD_OVERLAY);
    expect(files).toContain("docker-compose.vm.yml");
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it("no other compose file declares a build context or a Dockerfile", () => {
    const offenders = files
      .filter((f) => f !== BUILD_OVERLAY)
      .flatMap((f) =>
        lines(f)
          .map((line, i) => ({ f, line: i + 1, text: line }))
          .filter(({ text }) => /^\s+(context|dockerfile):/.test(text)),
      )
      .map(({ f, line, text }) => `${f}:${String(line)}: ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("the build overlay routes every build context through BUILD_CONTEXT", () => {
    const contexts = lines(BUILD_OVERLAY)
      .filter((line) => /^\s+context:/.test(line))
      .map((line) => line.trim());
    expect(contexts).toHaveLength(3);
    for (const context of contexts) {
      expect(context).toBe("context: ${BUILD_CONTEXT:-../..}");
    }
  });
});

describe("ADR-123 — the deployable path pulls, and a local build never takes a registry name", () => {
  it("the base file and the vm, staging and prod overlays declare no build", () => {
    const pullOnly = ["docker-compose.yml", "docker-compose.vm.yml", "docker-compose.staging.yml", "docker-compose.prod.yml"];
    const offenders = pullOnly.flatMap((f) =>
      lines(f)
        .map((text, i) => ({ f, line: i + 1, text }))
        // `build: !reset null` (prod) REMOVES a build; anything else declares one.
        .filter(({ text }) => /^\s+build:/.test(text) && !/build:\s*!reset\s+null/.test(text))
        .map(({ f: file, line, text }) => `${file}:${String(line)}: ${text.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the base file defaults the three application images to the Docker Hub repositories", () => {
    const base = read("docker-compose.yml");
    expect(base).toContain("image: ${BACKEND_IMAGE:-zed378/calibration-be}:${IMAGE_TAG:-latest}");
    expect(base).toContain("image: ${FRONTEND_IMAGE:-zed378/calibration-fe}:${IMAGE_TAG:-latest}");
    expect(base).toContain("image: ${BACKUP_IMAGE:-zed378/calibration-backup}:${IMAGE_TAG:-latest}");
  });

  it("the build overlay tags local builds callibrator/*, never a registry repository, and never pulls them", () => {
    const images = lines(BUILD_OVERLAY)
      .filter((line) => /^\s+image:/.test(line))
      .map((line) => line.trim());
    expect(images).toEqual([
      "image: callibrator/backend:${BUILD_TAG:-local}",
      "image: callibrator/frontend:${BUILD_TAG:-local}",
      "image: callibrator/backup-verify:${BUILD_TAG:-local}",
    ]);
    expect(lines(BUILD_OVERLAY).filter((line) => /^\s+pull_policy:\s*build\s*$/.test(line))).toHaveLength(3);
  });
});
