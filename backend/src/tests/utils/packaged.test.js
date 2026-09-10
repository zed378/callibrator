/**
 * Tests for packaged.util — compiled-binary detection across pkg and bun.
 */

describe("packaged.util", () => {
  const origPkg = process.pkg;
  const origExec = process.execPath;
  const origBun = global.Bun;

  const load = () => {
    jest.resetModules();
    return require("../../utils/packaged.util").isPackaged;
  };

  afterEach(() => {
    if (origPkg === undefined) {
      delete process.pkg;
    } else {
      process.pkg = origPkg;
    }
    process.execPath = origExec;
    if (origBun === undefined) {
      delete global.Bun;
    } else {
      global.Bun = origBun;
    }
    jest.resetModules();
  });

  it("is packaged when process.pkg is set (Vercel/@yao-pkg)", () => {
    process.pkg = {};
    delete global.Bun;
    process.execPath = "/usr/bin/node";
    expect(load()).toBe(true);
  });

  it("is not packaged under plain node dev", () => {
    delete process.pkg;
    delete global.Bun;
    process.execPath = "/usr/bin/node";
    expect(load()).toBe(false);
  });

  it("is not packaged under `bun run` (launcher execPath)", () => {
    delete process.pkg;
    global.Bun = {};
    process.execPath = "/home/user/.bun/bin/bun";
    expect(load()).toBe(false);
  });

  it("is packaged as a bun-compiled binary (app execPath)", () => {
    delete process.pkg;
    global.Bun = {};
    process.execPath = "/app/boilerplate";
    expect(load()).toBe(true);
  });

  it("treats a windows node.exe launcher as not packaged", () => {
    delete process.pkg;
    global.Bun = {};
    process.execPath = "C:\\Program Files\\nodejs\\node.exe";
    expect(load()).toBe(false);
  });

  it("tolerates a missing execPath (falls back to empty string)", () => {
    delete process.pkg;
    global.Bun = {};
    process.execPath = "";
    expect(load()).toBe(true);
  });
});
