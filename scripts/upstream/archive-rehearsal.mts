/** P31-01: synthetic archive and logical database restore; never reads upstream data. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const archiveTool = process.env["SEVEN_ZIP"] ?? (process.platform === "win32" ? "C:/Program Files/7-Zip/7z.exe" : "7z");
const scratch = mkdtempSync(path.join(tmpdir(), "callibrator-p31-"));
const container = "callibrator-p31-" + randomBytes(6).toString("hex");
const password = randomBytes(32).toString("hex"); // Synthetic fixtures only; never an operational archive key.
const run = (command: string, args: string[], input?: string): string =>
  execFileSync(command, args, { input, encoding: "utf8", timeout: 120_000, stdio: ["pipe", "pipe", "pipe"] });
const docker = (...args: string[]): string => run("docker", args);
const sql = (query: string): string => run("docker", ["exec", "-i", container, "mariadb", "-h127.0.0.1", "-uroot", "--batch", "--skip-column-names"], query).trim();
const hash = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
let started = false;
let step = "start isolated MariaDB";

try {
  const source = path.join(scratch, "source");
  const restored = path.join(scratch, "restored");
  mkdirSync(source);
  const archive = path.join(scratch, "upstream.7z");
  docker("run", "-d", "--name", container, "--network", "none", "-e", "MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1", "mariadb:11.8");
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { sql("SELECT 1;"); ready = true; break; } catch { /* fresh disposable database starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "disposable MariaDB did not start");
  step = "create and dump synthetic database";
  sql("CREATE DATABASE upstream_fixture; USE upstream_fixture; CREATE TABLE inventory (id INT PRIMARY KEY, quantity INT NOT NULL); INSERT INTO inventory VALUES (1,7),(2,11),(3,19);");
  const dump = docker("exec", container, "mariadb-dump", "-h127.0.0.1", "-uroot", "--skip-comments", "upstream_fixture");
  writeFileSync(path.join(source, "database.sql"), dump);
  writeFileSync(path.join(source, "synthetic-photo.bin"), randomBytes(8192));
  writeFileSync(path.join(source, "certificate-evidence.txt"), "Synthetic certificate archive fixture; retain separately by controller schedule.\n");
  const files = ["database.sql", "synthetic-photo.bin", "certificate-evidence.txt"];
  const expected = Object.fromEntries(files.map((name) => [name, hash(path.join(source, name))]));
  writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ dataClass: "synthetic", sha256: expected }, null, 2));
  step = "create encrypted archive";
  run(archiveTool, ["a", "-t7z", "-mhe=on", "-p" + password, archive, path.join(source, "*")]);
  run(archiveTool, ["t", "-p" + password, archive]);
  step = "reject wrong key and corrupted archive";
  assert.throws(() => run(archiveTool, ["t", "-pwrong-synthetic-password", archive]), "wrong password must fail");
  assert.throws(() => run(archiveTool, ["l", "-pwrong-synthetic-password", archive]), "encrypted names must not be listed without the key");
  const damaged = path.join(scratch, "damaged.7z");
  const bytes = readFileSync(archive);
  bytes[Math.floor(bytes.length / 2)]! ^= 0xff;
  writeFileSync(damaged, bytes);
  assert.throws(() => run(archiveTool, ["t", "-p" + password, damaged]), "corrupted archive must fail");
  step = "extract and compare fixture hashes";
  run(archiveTool, ["x", "-y", "-p" + password, "-o" + restored, archive]);
  for (const name of files) assert.equal(hash(path.join(restored, name)), expected[name], "restored fixture hash differs");
  assert.equal(readFileSync(path.join(restored, "manifest.json"), "utf8"), readFileSync(path.join(source, "manifest.json"), "utf8"));
  step = "restore logical database and compare independent totals";
  sql("CREATE DATABASE restored_fixture;");
  run("docker", ["exec", "-i", container, "mariadb", "-h127.0.0.1", "-uroot", "restored_fixture"], readFileSync(path.join(restored, "database.sql"), "utf8"));
  assert.equal(sql("SELECT COUNT(*), SUM(quantity), MIN(id), MAX(id) FROM restored_fixture.inventory;"), "3\t37\t1\t3");
  process.stdout.write("P31-01 synthetic archive PASS: encryption, hidden names, wrong key, corruption, file hashes, MariaDB restore (3 rows; quantity 37).\n");
} catch (error) {
  // execFileSync errors include argv; do not print the generated archive password.
  process.stderr.write("P31-01 synthetic archive rehearsal failed at: " + step + "; no production data was touched. Check Docker, mariadb:11.8 and SEVEN_ZIP availability.\n");
  const detail = (error as { stderr?: Buffer | string }).stderr?.toString();
  if (detail) process.stderr.write(detail.replaceAll(password, "[synthetic-key]") + "\n");
  process.exitCode = 1;
} finally {
  if (started) docker("rm", "-f", "-v", container);
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()));
  assert.ok(path.basename(scratch).startsWith("callibrator-p31-"));
  if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
}
