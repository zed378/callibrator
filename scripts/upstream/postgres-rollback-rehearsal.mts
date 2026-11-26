/** P30-02: pg_dump/pg_restore rollback proof using a clone of a synthetic rehearsal target. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const container = process.argv[2] ?? "";
if (!/^callibrator-p25-[0-9]+-postgres-1$/.test(container) || process.argv[3] !== "--synthetic-disposable") {
  throw new Error("Usage: node scripts/upstream/postgres-rollback-rehearsal.mts callibrator-p25-<digits>-postgres-1 --synthetic-disposable");
}
const docker = (args: string[], input?: Buffer): Buffer => execFileSync("docker", args, {
  input, maxBuffer: 256 * 1024 * 1024, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
});
const project = docker(["inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', container]).toString().trim();
assert.equal(container, project + "-postgres-1", "only the designated synthetic compose stack is accepted");
assert.match(project, /^callibrator-p25-[0-9]+$/);
const tag = Date.now() + "_" + randomBytes(4).toString("hex");
const source = "live_p30_source_" + tag;
const restored = "live_p30_restore_" + tag;
const created: string[] = [];
const sql = (database: string, statement: string): string => docker([
  "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "callibrator", "-d", database, "-At", "-c", statement,
]).toString().trim();
const dump = (database: string): Buffer => docker(["exec", container, "pg_dump", "-U", "callibrator", "-d", database, "-Fc"]);
const restore = (database: string, archive: Buffer): void => {
  docker(["exec", "-i", container, "pg_restore", "--exit-on-error", "-U", "callibrator", "-d", database], archive);
};
const counts = "SELECT json_build_object('tenants',(SELECT count(*) FROM public.tenants),'devices',(SELECT count(*) FROM public.calibration_devices),'sessions',(SELECT count(*) FROM public.inspection_sessions),'audit',(SELECT count(*) FROM public.audit_logs))::text";
const start = Date.now();
let backupBytes = 0;
try {
  for (const database of [source, restored]) {
    assert.match(database, /^live_p30_(source|restore)_[0-9]+_[a-f0-9]{8}$/);
    sql("postgres", 'CREATE DATABASE "' + database + '"');
    created.push(database);
  }
  // The running application DB is read only: dump it, then work exclusively in the clone.
  restore(source, dump("callibrator"));
  sql(source, "CREATE TABLE public.p30_before_import_probe(id integer PRIMARY KEY, quantity integer NOT NULL); INSERT INTO public.p30_before_import_probe VALUES (1,10),(2,12),(3,15)");
  const before = JSON.parse(sql(source, counts)) as Record<string, number>;
  assert.ok(before["devices"]! > 0 && before["sessions"]! > 0, "the source must contain the migrated synthetic application fixture");
  const backupStarted = Date.now();
  const backup = dump(source);
  backupBytes = backup.length;
  const backupMs = Date.now() - backupStarted;
  // Deliberate post-backup writes are made only to the owned clone, never the application target.
  sql(source, "UPDATE public.p30_before_import_probe SET quantity=999; CREATE TABLE public.p30_after_import_probe(id integer PRIMARY KEY); INSERT INTO public.p30_after_import_probe VALUES (9)");
  const restoreStarted = Date.now();
  restore(restored, backup);
  const restoreMs = Date.now() - restoreStarted;
  assert.equal(sql(restored, "SELECT count(*) || ':' || sum(quantity) || ':' || min(id) || ':' || max(id) FROM public.p30_before_import_probe"), "3:37:1:3");
  assert.equal(sql(restored, "SELECT to_regclass('public.p30_after_import_probe') IS NULL"), "t");
  assert.deepEqual(JSON.parse(sql(restored, counts)), before);
  assert.equal(sql(restored, "SELECT count(*) FROM pg_namespace WHERE nspname='upstream_import'"), "1");
  assert.equal(sql(restored, "SELECT count(*) FROM pg_roles WHERE rolname IN ('callibrator_app','callibrator_import','callibrator_transform')"), "3");
  assert.equal(sql(restored, "SET ROLE callibrator_app; SELECT count(*) FROM public.calibration_devices").split("\n").at(-1), String(before["devices"]));
  assert.equal(sql(restored, "SELECT to_regclass('upstream_import.id_map') IS NOT NULL"), "t");
  assert.throws(() => sql(restored, "SET ROLE callibrator_app; SELECT count(*) FROM upstream_import.id_map"), "restored staging must remain inaccessible to the application role");
  console.log(JSON.stringify({ kind: "p30-postgres-rollback-synthetic-v1", pass: true, backupBytes, backupMs, restoreMs, totalMs: Date.now() - start, counts: before, independentProbe: { rows: 3, sum: 37, min: 1, max: 3 }, postBackupTableAbsent: true }));
} finally {
  for (const database of created.reverse()) {
    assert.match(database, /^live_p30_(source|restore)_[0-9]+_[a-f0-9]{8}$/);
    sql("postgres", 'DROP DATABASE "' + database + '" WITH (FORCE)');
  }
}
