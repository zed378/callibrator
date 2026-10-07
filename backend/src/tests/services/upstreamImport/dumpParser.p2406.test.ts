/**
 * P24-06 — the SQL-dump parser (services/upstreamImport/dumpParser.ts): it READS
 * a mysqldump / MariaDB dump and never executes it. Every statement shape it
 * reads, every one it counts and discards, every refusal — and, as fuzz and
 * property tests, what no input can make it do: throw, hang, keep a value past
 * its limit, report a name that is not an identifier, or read a different dump
 * depending on how the bytes were chunked.
 */
import {
  DumpParser,
  DEFAULT_PARSER_LIMITS,
  IDENTIFIER,
  INVALID_TABLE,
  type ParseEvent,
  type ParseSummary,
  type ParserLimits,
  type RawValue,
} from "../../../services/upstreamImport/dumpParser";
import { sqlString, syntheticUpstreamDump } from "../../support/syntheticUpstreamDump";

interface Parsed {
  events: ParseEvent[];
  summary: ParseSummary;
}

/** Parse `input`, fed in chunks of `chunk` bytes. */
const parse = (input: string | Buffer, limits: ParserLimits = DEFAULT_PARSER_LIMITS, chunk = 1 << 16): Parsed => {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  const parser = new DumpParser(limits);
  const events: ParseEvent[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    events.push(...parser.write(bytes.subarray(i, i + chunk)));
  }
  const end = parser.end();
  return { events: [...events, ...end.events], summary: end.summary };
};

const rows = (p: Parsed): Extract<ParseEvent, { kind: "row" }>[] => p.events.filter((e): e is Extract<ParseEvent, { kind: "row" }> => e.kind === "row");
const rejects = (p: Parsed): Extract<ParseEvent, { kind: "reject" }>[] => p.events.filter((e): e is Extract<ParseEvent, { kind: "reject" }> => e.kind === "reject");
const refused = (p: Parsed): Extract<ParseEvent, { kind: "tableRefused" }>[] =>
  p.events.filter((e): e is Extract<ParseEvent, { kind: "tableRefused" }> => e.kind === "tableRefused");
const text = (v: RawValue | undefined): string => {
  if (v === undefined) {
    return "<none>";
  }
  switch (v.kind) {
    case "null":
      return "NULL";
    case "number":
    case "bit":
      return `${v.kind}:${v.text}`;
    case "string":
      return `${v.charset}:${v.bytes.toString("latin1")}`;
    case "hex":
      return `hex:${v.bytes.toString("hex")}`;
  }
};
const values = (p: Parsed, i = 0): string[] => (rows(p)[i]?.values ?? []).map(text);

const T = "CREATE TABLE `t` (`a` int, `b` varchar(10));\n";
const SMALL: ParserLimits = { maxValueBytes: 8, maxRowBytes: 12, maxColumns: 2, maxTables: 2 };

describe("P24-06 dumpParser — what it reads", () => {
  it("reads a mysqldump-shaped file: the table, its typed columns and every row, in order", () => {
    const p = parse(syntheticUpstreamDump({ devices: 10, facilities: 3 }).sql);
    const tables = p.events.flatMap((e) => (e.kind === "table" ? [e.table.name] : []));
    expect(tables).toEqual(["users", "auth_groups", "auth_groups_users", "auth_logins", "mst_faskes", "mst_alat", "trx_inventory", "trx_catatan", "migrations", "synthetic_unknown_table"]);
    const users = p.events.find((e) => e.kind === "table" && e.table.name === "users");
    expect(users?.kind === "table" ? users.table.columns[0] : null).toEqual({ name: "id", type: "int", args: [11], unsigned: true });
    expect(p.summary).toMatchObject({ truncated: false, completionMarker: true, delimiterRegions: 1 });
    expect(p.summary.statements).toMatchObject({ create_table: 10, drop: 10, lock: 20 });
    expect(p.summary.conditionalComments).toBeGreaterThan(10);
    // The trigger's INSERT inside the DELIMITER region is not a row of mst_alat.
    expect(rows(p).filter((r) => r.table === "mst_alat")).toHaveLength(8);
  });

  it("decodes MariaDB's escapes, doubled quotes and double-quoted strings, byte for byte", () => {
    const p = parse(`${T}INSERT INTO t VALUES (1,'a\\0b\\bc\\nd\\re\\tf\\Zg\\%h\\_i\\'j\\"k\\\\l\\qm''n'),(2,"x""y");`);
    expect(rows(p)[0]?.values[1]).toEqual({
      kind: "string",
      charset: "default",
      bytes: Buffer.from("a\u0000b\bc\nd\re\tf\u001ag\\%h\\_i'j\"k\\lqm'n", "latin1"),
    });
    expect(values(p, 1)).toEqual(["number:2", 'default:x"y']);
  });

  it("reads NULL, TRUE / FALSE, signed and exponent numbers, hex, bit and introduced literals", () => {
    const p = parse(
      "CREATE TABLE t (a int, b int, c int, d int, e int, f int, g int, h int, i int, j int, k int, l int, m int);\n" +
        "INSERT INTO t VALUES (NULL,true,FALSE,-12,1.5e-3,1E+2,0x4142,X'43',b'101',0b11,_binary 'z',_latin1'\xe9',N'n');\n" +
        "INSERT INTO t VALUES (null,_utf8mb4 0x44,_utf8 'u',_utf8mb3 'v',1.25,7,8,9,10,11,12,13,14);",
    );
    expect(values(p)).toEqual([
      "NULL",
      "number:1",
      "number:0",
      "number:-12",
      "number:1.5e-3",
      "number:1E+2",
      "hex:4142",
      "hex:43",
      "bit:101",
      "bit:11",
      "binary:z",
      "latin1:Ã©",
      "default:n",
    ]);
    expect(values(p, 1).slice(0, 5)).toEqual(["NULL", "default:D", "default:u", "default:v", "number:1.25"]);
  });

  it("places the values of an INSERT with a column list in the table's order; missing columns are NULL", () => {
    const p = parse(`${T}INSERT INTO t (\`b\`) VALUES ('only b');\nINSERT INTO t (b, a) VALUE ('x', 5);`);
    expect(values(p, 0)).toEqual(["NULL", "default:only b"]);
    expect(values(p, 1)).toEqual(["number:5", "default:x"]);
  });

  it("numbers every tuple of a table — loaded or rejected — in dump order, across INSERTs", () => {
    const p = parse(`${T}INSERT INTO t VALUES (1,'a'),(2,NOW()),(3);\nINSERT IGNORE INTO \`db\`.\`t\` VALUES (4,'d');`);
    expect(p.events.flatMap((e) => (e.kind === "row" || e.kind === "reject" ? [e.rowNumber] : []))).toEqual([1, 2, 3, 4]);
    expect(rejects(p).map((r) => r.reason)).toEqual(["unsupported_value", "arity_mismatch"]);
  });

  it("reads CREATE TABLE IF NOT EXISTS, a schema-qualified name, keys, nested defaults, enums and unsigned", () => {
    const p = parse(
      "CREATE TABLE IF NOT EXISTS `db`.`T2` (\n" +
        "  `ID` bigint(20) unsigned NOT NULL,\n" +
        "  `e` enum('a','b') DEFAULT 'a',\n" +
        "  `d` decimal(10,2) DEFAULT (round(1.5, 0)) CHECK (d > 0),\n" +
        "  `f` float(precision(3)) zerofill,\n" +
        "  `x` text,,\n" +
        "  PRIMARY KEY (`ID`), UNIQUE KEY `u` (`e`), KEY k (d), CONSTRAINT c FOREIGN KEY (ID) REFERENCES o (id),\n" +
        "  FULLTEXT KEY ft (x), INDEX i (x), SPATIAL s (x), CHECK (unsigned), PERIOD FOR p (a, b), SYSTEM VERSIONING\n" +
        ") ENGINE=InnoDB;",
    );
    const table = p.events[0];
    expect(table).toEqual({
      kind: "table",
      table: {
        name: "t2",
        columns: [
          { name: "id", type: "bigint", args: [20], unsigned: true },
          { name: "e", type: "enum", args: [], unsigned: false },
          { name: "d", type: "decimal", args: [10, 2], unsigned: false },
          { name: "f", type: "float", args: [], unsigned: false },
          { name: "x", type: "text", args: [], unsigned: false },
        ],
      },
    });
  });
});

describe("P24-06 dumpParser — what it counts and discards, never acts on", () => {
  it("counts SET, LOCK / UNLOCK, DROP, USE, ALTER, transaction control and anything else", () => {
    const p = parse(
      "SET NAMES utf8;LOCK TABLES t WRITE;UNLOCK TABLES;DROP DATABASE x;USE x;ALTER TABLE t ADD c int;" +
        "START TRANSACTION;BEGIN;COMMIT;ROLLBACK;SELECT 1;GRANT ALL ON *.* TO x;(1);'s';;;  ;",
    );
    expect(p.summary.statements).toEqual({
      create_table: 0,
      insert: 0,
      set: 1,
      lock: 2,
      drop: 1,
      use: 1,
      alter: 1,
      transaction: 4,
      create_other: 0,
      insert_other: 0,
      other: 4,
    });
    expect(p.events).toEqual([]);
  });

  it("CREATE of anything but a table, CREATE TABLE … LIKE and malformed headers define nothing", () => {
    const p = parse(
      "CREATE VIEW v AS SELECT 1;CREATE OR REPLACE TABLE t (a int);CREATE PROCEDURE p() BEGIN END;" +
        "CREATE TABLE IF EXISTS t (a int);CREATE TABLE IF NOT t (a int);CREATE TABLE (a int);CREATE TABLE t LIKE u;CREATE TABLE IF NOT EXISTS;",
    );
    expect(p.summary.statements.create_other).toBe(3);
    expect(p.summary.statements.create_table).toBe(5);
    expect(p.events).toEqual([]);
  });

  it("INSERT that is not rows of a dump — no INTO, no name, INSERT … SELECT / SET, a bad column list — is counted, not read", () => {
    const p = parse(
      `${T}INSERT t VALUES (1,'a');INSERT INTO (1);INSERT INTO t SELECT * FROM u;INSERT INTO t SET a = 1;` +
        "INSERT INTO t (a, 'b') VALUES (1,2);INSERT INTO t (1x) VALUES (1);INSERT INTO t (a b) VALUES (1);INSERT INTO t (a) (b) VALUES (1);",
    );
    expect(p.summary.statements.insert_other).toBe(8);
    expect(p.summary.statements.insert).toBe(0);
    expect(rows(p)).toEqual([]);
  });

  it("discards a DELIMITER region whole (routines, triggers) and resumes after `DELIMITER ;`", () => {
    const p = parse(
      `${T}DELIMITER ;\nDELIMITER $$\nCREATE PROCEDURE p() BEGIN INSERT INTO t VALUES (9,'evil'); END $$\n${"x".repeat(80)}\ndelimiter   ;  \nINSERT INTO t VALUES (1,'ok');`,
    );
    expect(values(p)).toEqual(["number:1", "default:ok"]);
    expect(rows(p)).toHaveLength(1);
    expect(p.summary.delimiterRegions).toBe(1);
  });

  it("skips comments of every kind — and does not nest them (MySQL does not)", () => {
    const p = parse(
      `# hash\n-- dash\n--\n--\tdash-tab\n/**/ /* ** star */ /*!40101 SET x=1 */ /*M!100 SET y=2 */ /*Main*/ ${T}` +
        "/* a /* b */ c */ INSERT INTO t VALUES (1,'a'); -- trailing comment longer than thirty-two characters here\n",
    );
    expect(p.summary.comments).toBe(11);
    expect(p.summary.conditionalComments).toBe(2);
    // `c */ INSERT …` is one statement that starts with `c`: counted, not read.
    expect(p.summary.statements.other).toBe(1);
    expect(rows(p)).toEqual([]);
  });

  it("reads `--` without a following space as two minus signs, and a lone `/` and `-` as punctuation", () => {
    const p = parse(`${T}INSERT INTO t VALUES (--1,'a'),(- 1,'b'),(1/2,'c');`);
    expect(rejects(p).map((r) => r.reason)).toEqual(["unsupported_value", "unsupported_value", "unsupported_value"]);
  });

  it("an INSERT's ON DUPLICATE KEY UPDATE clause is not read; its rows are", () => {
    const p = parse(`${T}INSERT INTO t VALUES (1,'a') ON DUPLICATE KEY UPDATE b = 'z';`);
    expect(rows(p)).toHaveLength(1);
  });
});

describe("P24-06 dumpParser — refusals and rejections, with their reasons", () => {
  it("rejects a row whose value is not a literal, and resynchronises at the tuple's closing parenthesis", () => {
    const p = parse(
      `${T}INSERT INTO t VALUES (CONCAT('a', (1)), 'x'),(1 2),(\`a\`,'b'),(DEFAULT),(_binary 5,'b'),(_binary 0x4,'b'),(0x414,'b'),(b'012','b'),(X'zz','b'),(b'1' + 1,'b'),(1,),(1,'ok');`,
    );
    expect(rejects(p).map((r) => r.reason)).toEqual(Array(11).fill("unsupported_value"));
    expect(values(p)).toEqual(["number:1", "default:ok"]);
  });

  it("rejects a row of the wrong arity, of an unknown column, of an undeclared or refused table", () => {
    const p = parse(
      `INSERT INTO early VALUES (1);${T}INSERT INTO t VALUES (1);INSERT INTO t (a, zz) VALUES (1,2);INSERT INTO t (a, a) VALUES (1,2);` +
        "CREATE TABLE `bad name` (a int);INSERT INTO `bad name` VALUES (1);",
    );
    expect(rejects(p).map((r) => [r.table, r.reason])).toEqual([
      ["early", "table_not_declared"],
      ["t", "arity_mismatch"],
      ["t", "unknown_column"],
      ["t", "unknown_column"],
      [INVALID_TABLE, "table_refused"],
    ]);
    expect(refused(p)).toEqual([{ kind: "tableRefused", table: INVALID_TABLE, reason: "identifier_not_allowed" }]);
  });

  it("a table first named by an INSERT and declared later loads its later rows, numbering on", () => {
    const p = parse(`INSERT INTO t VALUES (1,'a');${T}INSERT INTO t VALUES (2,'b');`);
    expect(rejects(p).map((r) => [r.rowNumber, r.reason])).toEqual([[1, "table_not_declared"]]);
    expect(rows(p).map((r) => r.rowNumber)).toEqual([2]);
  });

  it("refuses a definition with a bad column name, a duplicate column, no column, a malformed element or an unclosed body", () => {
    const p = parse(
      "CREATE TABLE a (`bad col` int);CREATE TABLE b (x int, X int);CREATE TABLE c (PRIMARY KEY (x));" +
        "CREATE TABLE d ('x' int);CREATE TABLE e (x 'int');CREATE TABLE f (x int;",
    );
    expect(refused(p).map((r) => [r.table, r.reason])).toEqual([
      ["a", "identifier_not_allowed"],
      ["b", "duplicate_column"],
      ["c", "no_columns"],
      ["d", "malformed_definition"],
      ["e", "malformed_definition"],
      ["f", "malformed_definition"],
    ]);
  });

  it("refuses a table past maxColumns and a dump past maxTables (and counts their rows under one key)", () => {
    const p = parse(
      "CREATE TABLE a (x int, y int, z int);CREATE TABLE b (x int);CREATE TABLE c (x int);CREATE TABLE d (x int);" +
        "INSERT INTO e VALUES (1);INSERT INTO f VALUES (1);CREATE TABLE `x y` (a int);",
      SMALL,
    );
    expect(refused(p).map((r) => [r.table, r.reason])).toEqual([
      ["a", "too_many_columns"],
      [INVALID_TABLE, "too_many_tables"],
      [INVALID_TABLE, "too_many_tables"],
    ]);
    expect(rejects(p).map((r) => [r.table, r.reason, r.rowNumber])).toEqual([
      [INVALID_TABLE, "table_refused", 1],
      [INVALID_TABLE, "table_refused", 2],
    ]);
  });

  it("an identical redefinition is kept; a different one refuses the table from then on", () => {
    const p = parse(`${T}${T}INSERT INTO t VALUES (1,'a');CREATE TABLE t (a int);INSERT INTO t VALUES (2,'b');CREATE TABLE t (a int, b int, c int);CREATE TABLE \`x y\` (a int);CREATE TABLE \`x y\` (a int);`);
    expect(rows(p)).toHaveLength(1);
    expect(refused(p).map((r) => [r.table, r.reason])).toEqual([
      ["t", "redefined_differently"],
      [INVALID_TABLE, "identifier_not_allowed"],
    ]);
    expect(rejects(p).map((r) => r.reason)).toEqual(["table_refused"]);
  });

  it("a redefinition that is itself refused also refuses the table", () => {
    const p = parse(`${T}CREATE TABLE t (\`bad col\` int);`);
    expect(refused(p).map((r) => r.reason)).toEqual(["redefined_differently"]);
  });

  it("a value over maxValueBytes, or a row over maxRowBytes, rejects its row (row_too_large) — nothing is kept", () => {
    const p = parse(
      `CREATE TABLE t (a text, b text);INSERT INTO t VALUES ('123456789','x'),('12345','12345678'),(_binary '123456789','x'),(X'${"41".repeat(9)}','x'),(0x${"41".repeat(9)},'x'),('12345678','12345','x'),(x'41',NULL);`,
      SMALL,
    );
    expect(rejects(p).map((r) => r.reason)).toEqual(Array(6).fill("row_too_large"));
    expect(values(p)).toEqual(["hex:41", "NULL"]);
  });

  it("a value over 64 KiB is read whole, and the parser's buffer shrinks back after it", () => {
    const big = "y".repeat(100 * 1024);
    const p = parse(`${T}INSERT INTO t VALUES (1,'${big}'),(2,'small');`);
    expect(rows(p).map((r) => text(r.values[1]).length)).toEqual(["default:".length + big.length, "default:small".length]);
  });

  it("a number longer than any value may be is too large; any other word that long is not a value", () => {
    const p = parse(`CREATE TABLE t (a int);INSERT INTO t VALUES (${"9".repeat(40)}),(-${"9".repeat(40)}),(${"z".repeat(40)});`, SMALL);
    expect(rejects(p).map((r) => r.reason)).toEqual(["row_too_large", "row_too_large", "unsupported_value"]);
    expect(parse(`${"Q".repeat(40)};`, SMALL).summary.statements.other).toBe(1);
  });

  it("a parenthesis where a value belongs rejects the row and skips the nested tuple", () => {
    const p = parse(`${T}INSERT INTO t VALUES ((1),'x'),(2,'y');`);
    expect(rejects(p).map((r) => r.reason)).toEqual(["unsupported_value"]);
    expect(values(p)).toEqual(["number:2", "default:y"]);
  });

  it("an INSERT into a name that is not an identifier, first, is refused under #invalid", () => {
    const p = parse("INSERT INTO `a b` VALUES (1);");
    expect(rejects(p).map((r) => [r.table, r.reason])).toEqual([[INVALID_TABLE, "table_refused"]]);
  });

  it("a DELIMITER argument longer than 64 bytes still opens a region (fail-closed: its contents are discarded)", () => {
    const p = new DumpParser();
    const events = p.write(Buffer.from(`DELIMITER ${"$".repeat(80)}
INSERT INTO t VALUES (1);
DELIMITER ;
${T}`));
    expect(events.map((e) => e.kind)).toEqual(["table"]);
    expect(p.end().summary.delimiterRegions).toBe(1);
  });

  it("a statement that ends inside a tuple rejects that tuple", () => {
    const p = parse(`${T}INSERT INTO t VALUES (1,'a'),(2,;INSERT INTO t VALUES (3, NOW(;INSERT INTO t VALUES (_binary;INSERT INTO t VALUES (4;`);
    expect(rejects(p).map((r) => r.reason)).toEqual(["unsupported_value", "unsupported_value", "unsupported_value", "unsupported_value"]);
    expect(rows(p)).toHaveLength(1);
  });

  it("names that are not identifiers never appear: an invalid table is counted as #invalid", () => {
    const p = parse("CREATE TABLE `a``b` (x int);INSERT INTO `naïve` VALUES (1);");
    expect(new Set(p.events.map((e) => (e.kind === "table" ? e.table.name : e.table)))).toEqual(new Set([INVALID_TABLE]));
  });
});

describe("P24-06 dumpParser — truncation", () => {
  it.each([
    ["inside a string", `${T}INSERT INTO t VALUES (1,'abc`],
    ["inside a backtick identifier", "CREATE TABLE `t"],
    ["inside a block comment", "/* never closed"],
    ["inside an escape", `${T}INSERT INTO t VALUES (1,'a\\`],
    ["inside a quoted hex literal", `${T}INSERT INTO t VALUES (X'41`],
    ["inside a DELIMITER region", "DELIMITER ;;\nCREATE TRIGGER x"],
    ["inside a statement", `${T}INSERT INTO t VALUES (1,'a')`],
    ["after a closed string, without the semicolon", `${T}INSERT INTO t VALUES (1,'a'`],
    ["after a backtick identifier", "CREATE TABLE `t`"],
    ["on a minus", "SELECT -"],
    ["on a slash", "SELECT /"],
    ["on a word", "SELECT word"],
    ["inside a block comment's closing", "/* x *"],
  ])("a dump that ends %s is truncated", (_label, input) => {
    expect(parse(input).summary.truncated).toBe(true);
  });

  it.each([
    ["after a statement", T],
    ["inside a line comment", `${T}-- the end`],
    ["on `--`", `${T}--`],
    ["inside a DELIMITER argument", `${T}DELIMITER ;`],
    ["on an empty input", ""],
  ])("a dump that ends %s is not truncated", (_label, input) => {
    expect(parse(input).summary.truncated).toBe(false);
  });

  it("the completion marker is read from a `-- Dump completed` line", () => {
    expect(parse("-- Dump completed on 2026-10-07\n").summary.completionMarker).toBe(true);
    expect(parse("-- dump finished\n").summary.completionMarker).toBe(false);
  });

  it("`delimiter` later in a statement is a word, not a directive", () => {
    const p = parse("SELECT delimiter;");
    expect(p.summary.statements.other).toBe(1);
    expect(p.summary.delimiterRegions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fuzz and property tests
// ---------------------------------------------------------------------------

/** A seeded PRNG (mulberry32), so a failure reproduces. */
const prng = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ALPHABET = ["'", '"', "`", "\\", "(", ")", ",", ";", "-", "-- ", "#", "/*", "*/", "\n", " ", "0x", "X'", "b'", "INSERT INTO t VALUES ", "CREATE TABLE t (a int)", "DELIMITER ;;\n", "DELIMITER ;\n", "NULL", "1", "é", "\u0000", "\xff", "_binary", "a"];

const assertWellFormed = (p: Parsed, limits: ParserLimits): void => {
  for (const event of p.events) {
    const name = event.kind === "table" ? event.table.name : event.table;
    expect(name === INVALID_TABLE || (IDENTIFIER.test(name) && name === name.toLowerCase())).toBe(true);
    if (event.kind === "row") {
      const size = event.values.reduce((s, v) => s + (v.kind === "string" || v.kind === "hex" ? v.bytes.length : v.kind === "null" ? 0 : v.text.length), 0);
      expect(size).toBeLessThanOrEqual(limits.maxRowBytes);
    }
  }
};

describe("P24-06 dumpParser — fuzz: no input makes it throw, hang or keep more than its limits", () => {
  it("random byte strings (2,000 inputs) — never throws, every reported name an identifier", () => {
    const random = prng(1);
    const limits: ParserLimits = { maxValueBytes: 64, maxRowBytes: 128, maxColumns: 8, maxTables: 4 };
    for (let n = 0; n < 2000; n++) {
      const bytes = Buffer.alloc(Math.floor(random() * 300));
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(random() * 256);
      }
      assertWellFormed(parse(bytes, limits, 1 + Math.floor(random() * 50)), limits);
    }
  });

  it("random SQL-shaped token soup (2,000 inputs) — unterminated strings, nested comments, mixed charsets", () => {
    const random = prng(2);
    const limits: ParserLimits = { maxValueBytes: 32, maxRowBytes: 64, maxColumns: 4, maxTables: 3 };
    for (let n = 0; n < 2000; n++) {
      const pieces: string[] = [];
      for (let i = Math.floor(random() * 60); i > 0; i--) {
        pieces.push(ALPHABET[Math.floor(random() * ALPHABET.length)] as string);
      }
      const input = Buffer.from(pieces.join(""), "latin1");
      assertWellFormed(parse(input, limits, 1 + Math.floor(random() * 20)), limits);
    }
  });

  it("a 2 MB unterminated string and a 2 MB row: rejected or truncated, with bounded memory", () => {
    const limits: ParserLimits = { maxValueBytes: 1024, maxRowBytes: 2048, maxColumns: 4, maxTables: 4 };
    const huge = "x".repeat(2 * 1024 * 1024);
    expect(parse(`${T}INSERT INTO t VALUES (1,'${huge}`, limits).summary.truncated).toBe(true);
    const p = parse(`${T}INSERT INTO t VALUES (1,'${huge}'),(2,'ok');`, limits);
    expect(rejects(p).map((r) => r.reason)).toEqual(["row_too_large"]);
    expect(values(p)).toEqual(["number:2", "default:ok"]);
  });

  it("the same dump gives the same events whatever the chunking (1 byte … 64 KiB)", () => {
    const dump = syntheticUpstreamDump({ devices: 40, facilities: 5, rowsPerInsert: 7 }).sql;
    const whole = JSON.stringify(parse(dump));
    for (const chunk of [1, 2, 3, 7, 64, 1000]) {
      expect(JSON.stringify(parse(dump, DEFAULT_PARSER_LIMITS, chunk))).toBe(whole);
    }
  });
});

describe("P24-06 dumpParser — property: what mysqldump escapes, the parser reads back exactly", () => {
  it("1,000 random rows of strings (quotes, backslashes, control bytes, multi-byte UTF-8) and numbers round-trip", () => {
    const random = prng(3);
    const chars = ["a", "Z", "'", '"', "\\", "\n", "\r", "\t", "%", "_", " ", ",", ")", "(", ";", "é", "日", "😀", "\u0001", "`", "/*", "--"];
    const expected: string[][] = [];
    const tuples: string[] = [];
    for (let n = 0; n < 1000; n++) {
      let s = "";
      for (let i = Math.floor(random() * 30); i > 0; i--) {
        s += chars[Math.floor(random() * chars.length)] as string;
      }
      const num = String(Math.floor(random() * 2e9) - 1e9);
      tuples.push(`(${num},${sqlString(s)})`);
      expected.push([`number:${num}`, `default:${Buffer.from(s, "utf8").toString("latin1")}`]);
    }
    const p = parse(`CREATE TABLE t (a int, b text);\nINSERT INTO t VALUES ${tuples.join(",")};`, DEFAULT_PARSER_LIMITS, 97);
    expect(rows(p).map((r) => r.values.map(text))).toEqual(expected);
  });
});
