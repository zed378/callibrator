/**
 * The SQL-dump import's parser (ADR-129, P24-06) — it READS a mysqldump /
 * MariaDB-dump file and NEVER EXECUTES anything in it.
 *
 * Executing an uploaded SQL file is remote code execution, and a MariaDB dump
 * would not run on PostgreSQL anyway. This parser understands exactly two
 * statement shapes and treats every other one as something to count and
 * discard:
 *
 *   CREATE TABLE [IF NOT EXISTS] `t` ( `col` type[(args)] [unsigned] …, KEY … ) …;
 *   INSERT [IGNORE] INTO `t` [(`c1`, …)] VALUES (v, …), (v, …) …;
 *
 * A value is NULL, a number, a quoted string (MariaDB escapes: \0 \' \" \b \n
 * \r \t \Z \\ \% \_, and a doubled quote), a charset-introduced string
 * (`_binary'…'`, `_utf8mb4'…'`, `_latin1'…'`, `N'…'`), a hex literal (`0x…`,
 * `X'…'`), a bit literal (`b'…'`, `0b…`) or TRUE / FALSE. Anything else — a
 * function call, an expression, DEFAULT — rejects THAT ROW with a reason; the
 * parser resynchronises at the tuple's closing parenthesis.
 *
 * Counted and discarded, never acted on: SET, LOCK / UNLOCK, DROP, USE, ALTER,
 * transaction control, CREATE of anything but a table (VIEW, TRIGGER,
 * PROCEDURE, FUNCTION, EVENT, DATABASE, OR REPLACE …), INSERT … SELECT, and
 * everything inside a `DELIMITER` region (routine and trigger bodies are
 * discarded whole until a `DELIMITER ;` line). Comments (`-- `, `#`,
 * `/* … *\/`, the executable `/*! … *\/` included) are skipped; MySQL does
 * not nest comments, and neither does this.
 *
 * STREAMING, BOUNDED MEMORY. `write(chunk)` consumes bytes and returns the
 * events those bytes completed (a table definition, a row, a rejected row);
 * the caller loads them before writing the next chunk. Nothing holds more than
 * one literal of `maxValueBytes`, one row of `maxRowBytes` and one table
 * definition. A literal over its limit is not kept: its row is rejected
 * `row_too_large`.
 *
 * BYTES, NOT TEXT. A string literal is collected as bytes and decoded (strict
 * UTF-8, or latin1 when introduced so) only when it is converted for its
 * column (`stagingValues.ts`): a binary value is never mangled, and an invalid
 * byte sequence rejects its row instead of becoming U+FFFD.
 *
 * NAMES ARE DATA TOO. A table or column name that is not a plain identifier
 * (`^[A-Za-z_][A-Za-z0-9_]{0,62}$`) is never reported or used: every such
 * table is counted under the one key `#invalid`, refused.
 *
 * Row numbers: every tuple of a table — loaded or rejected — takes the next
 * number of that table, starting at 1, in dump order (`source_row_number`).
 */

/** The limits one parse runs under. */
export interface ParserLimits {
  /** Bytes of one string, hex or bit literal. */
  readonly maxValueBytes: number;
  /** The sum of one row's literal bytes. */
  readonly maxRowBytes: number;
  /** Columns of one table. */
  readonly maxColumns: number;
  /** Distinct tables of one dump. */
  readonly maxTables: number;
}

/** 16 MiB per literal and per row (MariaDB's default max_allowed_packet), 1,024 columns, 1,000 tables. */
export const DEFAULT_PARSER_LIMITS: ParserLimits = Object.freeze({
  maxValueBytes: 16 * 1024 * 1024,
  maxRowBytes: 16 * 1024 * 1024,
  maxColumns: 1024,
  maxTables: 1000,
});

/** How a string literal's bytes are to be read. */
export type Charset = "default" | "binary" | "latin1";

/** A value as the dump wrote it, before it is converted for its column. */
export type RawValue =
  | { readonly kind: "null" }
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "string"; readonly bytes: Buffer; readonly charset: Charset }
  | { readonly kind: "hex"; readonly bytes: Buffer }
  | { readonly kind: "bit"; readonly text: string };

/** A column as its CREATE TABLE declared it. */
export interface ColumnDef {
  /** Lower-cased; matches IDENTIFIER. */
  readonly name: string;
  /** The declared type word, lower-cased (`int`, `varchar`, `datetime` …). */
  readonly type: string;
  /** The numbers inside the type's parentheses (`decimal(10,2)` → [10, 2]). */
  readonly args: readonly number[];
  readonly unsigned: boolean;
}

/** A table as its CREATE TABLE declared it. */
export interface TableDef {
  /** Lower-cased; matches IDENTIFIER. */
  readonly name: string;
  readonly columns: readonly ColumnDef[];
}

/** Why a row was not loaded. Counts are all that ever leave the parser — never a value. */
export type RowRejection =
  | "arity_mismatch"
  | "unsupported_value"
  | "row_too_large"
  | "table_not_declared"
  | "table_refused"
  | "unknown_column";

/** Why a table definition was refused (its rows are counted, rejected `table_refused`). */
export type TableRefusal =
  | "identifier_not_allowed"
  | "duplicate_column"
  | "too_many_columns"
  | "too_many_tables"
  | "no_columns"
  | "malformed_definition"
  | "redefined_differently";

/** What a `write` or `end` produced. */
export type ParseEvent =
  | { readonly kind: "table"; readonly table: TableDef }
  | { readonly kind: "tableRefused"; readonly table: string; readonly reason: TableRefusal }
  | { readonly kind: "row"; readonly table: string; readonly rowNumber: number; readonly values: readonly RawValue[] }
  | { readonly kind: "reject"; readonly table: string; readonly rowNumber: number; readonly reason: RowRejection };

/** The kinds of statement the summary counts. */
export type StatementKind =
  | "create_table"
  | "insert"
  | "set"
  | "lock"
  | "drop"
  | "use"
  | "alter"
  | "transaction"
  | "create_other"
  | "insert_other"
  | "other";

/** Structure-only facts about the whole input. */
export interface ParseSummary {
  readonly statements: Readonly<Record<StatementKind, number>>;
  readonly comments: number;
  readonly conditionalComments: number;
  readonly delimiterRegions: number;
  /** The input ended inside a statement, a string, a comment or a DELIMITER region. */
  readonly truncated: boolean;
  /** A `-- Dump completed` line was seen (mysqldump writes it last). */
  readonly completionMarker: boolean;
}

/** An identifier the staging schema accepts (within PostgreSQL's 63-byte limit). */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** The one key every table with a name that is not an IDENTIFIER is counted under. */
export const INVALID_TABLE = "#invalid";

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/** A growable byte buffer that stops at its cap (and remembers that it did). */
class ByteBuilder {
  private buf: Buffer;
  private len = 0;
  private over = false;

  constructor(private readonly cap: number) {
    this.buf = Buffer.allocUnsafe(Math.min(256, Math.max(cap, 1)));
  }

  push(byte: number): void {
    if (this.len >= this.cap) {
      this.over = true;
      return;
    }
    if (this.len === this.buf.length) {
      const grown = Buffer.allocUnsafe(Math.min(this.buf.length * 2, this.cap));
      this.buf.copy(grown, 0, 0, this.len);
      this.buf = grown;
    }
    this.buf[this.len] = byte;
    this.len += 1;
  }

  /** The bytes collected (a copy), or null when the cap was passed; then empties. */
  take(): Buffer | null {
    const out = this.over ? null : Buffer.from(this.buf.subarray(0, this.len));
    this.len = 0;
    this.over = false;
    if (this.buf.length > 65536) {
      this.buf = Buffer.allocUnsafe(256);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type Token =
  | { readonly t: "word"; readonly text: string }
  | { readonly t: "ident"; readonly text: string | null }
  | { readonly t: "string"; readonly bytes: Buffer | null }
  | { readonly t: "number"; readonly text: string }
  | { readonly t: "hex"; readonly bytes: Buffer | null }
  | { readonly t: "bit"; readonly text: string | null }
  | { readonly t: "punct"; readonly ch: string }
  | { readonly t: "end" };

/** Every token but the statement delimiter, which `DumpParser#token` handles itself. */
type StatementToken = Exclude<Token, { t: "end" }>;

const Mode = {
  Normal: 0,
  Word: 1,
  Backtick: 2,
  BacktickQuote: 3,
  Str: 4,
  StrEsc: 5,
  StrQuote: 6,
  LineComment: 7,
  BlockComment: 8,
  BlockStar: 9,
  Minus: 10,
  Dash2: 11,
  Slash: 12,
  QuotedLiteral: 13,
  DelimiterArg: 14,
  Region: 15,
} as const;
type Mode = (typeof Mode)[keyof typeof Mode];

/** A word's progress as a number: digits, then a fraction, then an exponent. */
const Num = {
  No: 0,
  Int: 1,
  Fraction: 2,
  ExponentMark: 3,
  Exponent: 4,
} as const;
type Num = (typeof Num)[keyof typeof Num];

/** The modes the input may not end in: it would be cut inside something. */
const UNFINISHED: ReadonlySet<Mode> = new Set<Mode>([
  Mode.Backtick,
  Mode.Str,
  Mode.StrEsc,
  Mode.BlockComment,
  Mode.BlockStar,
  Mode.QuotedLiteral,
  Mode.Region,
]);

const isWordByte = (b: number): boolean =>
  (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x24 || b >= 0x80;
const isDigit = (b: number): boolean => b >= 0x30 && b <= 0x39;
const isSpace = (b: number): boolean => b === 0x20 || (b >= 0x09 && b <= 0x0d);

/** MariaDB's backslash escapes; any other escaped byte stands for itself. */
const ESCAPES: Readonly<Partial<Record<number, readonly number[]>>> = {
  0x30: [0x00], // \0
  0x62: [0x08], // \b
  0x6e: [0x0a], // \n
  0x72: [0x0d], // \r
  0x74: [0x09], // \t
  0x5a: [0x1a], // \Z
  0x25: [0x5c, 0x25], // \% keeps its backslash
  0x5f: [0x5c, 0x5f], // \_ keeps its backslash
};

const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const HEX_NUMBER = /^0x([0-9A-Fa-f]+)$/;
const BIT_NUMBER = /^0b([01]+)$/;

/** Hex digits as bytes, or null when the count is odd or a digit is not hex. */
const hexBytes = (digits: string): Buffer | null =>
  /^(?:[0-9A-Fa-f]{2})*$/.test(digits) ? Buffer.from(digits, "hex") : null;

/** A hex literal's token: over the value limit it is a literal over the limit (its row is too large). */
const hexToken = (digits: string, maxValueBytes: number): Token =>
  digits.length > maxValueBytes * 2 ? { t: "string", bytes: null } : { t: "hex", bytes: hexBytes(digits) };

/** The statement-level consumer of tokens. */
interface TokenSink {
  token(tok: Token): void;
  /** Whether no token of the current statement has been seen. */
  atStart(): boolean;
}

/**
 * Bytes → tokens. A state machine with no look-ahead: a byte that ends a
 * pending state (`-` that is not `--`, `/` that is not `/*`, a quote that is
 * not doubled) is re-processed in Normal mode.
 */
class Tokenizer {
  private mode: Mode = Mode.Normal;
  private quote = 0;
  /** String and backtick contents. */
  private readonly bytes: ByteBuilder;
  /** A bare word or number, and the digits of X'…' / b'…'. */
  private readonly word: ByteBuilder;
  private wordFirst = 0;
  private wordLength = 0;
  private num: Num = Num.No;
  private hexLiteral = false;
  private line = "";
  private commentStart = 0;
  comments = 0;
  conditionalComments = 0;
  delimiterRegions = 0;
  completionMarker = false;

  private readonly maxValueBytes: number;

  constructor(
    private readonly sink: TokenSink,
    limits: ParserLimits,
  ) {
    this.maxValueBytes = limits.maxValueBytes;
    this.bytes = new ByteBuilder(limits.maxValueBytes);
    // A hex literal spells each byte with two digits.
    this.word = new ByteBuilder(limits.maxValueBytes * 2 + 2);
  }

  feed(chunk: Buffer): void {
    for (const b of chunk) {
      this.byte(b);
    }
  }

  /** Flush a token pending at the end of input; true when the input ended inside something unfinished. */
  finish(): boolean {
    const mode = this.mode;
    if (mode === Mode.Word) {
      this.endWord();
    } else if (mode === Mode.Minus || mode === Mode.Slash) {
      this.sink.token({ t: "punct", ch: mode === Mode.Minus ? "-" : "/" });
    } else if (mode === Mode.StrQuote) {
      this.emitString();
    } else if (mode === Mode.BacktickQuote) {
      this.emitIdent();
    }
    // Inside a string, an identifier, a block comment, a quoted literal or a DELIMITER region.
    return UNFINISHED.has(mode);
  }

  private byte(b: number): void {
    switch (this.mode) {
      case Mode.Normal:
        this.normal(b);
        return;
      case Mode.Word:
        this.wordByte(b);
        return;
      case Mode.Backtick:
        if (b === 0x60) {
          this.mode = Mode.BacktickQuote;
        } else {
          this.bytes.push(b);
        }
        return;
      case Mode.BacktickQuote:
        if (b === 0x60) {
          this.bytes.push(b);
          this.mode = Mode.Backtick;
          return;
        }
        this.emitIdent();
        this.normal(b);
        return;
      case Mode.Str:
        if (b === 0x5c) {
          this.mode = Mode.StrEsc;
        } else if (b === this.quote) {
          this.mode = Mode.StrQuote;
        } else {
          this.bytes.push(b);
        }
        return;
      case Mode.StrEsc:
        for (const out of ESCAPES[b] ?? [b]) {
          this.bytes.push(out);
        }
        this.mode = Mode.Str;
        return;
      case Mode.StrQuote:
        if (b === this.quote) {
          this.bytes.push(b);
          this.mode = Mode.Str;
          return;
        }
        this.emitString();
        this.normal(b);
        return;
      case Mode.LineComment:
        if (b === 0x0a) {
          this.completionMarker ||= /^\s*Dump completed/.test(this.line);
          this.mode = Mode.Normal;
        } else if (this.line.length < 32) {
          this.line += String.fromCharCode(b);
        }
        return;
      case Mode.BlockComment:
        this.blockComment(b);
        return;
      case Mode.BlockStar:
        if (b === 0x2f) {
          this.mode = Mode.Normal;
        } else if (b !== 0x2a) {
          this.mode = Mode.BlockComment;
        }
        return;
      case Mode.Minus:
        if (b === 0x2d) {
          this.mode = Mode.Dash2;
          return;
        }
        if (isDigit(b)) {
          this.startWord(0x2d);
          this.wordByte(b);
          return;
        }
        this.mode = Mode.Normal;
        this.sink.token({ t: "punct", ch: "-" });
        this.normal(b);
        return;
      case Mode.Dash2:
        if (b <= 0x20) {
          // "-- " (dash, dash, a space or control byte) opens a comment; a newline also closes it.
          this.startLineComment();
          if (b === 0x0a) {
            this.mode = Mode.Normal;
          }
          return;
        }
        this.mode = Mode.Normal;
        this.sink.token({ t: "punct", ch: "-" });
        this.sink.token({ t: "punct", ch: "-" });
        this.normal(b);
        return;
      case Mode.Slash:
        if (b === 0x2a) {
          this.comments += 1;
          this.commentStart = 0;
          this.mode = Mode.BlockComment;
          return;
        }
        this.mode = Mode.Normal;
        this.sink.token({ t: "punct", ch: "/" });
        this.normal(b);
        return;
      case Mode.QuotedLiteral:
        if (b === 0x27) {
          this.endQuotedLiteral();
        } else {
          this.word.push(b);
        }
        return;
      case Mode.DelimiterArg:
        if (b === 0x0a) {
          const arg = this.line.trim();
          this.line = "";
          const region = arg !== ";";
          this.delimiterRegions += region ? 1 : 0;
          this.mode = region ? Mode.Region : Mode.Normal;
        } else if (this.line.length < 64) {
          this.line += String.fromCharCode(b);
        }
        return;
      case Mode.Region:
        if (b === 0x0a) {
          const done = /^\s*delimiter\s+;\s*$/i.test(this.line);
          this.line = "";
          if (done) {
            this.mode = Mode.Normal;
          }
        } else if (this.line.length < 64) {
          this.line += String.fromCharCode(b);
        }
        return;
    }
  }

  private normal(b: number): void {
    if (isSpace(b)) {
      return;
    }
    if (b === 0x3b) {
      this.sink.token({ t: "end" });
    } else if (b === 0x60) {
      this.mode = Mode.Backtick;
    } else if (b === 0x27 || b === 0x22) {
      this.quote = b;
      this.mode = Mode.Str;
    } else if (b === 0x2d) {
      this.mode = Mode.Minus;
    } else if (b === 0x23) {
      this.startLineComment();
    } else if (b === 0x2f) {
      this.mode = Mode.Slash;
    } else if (isWordByte(b)) {
      this.startWord(b);
    } else {
      this.sink.token({ t: "punct", ch: String.fromCharCode(b) });
    }
  }

  /** `/*!…` and `/*M!…` are executable comments in MySQL; here they are comments, counted. */
  private blockComment(b: number): void {
    if (this.commentStart === 0) {
      this.commentStart = b === 0x4d ? 1 : 2;
      this.conditionalComments += b === 0x21 ? 1 : 0;
    } else if (this.commentStart === 1) {
      this.commentStart = 2;
      this.conditionalComments += b === 0x21 ? 1 : 0;
    }
    if (b === 0x2a) {
      this.mode = Mode.BlockStar;
    }
  }

  private startLineComment(): void {
    this.comments += 1;
    this.line = "";
    this.mode = Mode.LineComment;
  }

  private startWord(b: number): void {
    this.mode = Mode.Word;
    this.wordFirst = b;
    this.wordLength = 1;
    this.num = isDigit(b) || b === 0x2d ? Num.Int : Num.No;
    this.word.push(b);
  }

  private wordByte(b: number): void {
    if (b === 0x27 && this.wordLength === 1 && /^[xXbB]$/.test(String.fromCharCode(this.wordFirst))) {
      // X'…' or b'…': the word was the literal's prefix.
      this.hexLiteral = this.wordFirst === 0x78 || this.wordFirst === 0x58;
      this.word.take();
      this.mode = Mode.QuotedLiteral;
      return;
    }
    const next = this.numberAfter(b);
    if (!isWordByte(b) && next === Num.No) {
      this.endWord();
      this.normal(b);
      return;
    }
    this.num = next;
    this.wordLength += 1;
    this.word.push(b);
  }

  /** What `b` makes of the number read so far (`Num.No` once it is not one). */
  private numberAfter(b: number): Num {
    switch (this.num) {
      case Num.Int:
        if (isDigit(b)) {
          return Num.Int;
        }
        if (b === 0x2e) {
          return Num.Fraction;
        }
        return b === 0x65 || b === 0x45 ? Num.ExponentMark : Num.No;
      case Num.Fraction:
        if (isDigit(b)) {
          return Num.Fraction;
        }
        return b === 0x65 || b === 0x45 ? Num.ExponentMark : Num.No;
      case Num.ExponentMark:
        return isDigit(b) || b === 0x2b || b === 0x2d ? Num.Exponent : Num.No;
      case Num.Exponent:
        return isDigit(b) ? Num.Exponent : Num.No;
      case Num.No:
        return Num.No;
    }
  }

  private endWord(): void {
    const raw = this.word.take();
    this.mode = Mode.Normal;
    if (raw === null && (isDigit(this.wordFirst) || this.wordFirst === 0x2d)) {
      // A number or 0x literal longer than any value may be: a literal over the limit.
      this.sink.token({ t: "string", bytes: null });
      return;
    }
    // Any other word that long is nothing this parser reads: an empty word.
    const text = raw === null ? "" : raw.toString("latin1");
    if (this.sink.atStart() && text.toLowerCase() === "delimiter") {
      this.line = "";
      this.mode = Mode.DelimiterArg;
      return;
    }
    const hex = HEX_NUMBER.exec(text);
    const bit = BIT_NUMBER.exec(text);
    if (hex) {
      this.sink.token(hexToken(hex[1] as string, this.maxValueBytes));
    } else if (bit) {
      this.sink.token({ t: "bit", text: bit[1] as string });
    } else if (NUMBER.test(text)) {
      this.sink.token({ t: "number", text });
    } else {
      this.sink.token({ t: "word", text });
    }
  }

  private endQuotedLiteral(): void {
    const raw = this.word.take();
    this.mode = Mode.Normal;
    if (raw === null) {
      // Over the limit: as a string over the limit, its row is too large.
      this.sink.token({ t: "string", bytes: null });
      return;
    }
    const digits = raw.toString("latin1");
    this.sink.token(this.hexLiteral ? hexToken(digits, this.maxValueBytes) : { t: "bit", text: /^[01]*$/.test(digits) ? digits : null });
  }

  private emitString(): void {
    this.mode = Mode.Normal;
    this.sink.token({ t: "string", bytes: this.bytes.take() });
  }

  private emitIdent(): void {
    this.mode = Mode.Normal;
    const raw = this.bytes.take();
    this.sink.token({ t: "ident", text: raw === null ? null : raw.toString("latin1") });
  }
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

const S = {
  Start: 0,
  Skip: 1,
  Create: 2,
  TableIf: 3,
  TableIfNot: 4,
  TableIfNotExists: 5,
  TableName: 6,
  TableOpen: 7,
  TableBody: 8,
  TableTail: 9,
  Insert: 10,
  InsertInto: 11,
  InsertName: 12,
  InsertCols: 13,
  InsertColsNext: 14,
  InsertValuesKeyword: 15,
  Values: 16,
  Value: 17,
  AfterValue: 18,
  Introduced: 19,
  SkipTuple: 20,
  AfterTuple: 21,
} as const;
type S = (typeof S)[keyof typeof S];

/** The states inside a VALUES tuple. */
const IN_TUPLE: ReadonlySet<S> = new Set<S>([S.Value, S.AfterValue, S.Introduced, S.SkipTuple]);

/** First words of an element of a CREATE TABLE body that is not a column. */
const NOT_A_COLUMN = new Set(["primary", "key", "index", "unique", "constraint", "foreign", "fulltext", "spatial", "check", "period", "system"]);

const FIRST_WORD: Readonly<Partial<Record<string, StatementKind>>> = {
  set: "set",
  lock: "lock",
  unlock: "lock",
  drop: "drop",
  use: "use",
  alter: "alter",
  start: "transaction",
  begin: "transaction",
  commit: "transaction",
  rollback: "transaction",
};

const INTRODUCERS: Readonly<Partial<Record<string, Charset>>> = {
  _binary: "binary",
  _utf8: "default",
  _utf8mb3: "default",
  _utf8mb4: "default",
  _latin1: "latin1",
  n: "default",
};

/** One table as the parser tracks it. */
interface TableState {
  def: TableDef | null;
  refusal: TableRefusal | null;
  rows: number;
}

/** A column being read from a CREATE TABLE body. */
interface ElementState {
  step: "start" | "type" | "afterType" | "args" | "rest" | "skip";
  depth: number;
  name: string | null;
  type: string;
  args: number[];
  unsigned: boolean;
  malformed: boolean;
}

const newElement = (): ElementState => ({ step: "start", depth: 0, name: null, type: "", args: [], unsigned: false, malformed: false });

/** The text of an identifier token (backticked or bare), or null for anything else. */
const identOf = (tok: Token): string | null => {
  if (tok.t === "ident") {
    return tok.text;
  }
  return tok.t === "word" ? tok.text : null;
};

/** The key a table is tracked and reported under: its lower-cased name, or INVALID_TABLE. */
const tableKey = (name: string): string => (IDENTIFIER.test(name) ? name.toLowerCase() : INVALID_TABLE);

const isPunct = (tok: Token, ch: string): boolean => tok.t === "punct" && tok.ch === ch;
const isWord = (tok: Token, word: string): boolean => tok.t === "word" && tok.text.toLowerCase() === word;

/**
 * The streaming dump parser. `write` → events; `end` → the last events and
 * the summary. One instance parses one input.
 */
export class DumpParser implements TokenSink {
  private readonly tokenizer: Tokenizer;
  private readonly limits: ParserLimits;
  private events: ParseEvent[] = [];
  private state: S = S.Start;
  private tokensInStatement = 0;
  private readonly counts: Record<StatementKind, number> = {
    create_table: 0,
    insert: 0,
    set: 0,
    lock: 0,
    drop: 0,
    use: 0,
    alter: 0,
    transaction: 0,
    create_other: 0,
    insert_other: 0,
    other: 0,
  };
  private readonly tables = new Map<string, TableState>();

  // CREATE TABLE
  private tableName = "";
  private columns: ColumnDef[] = [];
  private element = newElement();
  private elementsMalformed = false;

  // INSERT
  private target = "";
  private insertColumns: string[] | null = null;
  private positions: number[] = [];
  private statementRejection: RowRejection | null = null;
  private values: RawValue[] = [];
  private rowBytes = 0;
  private rowRejection: RowRejection | null = null;
  private introducer: Charset = "default";
  private skipDepth = 0;

  constructor(limits: ParserLimits = DEFAULT_PARSER_LIMITS) {
    this.limits = limits;
    this.tokenizer = new Tokenizer(this, limits);
  }

  /** Consume bytes; the events they completed, in order. */
  write(chunk: Buffer): ParseEvent[] {
    this.tokenizer.feed(chunk);
    return this.drain();
  }

  /** End of input: the last events and the structure-only summary. */
  end(): { events: ParseEvent[]; summary: ParseSummary } {
    const unfinished = this.tokenizer.finish();
    return {
      events: this.drain(),
      summary: {
        statements: { ...this.counts },
        comments: this.tokenizer.comments,
        conditionalComments: this.tokenizer.conditionalComments,
        delimiterRegions: this.tokenizer.delimiterRegions,
        truncated: unfinished || this.state !== S.Start,
        completionMarker: this.tokenizer.completionMarker,
      },
    };
  }

  /** @internal TokenSink */
  atStart(): boolean {
    return this.state === S.Start && this.tokensInStatement === 0;
  }

  /** @internal TokenSink */
  token(tok: Token): void {
    if (tok.t === "end") {
      this.endStatement();
      return;
    }
    this.tokensInStatement += 1;
    this.step(tok);
  }

  private drain(): ParseEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private endStatement(): void {
    if (this.state === S.TableBody) {
      // The body never closed: what was read is not a definition.
      this.elementsMalformed = true;
      this.finishTable();
    } else if (this.state === S.TableTail) {
      this.finishTable();
    } else if (IN_TUPLE.has(this.state)) {
      // The statement ended inside a tuple: that row is not a row.
      this.rowRejection ??= "unsupported_value";
      this.finishTuple();
    }
    this.state = S.Start;
    this.tokensInStatement = 0;
  }

  private skip(kind: StatementKind): void {
    this.counts[kind] += 1;
    this.state = S.Skip;
  }

  private step(tok: StatementToken): void {
    switch (this.state) {
      case S.Start:
        this.start(tok);
        return;
      case S.Skip:
      case S.TableTail:
        return;
      case S.Create:
        if (isWord(tok, "table")) {
          this.counts.create_table += 1;
          this.columns = [];
          this.element = newElement();
          this.elementsMalformed = false;
          this.state = S.TableIf;
        } else {
          this.skip("create_other");
        }
        return;
      case S.TableIf:
        if (isWord(tok, "if")) {
          this.state = S.TableIfNot;
          return;
        }
        this.tableNameToken(tok);
        return;
      case S.TableIfNot:
        this.state = isWord(tok, "not") ? S.TableIfNotExists : S.Skip;
        return;
      case S.TableIfNotExists:
        this.state = isWord(tok, "exists") ? S.TableName : S.Skip;
        return;
      case S.TableName:
        this.tableNameToken(tok);
        return;
      case S.TableOpen:
        if (isPunct(tok, ".")) {
          this.state = S.TableName;
        } else if (isPunct(tok, "(")) {
          this.state = S.TableBody;
        } else {
          // CREATE TABLE t LIKE x, CREATE TABLE t AS SELECT …: no column list to read.
          this.state = S.Skip;
        }
        return;
      case S.TableBody:
        this.bodyToken(tok);
        return;
      case S.Insert:
        if (isWord(tok, "ignore")) {
          return;
        }
        if (isWord(tok, "into")) {
          this.state = S.InsertInto;
          return;
        }
        this.notRows();
        return;
      case S.InsertInto: {
        const name = identOf(tok);
        if (name === null) {
          this.notRows();
          return;
        }
        this.target = name;
        this.state = S.InsertName;
        return;
      }
      case S.InsertName:
        if (isPunct(tok, ".")) {
          this.state = S.InsertInto;
        } else if (isPunct(tok, "(")) {
          this.insertColumns = [];
          this.state = S.InsertCols;
        } else {
          this.valuesKeyword(tok);
        }
        return;
      case S.InsertCols: {
        const name = identOf(tok);
        if (name === null || !IDENTIFIER.test(name)) {
          this.notRows();
          return;
        }
        (this.insertColumns as string[]).push(name.toLowerCase());
        this.state = S.InsertColsNext;
        return;
      }
      case S.InsertColsNext:
        if (isPunct(tok, ",")) {
          this.state = S.InsertCols;
        } else if (isPunct(tok, ")")) {
          this.state = S.InsertValuesKeyword;
        } else {
          this.notRows();
        }
        return;
      case S.InsertValuesKeyword:
        this.valuesKeyword(tok);
        return;
      case S.Values:
        if (isPunct(tok, "(")) {
          this.values = [];
          this.rowBytes = 0;
          this.rowRejection = null;
          this.state = S.Value;
        } else {
          this.state = S.Skip;
        }
        return;
      case S.Value:
        this.valueToken(tok);
        return;
      case S.AfterValue:
        if (isPunct(tok, ",")) {
          this.state = S.Value;
        } else if (isPunct(tok, ")")) {
          this.finishTuple();
        } else {
          this.badValue(tok);
        }
        return;
      case S.Introduced:
        if (tok.t === "string" || (tok.t === "hex" && tok.bytes !== null)) {
          this.pushBytes(tok.bytes, this.introducer);
        } else {
          this.badValue(tok);
        }
        return;
      case S.SkipTuple:
        if (isPunct(tok, "(")) {
          this.skipDepth += 1;
        } else if (isPunct(tok, ")")) {
          this.skipDepth -= 1;
          if (this.skipDepth === 0) {
            this.finishTuple();
          }
        }
        return;
      case S.AfterTuple:
        // `,` — another tuple; anything else (ON DUPLICATE KEY UPDATE …) is not read.
        this.state = isPunct(tok, ",") ? S.Values : S.Skip;
        return;
    }
  }

  private start(tok: Token): void {
    const word = tok.t === "word" ? tok.text.toLowerCase() : "";
    if (word === "create") {
      this.state = S.Create;
    } else if (word === "insert") {
      this.insertColumns = null;
      this.state = S.Insert;
    } else {
      this.skip(FIRST_WORD[word] ?? "other");
    }
  }

  /** An INSERT that is not `INSERT [IGNORE] INTO t [(cols)] VALUES …`. */
  private notRows(): void {
    this.skip("insert_other");
  }

  // ----- CREATE TABLE -------------------------------------------------------

  private tableNameToken(tok: Token): void {
    const name = identOf(tok);
    if (name === null) {
      this.state = S.Skip;
      return;
    }
    // `db`.`t`: the last part names the table.
    this.tableName = name;
    this.state = S.TableOpen;
  }

  private bodyToken(tok: Token): void {
    const el = this.element;
    if (el.depth === 0 && (isPunct(tok, ",") || isPunct(tok, ")"))) {
      this.finishElement();
      if (isPunct(tok, ")")) {
        this.state = S.TableTail;
      }
      return;
    }
    if (isPunct(tok, "(")) {
      el.depth += 1;
    } else if (isPunct(tok, ")")) {
      el.depth -= 1;
    }
    switch (el.step) {
      case "start": {
        const name = identOf(tok);
        if (tok.t === "word" && NOT_A_COLUMN.has(tok.text.toLowerCase())) {
          el.step = "skip";
        } else if (name !== null) {
          el.name = name;
          el.step = "type";
        } else {
          el.malformed = true;
          el.step = "skip";
        }
        return;
      }
      case "type":
        if (tok.t === "word") {
          el.type = tok.text.toLowerCase();
          el.step = "afterType";
        } else {
          el.malformed = true;
          el.step = "skip";
        }
        return;
      case "afterType":
        el.step = isPunct(tok, "(") ? "args" : "rest";
        this.restToken(tok);
        return;
      case "args":
        if (el.depth === 0) {
          el.step = "rest";
        } else if (tok.t === "number" && el.depth === 1) {
          el.args.push(Number(tok.text));
        }
        return;
      case "rest":
        this.restToken(tok);
        return;
      case "skip":
        return;
    }
  }

  private restToken(tok: Token): void {
    if (this.element.depth === 0 && isWord(tok, "unsigned")) {
      this.element.unsigned = true;
    }
  }

  private finishElement(): void {
    const el = this.element;
    this.element = newElement();
    if (el.malformed) {
      this.elementsMalformed = true;
    } else if (el.name !== null) {
      this.columns.push({ name: el.name, type: el.type, args: el.args, unsigned: el.unsigned });
    }
    // else: a key, an index, a constraint — or an empty element
  }

  private finishTable(): void {
    const key = tableKey(this.tableName);
    const existing = this.tables.get(key);
    if (existing === undefined && this.tables.size >= this.limits.maxTables) {
      // Past the limit a table is not tracked by its name (the map would grow without bound):
      // it is counted under the one invalid key, refused.
      this.tooManyTables();
      this.events.push({ kind: "tableRefused", table: INVALID_TABLE, reason: "too_many_tables" });
      return;
    }
    const refusal = this.refusalOf(key);
    const columns = this.columns.map((c) => ({ ...c, name: c.name.toLowerCase() }));
    if (existing && (existing.def !== null || existing.refusal !== null)) {
      // A second definition of the same table: kept only when identical.
      if (existing.def !== null && (refusal !== null || JSON.stringify(existing.def.columns) !== JSON.stringify(columns))) {
        existing.def = null;
        existing.refusal = "redefined_differently";
        this.events.push({ kind: "tableRefused", table: key, reason: "redefined_differently" });
      }
      return;
    }
    // New — or named by an INSERT before its definition: its row count goes on.
    const table: TableState = existing ?? { def: null, refusal: null, rows: 0 };
    this.tables.set(key, table);
    if (refusal !== null) {
      table.refusal = refusal;
      this.events.push({ kind: "tableRefused", table: key, reason: refusal });
      return;
    }
    table.def = { name: key, columns };
    this.events.push({ kind: "table", table: table.def });
  }

  /** The invalid key's entry, created (refused `too_many_tables`) when absent. */
  private tooManyTables(): TableState {
    const table = this.tables.get(INVALID_TABLE) ?? { def: null, refusal: "too_many_tables", rows: 0 };
    this.tables.set(INVALID_TABLE, table);
    return table;
  }

  private refusalOf(key: string): TableRefusal | null {
    if (key === INVALID_TABLE || this.columns.some((c) => !IDENTIFIER.test(c.name))) {
      return "identifier_not_allowed";
    }
    if (this.elementsMalformed) {
      return "malformed_definition";
    }
    if (this.columns.length === 0) {
      return "no_columns";
    }
    if (this.columns.length > this.limits.maxColumns) {
      return "too_many_columns";
    }
    const names = new Set(this.columns.map((c) => c.name.toLowerCase()));
    return names.size === this.columns.length ? null : "duplicate_column";
  }

  // ----- INSERT -------------------------------------------------------------

  private valuesKeyword(tok: Token): void {
    if (!isWord(tok, "values") && !isWord(tok, "value")) {
      // INSERT … SELECT, INSERT … SET: not rows of a dump.
      this.notRows();
      return;
    }
    this.counts.insert += 1;
    this.prepareTarget();
    this.state = S.Values;
  }

  /** Decide, once per INSERT, where its rows go (or why they are rejected). */
  private prepareTarget(): void {
    const key = tableKey(this.target);
    let table = this.tables.get(key);
    if (table === undefined) {
      if (this.tables.size >= this.limits.maxTables) {
        // Counted under the invalid key rather than growing the map without bound.
        this.target = INVALID_TABLE;
        table = this.tooManyTables();
      } else {
        table = { def: null, refusal: key === INVALID_TABLE ? "identifier_not_allowed" : null, rows: 0 };
        this.tables.set(key, table);
        this.target = key;
      }
    } else {
      this.target = key;
    }
    if (table.def === null) {
      this.statementRejection = table.refusal === null ? "table_not_declared" : "table_refused";
      return;
    }
    const names = table.def.columns.map((c) => c.name);
    const positions = this.insertColumns === null ? names.map((_, i) => i) : this.insertColumns.map((c) => names.indexOf(c));
    const valid = !positions.includes(-1) && new Set(positions).size === positions.length;
    this.statementRejection = valid ? null : "unknown_column";
    this.positions = positions;
  }

  private valueToken(tok: StatementToken): void {
    switch (tok.t) {
      case "word": {
        const word = tok.text.toLowerCase();
        const introducer = INTRODUCERS[word];
        if (word === "null") {
          this.pushValue({ kind: "null" }, 0);
        } else if (word === "true" || word === "false") {
          this.pushValue({ kind: "number", text: word === "true" ? "1" : "0" }, 1);
        } else if (introducer !== undefined) {
          this.introducer = introducer;
          this.state = S.Introduced;
        } else {
          this.badValue(tok);
        }
        return;
      }
      case "number":
        this.pushValue({ kind: "number", text: tok.text }, tok.text.length);
        return;
      case "string":
        this.pushBytes(tok.bytes, "default");
        return;
      case "hex":
        if (tok.bytes === null) {
          this.badValue(tok);
        } else {
          this.pushValue({ kind: "hex", bytes: tok.bytes }, tok.bytes.length);
        }
        return;
      case "bit":
        if (tok.text === null) {
          this.badValue(tok);
        } else {
          this.pushValue({ kind: "bit", text: tok.text }, tok.text.length);
        }
        return;
      case "ident":
      case "punct":
        this.badValue(tok);
    }
  }

  private pushBytes(bytes: Buffer | null, charset: Charset): void {
    if (bytes === null) {
      this.rowRejection ??= "row_too_large";
      this.state = S.AfterValue;
      return;
    }
    this.pushValue({ kind: "string", bytes, charset }, bytes.length);
  }

  private pushValue(value: RawValue, size: number): void {
    this.rowBytes += size;
    if (this.rowBytes > this.limits.maxRowBytes) {
      this.rowRejection ??= "row_too_large";
    }
    if (this.rowRejection === null) {
      this.values.push(value);
    }
    this.state = S.AfterValue;
  }

  /** A token that is not a value: the row is rejected, and the tuple skipped to its closing parenthesis. */
  private badValue(tok: Token): void {
    this.rowRejection ??= "unsupported_value";
    if (isPunct(tok, ")")) {
      this.finishTuple();
      return;
    }
    this.skipDepth = isPunct(tok, "(") ? 2 : 1;
    this.state = S.SkipTuple;
  }

  private finishTuple(): void {
    const table = this.tables.get(this.target) as TableState;
    table.rows += 1;
    const rowNumber = table.rows;
    const arity = this.values.length === this.positions.length ? null : "arity_mismatch";
    const reason = this.statementRejection ?? this.rowRejection ?? arity;
    if (reason === null) {
      // No rejection: the statement's table has a definition.
      const def = table.def as TableDef;
      const values: RawValue[] = def.columns.map(() => ({ kind: "null" }));
      this.positions.forEach((column, i) => {
        values[column] = this.values[i] as RawValue;
      });
      this.events.push({ kind: "row", table: this.target, rowNumber, values });
    } else {
      this.events.push({ kind: "reject", table: this.target, rowNumber, reason });
    }
    this.values = [];
    this.state = S.AfterTuple;
  }
}
