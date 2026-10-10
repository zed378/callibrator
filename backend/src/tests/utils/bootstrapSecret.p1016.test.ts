/**
 * P10-16 (ADR-099) — the one-time password generator and its file.
 *
 * The file is the ONLY place the plaintext is put (owner, 2026-09-29): 0600,
 * owner-only directory, created exclusively, removed on consumption. The
 * storage root is redirected to a temporary directory, so a developer's real
 * backend/.bootstrap file is never touched.
 *
 * TypeScript without jest's hoisting: the mock is registered first, then the
 * module under test is loaded with `jest.requireActual`.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type * as BootstrapSecret from "../../utils/bootstrapSecret.util";
import type * as NodeCrypto from "crypto";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "p1016-secret-"));

jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(ROOT, ...parts),
);

const secret = jest.requireActual<typeof BootstrapSecret>("../../utils/bootstrapSecret.util");
// The core modules themselves: `import * as` gives a copy whose properties a
// spy would replace without reaching the module under test.
const nodeFs = jest.requireActual<typeof fs>("fs");
const nodeCrypto = jest.requireActual<typeof NodeCrypto>("crypto");

const FILE = path.join(ROOT, ".bootstrap", "superadmin-password");

afterEach(() => {
  jest.restoreAllMocks();
  secret.removeBootstrapSecret();
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("generateBootstrapPassword", () => {
  const draws = Array.from({ length: 2000 }, () => secret.generateBootstrapPassword());

  it("is 24 characters (the owner asked for at least 20)", () => {
    expect(secret.BOOTSTRAP_PASSWORD_LENGTH).toBe(24);
    for (const p of draws) {
      expect(p).toHaveLength(24);
    }
  });

  it("uses only the unambiguous alphabet, never 0 O o 1 l I i", () => {
    const allowed = new Set(secret.ALPHABET);
    for (const p of draws) {
      for (const ch of p) {
        expect(allowed.has(ch)).toBe(true);
        expect(secret.AMBIGUOUS.includes(ch)).toBe(false);
      }
    }
    for (const ch of secret.AMBIGUOUS) {
      expect(secret.ALPHABET.includes(ch)).toBe(false);
    }
  });

  it("carries every class — upper, lower, digit, symbol — in every draw", () => {
    for (const p of draws) {
      for (const cls of secret.CLASSES) {
        expect(Array.from(p).some((ch) => cls.includes(ch))).toBe(true);
      }
    }
  });

  it("has at least 128 bits of entropy by construction (61-character alphabet × 24)", () => {
    expect(secret.ALPHABET).toHaveLength(61);
    expect(new Set(secret.ALPHABET).size).toBe(61);
    // 142 bits; the one-per-class constraint costs well under 3.
    expect(24 * Math.log2(61)).toBeGreaterThan(140);
  });

  it("does not repeat over 2000 draws, and does not always start with the forced classes", () => {
    expect(new Set(draws).size).toBe(draws.length);
    const firstIsUpper = draws.filter((p) => secret.CLASSES[0]?.includes(p.charAt(0))).length;
    expect(firstIsUpper).toBeLessThan(draws.length);
  });

  it("draws every character and the shuffle from crypto.randomInt", () => {
    const spy = jest.spyOn(nodeCrypto, "randomInt");
    secret.generateBootstrapPassword();
    // 24 picks + 23 shuffle swaps.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(24 + 23);
  });
});

describe("the secret file", () => {
  it("lives at storagePath('.bootstrap', 'superadmin-password')", () => {
    expect(secret.bootstrapSecretPath()).toBe(FILE);
  });

  it("holds exactly the password and a newline", () => {
    expect(secret.writeBootstrapSecret("Pw-Only-Value-123")).toBe(FILE);
    expect(fs.readFileSync(FILE, "utf8")).toBe("Pw-Only-Value-123\n");
    expect(secret.bootstrapSecretExists()).toBe(true);
  });

  it("is created exclusively with mode 0600 in a 0700 directory, then chmod 0600", () => {
    const mkdir = jest.spyOn(nodeFs, "mkdirSync");
    const write = jest.spyOn(nodeFs, "writeFileSync");
    const chmod = jest.spyOn(nodeFs, "chmodSync");
    secret.writeBootstrapSecret("x");
    expect(mkdir).toHaveBeenCalledWith(path.dirname(FILE), { recursive: true, mode: 0o700 });
    expect(write).toHaveBeenCalledWith(FILE, "x\n", { mode: 0o600, flag: "wx" });
    expect(chmod).toHaveBeenCalledWith(FILE, 0o600);
  });

  // One case per OS, never a skip (2026-10-10). POSIX: the modes the code asks for are on disk.
  // Windows has no POSIX permission bits: Node maps a mode only to the read-only attribute, so
  // 0600 (owner-writable) lands as a writable file that stats as 0666, and a directory stats as
  // 0666 too. There the owner-only protection is the storage directory's ACL, not the mode, and
  // what the code must still guarantee is that the file is NOT read-only, so a later write
  // replaces it and removal deletes it.
  it(`has the right mode on disk for ${process.platform === "win32" ? "Windows (writable, no POSIX bits)" : "POSIX (0600 in 0700)"}`, () => {
    secret.writeBootstrapSecret("x");
    if (process.platform === "win32") {
      expect(fs.statSync(FILE).mode & 0o777).toBe(0o666);
      expect(fs.statSync(path.dirname(FILE)).mode & 0o777).toBe(0o666);
    } else {
      expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(FILE)).mode & 0o777).toBe(0o700);
    }
  });

  it("replaces an earlier file rather than refusing or appending", () => {
    secret.writeBootstrapSecret("first");
    secret.writeBootstrapSecret("second");
    expect(fs.readFileSync(FILE, "utf8")).toBe("second\n");
  });

  it("is removed, and removing a missing one is not an error", () => {
    secret.writeBootstrapSecret("x");
    expect(secret.removeBootstrapSecret()).toBe(true);
    expect(fs.existsSync(FILE)).toBe(false);
    expect(secret.bootstrapSecretExists()).toBe(false);
    expect(secret.removeBootstrapSecret()).toBe(false);
  });

  it("does not swallow an unlink error other than ENOENT", () => {
    jest.spyOn(nodeFs, "unlinkSync").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    expect(() => secret.removeBootstrapSecret()).toThrow("denied");
  });

  it("the pointer names the path and the command, never a value", () => {
    const line = secret.bootstrapPointer("sys@mail.com", FILE);
    expect(line).toContain(FILE);
    expect(line).toContain("docker exec");
    expect(line).toContain("sys@mail.com");
    expect(line).toContain(os.hostname());
  });
});
