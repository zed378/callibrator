/**
 * A-257 — the project is pinned to one Node major, and every place that names
 * a Node version agrees with it.
 *
 * The source of truth is the repository root .nvmrc. The jest globalSetup
 * (src/tests/setup/nodeMajor.globalSetup.js) refuses to run the suite on any
 * other major; this file proves that check and keeps the other pins in step:
 * the `engines` of the three manifests, both Dockerfiles' base image, CI's
 * NODE_VERSION, and the pkg binary targets.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface NodeMajorSetup {
    checkNodeMajor: (version?: string, required?: number) => void;
    requiredNodeMajor: (file?: string) => number;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the globalSetup is a .js tool file outside the converted set
const { checkNodeMajor, requiredNodeMajor } = require("../setup/nodeMajor.globalSetup") as NodeMajorSetup;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as above
const globalSetup = require("../setup/nodeMajor.globalSetup") as () => Promise<void>;

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel: string): Record<string, unknown> => JSON.parse(read(rel)) as Record<string, unknown>;

const MAJOR = requiredNodeMajor();

describe("A-257: Node major pin", () => {
  describe("the jest globalSetup check", () => {
    it("the root .nvmrc pins Node 26 (ADR-076)", () => {
      expect(MAJOR).toBe(26);
    });

    it("refuses Node 24 and Node 22 with a message that names the required major and the fix", () => {
      expect(() => { checkNodeMajor("24.18.0", 26); }).toThrow(
        /A-257: the backend tests need Node 26 .*this is Node 24\.18\.0.*nvm use/s,
      );
      expect(() => { checkNodeMajor("22.11.0", 26); }).toThrow(/need Node 26/);
    });

    it("refuses a newer major too (Node 27), and a v-prefixed version", () => {
      expect(() => { checkNodeMajor("27.0.0", 26); }).toThrow(/need Node 26/);
      expect(() => { checkNodeMajor("v25.0.0", 26); }).toThrow(/this is Node v25\.0\.0/);
    });

    it("accepts any minor and patch of the pinned major", () => {
      expect(() => { checkNodeMajor("26.0.0", 26); }).not.toThrow();
      expect(() => { checkNodeMajor("26.10.0", 26); }).not.toThrow();
      expect(() => { checkNodeMajor("v26.8.1", 26); }).not.toThrow();
    });

    it("defaults to this process's version and the .nvmrc pin (this run is on the pinned major)", async () => {
      expect(() => { checkNodeMajor(); }).not.toThrow();
      await expect(globalSetup()).resolves.toBeUndefined();
    });

    it("refuses an .nvmrc that names no major", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a257-"));
      const file = path.join(dir, ".nvmrc");
      fs.writeFileSync(file, "lts/*\n");
      try {
        expect(() => requiredNodeMajor(file)).toThrow(/does not name a Node major version: "lts\/\*"/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("is registered as the backend jest globalSetup", () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the jest config is a CommonJS tool file outside src/
      const config = require(path.join(ROOT, "backend/jest.config.js")) as { globalSetup: string };
      expect(config.globalSetup).toBe("<rootDir>/src/tests/setup/nodeMajor.globalSetup.js");
    });
  });

  describe("every other pin agrees with .nvmrc", () => {
    it.each(["package.json", "backend/package.json", "frontend/package.json"])(
      "%s declares engines.node as exactly the pinned major",
      (manifest) => {
        expect((json(manifest)["engines"] as { node?: string } | undefined)?.node).toBe(`>=${String(MAJOR)} <${String(MAJOR + 1)}`);
      },
    );

    it.each(["backend/Dockerfile", "frontend/Dockerfile"])(
      "%s builds every node stage on the pinned major",
      (dockerfile) => {
        const froms = [...read(dockerfile).matchAll(/^FROM\s+node:(\d+)[.-]/gm)].map((m) =>
          Number(m[1]),
        );
        expect(froms.length).toBeGreaterThan(0);
        expect(froms.every((major) => major === MAJOR)).toBe(true);
      },
    );

    it("CI's NODE_VERSION is on the pinned major, and every setup-node step uses it", () => {
      const ci = read(".github/workflows/ci.yml");
      const version = /^\s*NODE_VERSION:\s*"?(\d+)[.\d]*"?/m.exec(ci);
      expect(version && Number(version[1])).toBe(MAJOR);
      const nodeVersions = [...ci.matchAll(/node-version:\s*(.+)$/gm)].map((m) => (m[1] ?? "").trim());
      expect(nodeVersions.length).toBeGreaterThan(0);
      expect(nodeVersions.every((v) => v === "${{ env.NODE_VERSION }}")).toBe(true);
    });

    it("the pkg binary targets the pinned major", () => {
      const targets = (json("backend/package.json")["pkg"] as { targets: string[] }).targets;
      expect(targets.length).toBeGreaterThan(0);
      expect(targets.every((t) => t.startsWith(`node${String(MAJOR)}-`))).toBe(true);
    });
  });
});
