/**
 * P24-06 — the staging writes (stagingLoader.ts) and the pipeline that drives
 * them (importPipeline.ts), against a recording double of the staging
 * connection: every statement bound, every identifier from the allow-list or
 * the identifier pattern, batches under PostgreSQL's parameter limit, the
 * run's rows replaced not added, per-table counts and reasons only, and every
 * failure reported by a code. The live suite (upstreamSqlImport.p2406.live)
 * runs the same code against PostgreSQL 18.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import type { Transaction } from "sequelize";
import { batchSize, beginStaging, insertRows, prepareTable, purgeRun, type StagingSession } from "../../../services/upstreamImport/stagingLoader";
import { ImportCancelled, ImportFailure, runPipeline, type PipelineProgress } from "../../../services/upstreamImport/importPipeline";
import { syntheticUpstreamDump } from "../../support/syntheticUpstreamDump";

interface Call {
  text: string;
  bind: readonly unknown[];
  transaction: unknown;
}

/** A staging connection double: records every statement, answers the catalogue reads. */
const fakeSession = (
  answers: { check?: object | null; tables?: string[]; columns?: Record<string, { name: string; type: string }[]>; failOn?: RegExp } = {},
): { session: StagingSession; calls: Call[] } => {
  const calls: Call[] = [];
  const transaction = { id: "tx" } as unknown as Transaction;
  const runner = {
    query: (text: string, options: { bind?: readonly unknown[]; transaction?: unknown }): Promise<unknown> => {
      calls.push({ text, bind: options.bind ?? [], transaction: options.transaction });
      if (answers.failOn?.test(text)) {
        const err = Object.assign(new Error("boom"), { name: "SequelizeDatabaseError", parent: { code: "22P02" } });
        return Promise.reject(err);
      }
      if (text.includes("current_user")) {
        return Promise.resolve(answers.check === null ? [] : [answers.check ?? { currentUser: "callibrator_import", superuser: false, canCreate: true }]);
      }
      if (text.includes("FROM pg_tables")) {
        return Promise.resolve((answers.tables ?? []).map((name) => ({ name })));
      }
      if (text.includes("FROM pg_attribute")) {
        const table = String((options.bind ?? [])[0]).split(".")[1] as string;
        return Promise.resolve(answers.columns?.[table] ?? []);
      }
      return Promise.resolve([]);
    },
  };
  return { session: { runner, transaction }, calls };
};

const tmp = (name: string, body: string | Buffer): string => {
  const file = path.join(os.tmpdir(), `p2406-${String(process.pid)}-${String(Date.now())}-${name}`);
  fs.writeFileSync(file, body);
  return file;
};

describe("P24-06 stagingLoader", () => {
  it("beginStaging takes the advisory lock and proves the role; any other role, a superuser, or no CREATE is refused", async () => {
    const good = fakeSession();
    await beginStaging(good.session, "callibrator_import");
    expect(good.calls[0]?.text).toContain("pg_advisory_xact_lock");
    expect(good.calls.every((c) => c.transaction === good.session.transaction)).toBe(true);
    for (const check of [
      { currentUser: "postgres", superuser: false, canCreate: true },
      { currentUser: "callibrator_import", superuser: true, canCreate: true },
      { currentUser: "callibrator_import", superuser: false, canCreate: false },
      null,
    ]) {
      await expect(beginStaging(fakeSession({ check }).session, "callibrator_import")).rejects.toThrow(/not the import role/);
    }
  });

  it("purgeRun deletes the run's rows from every staging table, bound", async () => {
    const { session, calls } = fakeSession({ tables: ["stg_users", "stg_mst_faskes"] });
    expect(await purgeRun(session, "run-1")).toEqual(["stg_users", "stg_mst_faskes"]);
    const deletes = calls.filter((c) => c.text.startsWith("DELETE"));
    expect(deletes.map((c) => [c.text, c.bind])).toEqual([
      ['DELETE FROM upstream_import."stg_users" WHERE import_run_id = $1', ["run-1"]],
      ['DELETE FROM upstream_import."stg_mst_faskes" WHERE import_run_id = $1', ["run-1"]],
    ]);
  });

  it("prepareTable creates the table, adds a missing column, and reports a changed type as schema_conflict", async () => {
    const created = fakeSession({ columns: { stg_t: [{ name: "a", type: "integer" }] } });
    expect(await prepareTable(created.session, "stg_t", [{ name: "a", type: "integer" }, { name: "b", type: "timestamp" }])).toBe("ok");
    expect(created.calls[0]?.text).toMatch(/CREATE TABLE IF NOT EXISTS upstream_import\."stg_t" \([\s\S]*"a" integer,[\s\S]*"b" timestamp,[\s\S]*PRIMARY KEY \(import_run_id, source_row_number\)/);
    expect(created.calls.map((c) => c.text)).toContain('ALTER TABLE upstream_import."stg_t" ADD COLUMN "b" timestamp');
    const conflict = fakeSession({ columns: { stg_t: [{ name: "a", type: "text" }] } });
    expect(await prepareTable(conflict.session, "stg_t", [{ name: "a", type: "integer" }])).toBe("schema_conflict");
    expect(conflict.calls.some((c) => c.text.startsWith("ALTER"))).toBe(false);
  });

  it("insertRows binds every value, in batches under PostgreSQL's parameter limit", async () => {
    expect(batchSize(0)).toBe(1000);
    expect(batchSize(100)).toBe(294);
    expect(batchSize(100_000)).toBe(1);
    const { session, calls } = fakeSession();
    const columns = Array.from({ length: 98 }, (_, i) => ({ name: `c${String(i)}`, type: "text" as const }));
    const rows = Array.from({ length: 700 }, (_, n) => ({ rowNumber: n + 1, values: columns.map((_, i) => (i === 0 ? null : `v${String(n)}`)) }));
    await insertRows(session, "stg_t", "run-1", columns, rows);
    expect(calls).toHaveLength(3); // 300 + 300 + 100 rows at 100 parameters a row
    expect(calls[0]?.bind).toHaveLength(300 * 100);
    expect(calls[0]?.bind.slice(0, 3)).toEqual(["run-1", 1, null]);
    expect(calls[2]?.text).toContain("($9901, $9902,");
    expect(calls.every((c) => !c.text.includes("v0"))).toBe(true);
  });
});

describe("P24-06 runPipeline", () => {
  const dump = syntheticUpstreamDump({ devices: 30, facilities: 4 });

  it("stages a dump: per-table counts and reasons, columns staged and excluded, rows bound in batches", async () => {
    const file = tmp("ok.sql", dump.sql);
    const { session, calls } = fakeSession();
    const result = await runPipeline({ filePath: file, compression: "none", maxUncompressedBytes: 1e9, session, runId: "r", onProgress: () => Promise.resolve(false) });
    fs.rmSync(file);
    expect(result.bytesRead).toBe(Buffer.byteLength(dump.sql));
    expect(result.uncompressedBytes).toBe(result.bytesRead);
    for (const [table, want] of Object.entries(dump.expected)) {
      expect({ table, ...result.tables[table] }).toMatchObject({ table, ...want });
    }
    expect(result.tables["users"]).toMatchObject({ columns: 7, excludedColumns: 10 });
    expect(calls.some((c) => c.text.includes("password_hash"))).toBe(false);
    expect(calls.some((c) => c.text.includes("stg_auth_logins"))).toBe(false);
    expect(result.summary.truncated).toBe(false);
  });

  it("reads gzip as it streams, counting the compressed bytes read", async () => {
    const zipped = gzipSync(Buffer.from(dump.sql));
    const file = tmp("ok.sql.gz", zipped);
    const result = await runPipeline({ filePath: file, compression: "gzip", maxUncompressedBytes: 1e9, session: fakeSession().session, runId: "r", onProgress: () => Promise.resolve(false) });
    fs.rmSync(file);
    expect(result.bytesRead).toBe(zipped.length);
    expect(result.uncompressedBytes).toBe(Buffer.byteLength(dump.sql));
    expect(result.tables["mst_faskes"]?.rowsLoaded).toBe(4);
  });

  it("flushes a table's rows when the dump moves on, when a batch fills, and past 8 MiB", async () => {
    const big = "z".repeat(3 * 1024 * 1024);
    const sql =
      "CREATE TABLE trx_catatan (id int, description text);CREATE TABLE trx_battery (id int);" +
      `INSERT INTO trx_catatan VALUES (1,'${big}'),(2,'${big}'),(3,'${big}'),(4,'x');INSERT INTO trx_battery VALUES (1);INSERT INTO trx_catatan VALUES (5,'y');` +
      `INSERT INTO trx_battery VALUES ${Array.from({ length: 1001 }, (_, i) => `(${String(i + 2)})`).join(",")};`;
    const file = tmp("flush.sql", sql);
    const { session, calls } = fakeSession();
    const result = await runPipeline({ filePath: file, compression: "none", maxUncompressedBytes: 1e9, session, runId: "r", onProgress: () => Promise.resolve(false) });
    fs.rmSync(file);
    const inserts = calls.filter((c) => c.text.startsWith("INSERT")).map((c) => [c.text.includes("trx_catatan") ? "catatan" : "battery", (c.bind.length / (c.text.includes("trx_catatan") ? 4 : 3))]);
    expect(inserts).toEqual([
      ["catatan", 3],
      ["catatan", 1],
      ["battery", 1],
      ["catatan", 1],
      ["battery", 1000],
      ["battery", 1],
    ]);
    expect(result.tables["trx_battery"]?.rowsLoaded).toBe(1002);
  });

  it("a table whose staging type changed is schema_conflict: its rows counted, not loaded", async () => {
    const file = tmp("conflict.sql", "CREATE TABLE mst_alat (id int, nama_alat varchar(9));INSERT INTO mst_alat VALUES (1,'a'),(2,'b');");
    const { session, calls } = fakeSession({ columns: { stg_mst_alat: [{ name: "id", type: "text" }] } });
    const result = await runPipeline({ filePath: file, compression: "none", maxUncompressedBytes: 1e9, session, runId: "r", onProgress: () => Promise.resolve(false) });
    fs.rmSync(file);
    expect(result.tables["mst_alat"]).toMatchObject({ reason: "schema_conflict", rowsLoaded: 0, rowsRejected: 2, rejections: { schema_conflict: 2 } });
    expect(calls.some((c) => c.text.startsWith("INSERT"))).toBe(false);
  });

  it("a staged table the parser refused keeps the parser's reason; a refused unstaged table keeps the policy's", async () => {
    const file = tmp("refused.sql", "CREATE TABLE mst_alat (a int, A int);INSERT INTO mst_alat VALUES (1,2);CREATE TABLE auth_tokens (x int, X int);INSERT INTO auth_tokens VALUES (1,2);");
    const result = await runPipeline({ filePath: file, compression: "none", maxUncompressedBytes: 1e9, session: fakeSession().session, runId: "r", onProgress: () => Promise.resolve(false) });
    fs.rmSync(file);
    expect(result.tables["mst_alat"]).toMatchObject({ staged: true, reason: "duplicate_column", rowsRejected: 1, rejections: { table_refused: 1 } });
    expect(result.tables["auth_tokens"]).toMatchObject({ staged: false, reason: "never_copied", rowsNotExtracted: 1 });
  });

  it("reports progress at its interval, and a `true` from it cancels the run", async () => {
    const file = tmp("progress.sql", dump.sql);
    const seen: PipelineProgress[] = [];
    let clock = 0;
    await runPipeline({
      filePath: file,
      compression: "none",
      maxUncompressedBytes: 1e9,
      session: fakeSession().session,
      runId: "r",
      progressEveryMs: 10,
      now: () => (clock += 20),
      onProgress: (p) => {
        seen.push(p);
        return Promise.resolve(false);
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    await expect(
      runPipeline({ filePath: file, compression: "none", maxUncompressedBytes: 1e9, session: fakeSession().session, runId: "r", progressEveryMs: 0, onProgress: () => Promise.resolve(true) }),
    ).rejects.toBeInstanceOf(ImportCancelled);
    fs.rmSync(file);
  });

  it.each([
    ["a truncated dump", "truncated.sql", `${dump.sql}INSERT INTO mst_alat VALUES (1,'x`, "none", 1e9, "TRUNCATED_INPUT"],
    ["a decompression past the cap", "big.sql.gz", gzipSync(Buffer.from(dump.sql)), "gzip", 1000, "DECOMPRESSED_TOO_LARGE"],
    ["a corrupt gzip stream", "corrupt.sql.gz", Buffer.concat([gzipSync(Buffer.from(dump.sql)).subarray(0, 200), Buffer.from("garbage")]), "gzip", 1e9, "CORRUPT_COMPRESSION"],
  ] as const)("%s fails with its code", async (_label, name, body, compression, max, code) => {
    const file = tmp(name, body);
    const err = await runPipeline({ filePath: file, compression, maxUncompressedBytes: max, session: fakeSession().session, runId: "r", onProgress: () => Promise.resolve(false) }).catch((e: unknown) => e);
    fs.rmSync(file);
    expect(err).toBeInstanceOf(ImportFailure);
    expect(err).toMatchObject({ code });
  });

  it("a missing file is FILE_MISSING; a staging error goes on as it is (the service reads its SQLSTATE)", async () => {
    await expect(
      runPipeline({ filePath: path.join(os.tmpdir(), "p2406-none.sql"), compression: "none", maxUncompressedBytes: 1e9, session: fakeSession().session, runId: "r", onProgress: () => Promise.resolve(false) }),
    ).rejects.toMatchObject({ code: "FILE_MISSING" });
    const file = tmp("fail.sql", dump.sql);
    await expect(
      runPipeline({ filePath: file, compression: "none", maxUncompressedBytes: 1e9, session: fakeSession({ failOn: /^INSERT/ }).session, runId: "r", onProgress: () => Promise.resolve(false) }),
    ).rejects.toMatchObject({ name: "SequelizeDatabaseError", parent: { code: "22P02" } });
    fs.rmSync(file);
  });
});
