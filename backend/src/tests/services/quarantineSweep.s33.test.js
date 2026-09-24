/**
 * S-33 — the quarantine sweep removes only regular files older than
 * QUARANTINE_MAX_AGE_MINUTES from uploads/.quarantine; it never follows a
 * sub-directory or a symbolic link, and a missing quarantine is not an error.
 * Real files in a temporary directory.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "s33-"));
jest.mock("../../utils/upload.util", () => ({
  quarantinePath: (...parts) => require("path").join(mockRoot, ".quarantine", ...parts),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require("../../middlewares/activityLog.middleware");
const { sweepQuarantine, DEFAULT_MAX_AGE_MINUTES } = require("../../services/quarantineSweep.service");

const q = (...parts) => path.join(mockRoot, ".quarantine", ...parts);
const age = (file, minutes) => {
  const t = new Date(Date.now() - minutes * 60 * 1000);
  fs.utimesSync(file, t, t);
};

describe("S-33 quarantine sweep", () => {
  beforeEach(() => {
    fs.rmSync(q(), { recursive: true, force: true });
    delete process.env.QUARANTINE_MAX_AGE_MINUTES;
  });

  afterAll(() => fs.rmSync(mockRoot, { recursive: true, force: true }));

  it("a missing quarantine directory is nothing to do", async () => {
    expect(await sweepQuarantine()).toEqual({ scanned: 0, removed: 0, errors: 0 });
  });

  it("removes files abandoned longer than the default hour, keeps in-flight ones", async () => {
    fs.mkdirSync(q(), { recursive: true });
    fs.writeFileSync(q("abandoned.pdf"), "x");
    age(q("abandoned.pdf"), DEFAULT_MAX_AGE_MINUTES + 5);
    fs.writeFileSync(q("in-flight.pdf"), "x");

    expect(await sweepQuarantine()).toEqual({ scanned: 2, removed: 1, errors: 0 });
    expect(fs.existsSync(q("abandoned.pdf"))).toBe(false);
    expect(fs.existsSync(q("in-flight.pdf"))).toBe(true);
  });

  it("never descends into a directory or follows a symlink", async () => {
    fs.mkdirSync(q("sub"), { recursive: true });
    fs.writeFileSync(q("sub", "old.pdf"), "x");
    age(q("sub", "old.pdf"), 600);
    const outside = path.join(mockRoot, "outside.txt");
    fs.writeFileSync(outside, "keep");
    age(outside, 600);
    fs.symlinkSync(outside, q("link"));

    expect(await sweepQuarantine()).toEqual({ scanned: 0, removed: 0, errors: 0 });
    expect(fs.existsSync(q("sub", "old.pdf"))).toBe(true);
    expect(fs.readFileSync(outside, "utf8")).toBe("keep");
  });

  it("honours QUARANTINE_MAX_AGE_MINUTES and ignores an invalid value", async () => {
    fs.mkdirSync(q(), { recursive: true });
    fs.writeFileSync(q("ten-min.pdf"), "x");
    age(q("ten-min.pdf"), 10);
    process.env.QUARANTINE_MAX_AGE_MINUTES = "nonsense";
    expect((await sweepQuarantine()).removed).toBe(0);
    process.env.QUARANTINE_MAX_AGE_MINUTES = "5";
    expect((await sweepQuarantine()).removed).toBe(1);
  });

  it("counts and logs a file it cannot remove; a file that vanished meanwhile is not an error", async () => {
    fs.mkdirSync(q(), { recursive: true });
    fs.writeFileSync(q("a.pdf"), "x");
    fs.writeFileSync(q("b.pdf"), "x");
    age(q("a.pdf"), 600);
    age(q("b.pdf"), 600);
    const unlink = jest.spyOn(fs.promises, "unlink");
    unlink.mockImplementationOnce(async () => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    });
    unlink.mockImplementationOnce(async () => {
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    });

    expect(await sweepQuarantine()).toEqual({ scanned: 2, removed: 0, errors: 1 });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("EACCES"));
  });

  it("an unreadable quarantine directory throws, so the run is a failure", async () => {
    fs.mkdirSync(path.dirname(q()), { recursive: true });
    fs.writeFileSync(q(), "a file where the directory should be");
    await expect(sweepQuarantine()).rejects.toThrow(/ENOTDIR/);
  });
});
