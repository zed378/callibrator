/**
 * The SQL-dump import's pipeline (ADR-129, P24-06): file → (gunzip) → parser
 * → policy → value conversion → staging, with bounded memory.
 *
 * The file is read in 64 KiB chunks; each chunk's events are loaded before
 * the next chunk is read. Rows wait in ONE buffer — the current table's —
 * flushed when it reaches a batch or 8 MiB, or when the dump moves on to
 * another table (mysqldump writes a table's rows together). A gzip file's
 * decompressed size is counted as it streams and the run fails past
 * UPSTREAM_IMPORT_MAX_UNCOMPRESSED_BYTES.
 *
 * Reported per table, COUNTS ONLY: rows loaded, rows rejected by reason,
 * rows not extracted (a table the policy does not stage), values noted
 * (`zero_date`), columns staged and excluded. No value, and no message that
 * could quote one, ever leaves this module: a staging error is reported by
 * its SQLSTATE.
 */
import fs from "fs";
import zlib from "zlib";
import { pipeline } from "stream";
import { DumpParser, DEFAULT_PARSER_LIMITS, type ParseEvent, type ParseSummary, type ParserLimits, type RawValue, type TableDef } from "./dumpParser";
import { convertValue, stagingTypeOf } from "./stagingValues";
import { decideTable, stagingTableOf } from "./tablePolicy";
import { batchSize, insertRows, prepareTable, type StagingColumn, type StagingRow, type StagingSession } from "./stagingLoader";

/** The fixed vocabulary of a failed run (the run's `error_code`). */
export type ImportErrorCode =
  | "FILE_MISSING"
  | "INTEGRITY_MISMATCH"
  | "INFECTED"
  | "SCAN_FAILED"
  | "REAL_DATA_NOT_ALLOWED"
  | "TRUNCATED_INPUT"
  | "DECOMPRESSED_TOO_LARGE"
  | "CORRUPT_COMPRESSION"
  | "STAGING_ROLE_INVALID"
  | "STAGING_FAILED"
  | "INTERRUPTED";

/** A run that cannot go on, with a code and a sentence that names no value. */
export class ImportFailure extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportFailure";
  }
}

/** The operator cancelled the run while it was parsing. */
export class ImportCancelled extends Error {
  constructor() {
    super("The import was cancelled.");
    this.name = "ImportCancelled";
  }
}

/** One table's counts. */
export interface TableReport {
  /** Whether the policy stages this table. */
  staged: boolean;
  /** Why its rows were not loaded: the policy's reason, the parser's refusal, or `schema_conflict`. */
  reason: string | null;
  columns: number;
  excludedColumns: number;
  rowsLoaded: number;
  rowsRejected: number;
  rowsNotExtracted: number;
  rejections: Record<string, number>;
  notes: Record<string, number>;
}

/** What a finished pipeline reports. */
export interface PipelineResult {
  readonly tables: Record<string, TableReport>;
  readonly summary: ParseSummary;
  readonly bytesRead: number;
  readonly uncompressedBytes: number;
}

/** A progress snapshot. */
export interface PipelineProgress {
  readonly bytesRead: number;
  readonly uncompressedBytes: number;
  readonly tables: Record<string, TableReport>;
}

/** What the pipeline needs. */
export interface PipelineOptions {
  readonly filePath: string;
  readonly compression: "none" | "gzip";
  readonly maxUncompressedBytes: number;
  readonly session: StagingSession;
  readonly runId: string;
  /** Called at most every `progressEveryMs`; resolves true to stop the run (a cancellation). */
  readonly onProgress: (progress: PipelineProgress) => Promise<boolean>;
  readonly progressEveryMs?: number;
  readonly parserLimits?: ParserLimits;
  readonly now?: () => number;
}

const CHUNK = 64 * 1024;
const FLUSH_BYTES = 8 * 1024 * 1024;

/** A staged table as the pipeline loads it. */
interface Loadable {
  readonly columns: readonly StagingColumn[];
  /** For each staged column, its index in the dump's columns. */
  readonly sources: readonly number[];
  conflict: boolean;
}

const newReport = (staged: boolean, reason: string | null): TableReport => ({
  staged,
  reason,
  columns: 0,
  excludedColumns: 0,
  rowsLoaded: 0,
  rowsRejected: 0,
  rowsNotExtracted: 0,
  rejections: {},
  notes: {},
});

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** The bytes a converted row holds, for the flush threshold. */
const sizeOf = (values: readonly (string | Buffer | null)[]): number =>
  values.reduce((sum, v) => sum + (v === null ? 1 : v.length), 0);

/** The file as a stream of (decompressed) chunks, counting what it read. */
const openSource = (filePath: string, compression: "none" | "gzip", counter: { bytesRead: number }): AsyncIterable<Buffer> => {
  const file = fs.createReadStream(filePath, { highWaterMark: CHUNK });
  if (compression === "none") {
    // Counted by the caller: each chunk read is a chunk parsed.
    return file as AsyncIterable<Buffer>;
  }
  file.on("data", (chunk) => {
    counter.bytesRead += chunk.length;
  });
  const gunzip = zlib.createGunzip({ chunkSize: CHUNK });
  // Errors surface through the iteration of `gunzip` (pipeline destroys it with the error).
  pipeline(file, gunzip, () => undefined);
  return gunzip as AsyncIterable<Buffer>;
};

/** A zlib or file error as the run's failure (never its message, which may name the path). */
const sourceFailure = (err: unknown): ImportFailure => {
  const code = (err as { code?: unknown }).code;
  if (code === "ENOENT") {
    return new ImportFailure("FILE_MISSING", "The uploaded file is no longer on the server.");
  }
  return new ImportFailure("CORRUPT_COMPRESSION", "The file is not a readable gzip stream (it is corrupt or not gzip).");
};

/**
 * Stream one dump into staging, inside the session's transaction.
 * @throws {ImportFailure} for a truncated dump, a decompression bomb, a corrupt
 *   or missing file, or a staging error (by SQLSTATE); {ImportCancelled}
 */
export const runPipeline = async (options: PipelineOptions): Promise<PipelineResult> => {
  const { session, runId } = options;
  const now = options.now ?? Date.now;
  const every = options.progressEveryMs ?? 2000;
  const parser = new DumpParser(options.parserLimits ?? DEFAULT_PARSER_LIMITS);
  const tables: Record<string, TableReport> = {};
  const loadable = new Map<string, Loadable>();
  const counter = { bytesRead: 0 };
  let uncompressedBytes = 0;
  let lastProgress = now();

  let bufferTable: string | null = null;
  let buffer: StagingRow[] = [];
  let bufferBytes = 0;

  const flush = async (): Promise<void> => {
    if (bufferTable !== null && buffer.length > 0) {
      const target = loadable.get(bufferTable) as Loadable;
      await insertRows(session, stagingTableOf(bufferTable), runId, target.columns, buffer);
      (tables[bufferTable] as TableReport).rowsLoaded += buffer.length;
    }
    buffer = [];
    bufferBytes = 0;
  };

  const reportOf = (table: string): TableReport => {
    tables[table] ??= ((): TableReport => {
      const decision = decideTable(table);
      return decision.stage ? newReport(true, null) : newReport(false, decision.reason);
    })();
    return tables[table];
  };

  const defineTable = async (def: TableDef): Promise<void> => {
    const report = reportOf(def.name);
    const decision = decideTable(def.name);
    if (!decision.stage) {
      return;
    }
    const sources = def.columns.flatMap((c, i) => (decision.excluded.has(c.name) ? [] : [i]));
    const columns = sources.map((i) => {
      const column = def.columns[i] as TableDef["columns"][number];
      return { name: column.name, type: stagingTypeOf(column) };
    });
    report.columns = columns.length;
    report.excludedColumns = def.columns.length - columns.length;
    const outcome = await prepareTable(session, stagingTableOf(def.name), columns);
    loadable.set(def.name, { columns, sources, conflict: outcome === "schema_conflict" });
    if (outcome === "schema_conflict") {
      report.reason = "schema_conflict";
    }
  };

  const reject = (report: TableReport, reason: string): void => {
    report.rowsRejected += 1;
    bump(report.rejections, reason);
  };

  const loadRow = async (table: string, rowNumber: number, values: readonly RawValue[]): Promise<void> => {
    const report = reportOf(table);
    const target = loadable.get(table);
    if (!report.staged) {
      report.rowsNotExtracted += 1;
      return;
    }
    // A staged table's rows arrive only after its definition was accepted.
    const loadableTarget = target as Loadable;
    if (loadableTarget.conflict) {
      reject(report, "schema_conflict");
      return;
    }
    const converted: (string | Buffer | null)[] = [];
    const notes: string[] = [];
    for (const [i, source] of loadableTarget.sources.entries()) {
      const result = convertValue(values[source] as RawValue, (loadableTarget.columns[i] as StagingColumn).type);
      if (!result.ok) {
        reject(report, result.reason);
        return;
      }
      if (result.note !== undefined) {
        notes.push(result.note);
      }
      converted.push(result.value);
    }
    notes.forEach((note) => {
      bump(report.notes, note);
    });
    if (bufferTable !== table) {
      await flush();
      bufferTable = table;
    }
    buffer.push({ rowNumber, values: converted });
    bufferBytes += sizeOf(converted);
    if (buffer.length >= batchSize(loadableTarget.columns.length) || bufferBytes >= FLUSH_BYTES) {
      await flush();
    }
  };

  const handle = async (events: readonly ParseEvent[]): Promise<void> => {
    for (const event of events) {
      switch (event.kind) {
        case "table":
          await flush();
          await defineTable(event.table);
          break;
        case "tableRefused": {
          const report = reportOf(event.table);
          report.reason = report.staged ? event.reason : report.reason;
          break;
        }
        case "row":
          await loadRow(event.table, event.rowNumber, event.values);
          break;
        case "reject": {
          const report = reportOf(event.table);
          if (report.staged) {
            reject(report, event.reason);
          } else {
            report.rowsNotExtracted += 1;
          }
          break;
        }
      }
    }
  };

  const snapshot = (): PipelineProgress => ({ bytesRead: counter.bytesRead, uncompressedBytes, tables });

  try {
    for await (const chunk of openSource(options.filePath, options.compression, counter)) {
      uncompressedBytes += chunk.length;
      if (options.compression === "none") {
        counter.bytesRead = uncompressedBytes;
      }
      if (uncompressedBytes > options.maxUncompressedBytes) {
        throw new ImportFailure("DECOMPRESSED_TOO_LARGE", "The file decompresses to more than UPSTREAM_IMPORT_MAX_UNCOMPRESSED_BYTES.");
      }
      await handle(parser.write(chunk));
      if (now() - lastProgress >= every) {
        lastProgress = now();
        if (await options.onProgress(snapshot())) {
          throw new ImportCancelled();
        }
      }
    }
  } catch (err) {
    // A failure of the run or of staging goes on as it is; anything else came from the file or zlib.
    if (err instanceof ImportFailure || err instanceof ImportCancelled || String((err as { name?: unknown }).name).startsWith("Sequelize")) {
      throw err;
    }
    throw sourceFailure(err);
  }
  const { events, summary } = parser.end();
  await handle(events);
  await flush();
  if (summary.truncated) {
    throw new ImportFailure("TRUNCATED_INPUT", "The dump ends inside a statement, a string or a comment: the file is truncated.");
  }
  return { tables, summary, bytesRead: counter.bytesRead, uncompressedBytes };
};
