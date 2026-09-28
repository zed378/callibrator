/**
 * P6-02 — the REAL archiver, no mock: the API gdpr.service#createZipArchive
 * relies on.
 *
 * archiver 8 is an ES module with named classes and no default export.
 * gdpr.service called `archiver("zip", …)`, the v7 factory, so every GDPR
 * export on the live stack failed with "archiver is not a function" (500).
 * Every unit test of the service mocked archiver as a function and passed —
 * a mock proves the client, not the contract. This test pins the contract.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const JSZip = require("jszip");

describe("P6-02 — archiver's ZipArchive, as gdpr.service uses it", () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "p602-archiver-"));
    await fs.promises.mkdir(path.join(dir, "in"));
    await fs.promises.writeFile(path.join(dir, "in", "profile.json"), '{"id":"u-1"}');
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("has no default factory: the v7 call shape is gone", () => {
    const archiver = require("archiver");
    expect(typeof archiver).not.toBe("function");
    expect(typeof archiver.ZipArchive).toBe("function");
  });

  it("new ZipArchive(...) zips a directory, readable back", async () => {
    const { ZipArchive } = require("archiver");
    const zipPath = path.join(dir, "out.zip");
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      archive.on("error", reject);
      output.on("close", resolve);
      archive.pipe(output);
      archive.directory(path.join(dir, "in"), false);
      archive.finalize();
    });

    const zip = await JSZip.loadAsync(await fs.promises.readFile(zipPath));
    expect(Object.keys(zip.files)).toEqual(["profile.json"]);
    expect(await zip.file("profile.json").async("string")).toBe('{"id":"u-1"}');
  });
});
