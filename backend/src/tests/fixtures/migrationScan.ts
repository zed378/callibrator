/**
 * A closed-world static reader of the migrations (src/migrations, pending/
 * included, .js and .ts): which columns each migration's `up` ADDS, and which
 * indexes the migrations CREATE.
 *
 * Moved here, unchanged, from tests/guards/modelIndexColumns.am3.guard.test.ts
 * (AM-3, ADR-100 Amendment 3), so a second guard can read the migrations the
 * same way (D-20, tests/migrations/0067-foreign-key-and-tenant-indexes.test.js).
 * Added for D-20: the index sites (`addIndex(table, fields)` reachable from
 * `up`, and every SQL string `CREATE [UNIQUE] INDEX ... ON table (...)` not
 * inside a `down`), `.map` callbacks enumerated like `for ... of` loops, and
 * `.map` / `.join` / `.filter`-free array calls evaluated.
 *
 * Constants, `for (... of ...)` loops and `.map` callbacks over constant arrays
 * and objects (`Object.entries/keys/values/freeze`), small helper functions and
 * template literals are evaluated; a site whose table or columns cannot be
 * evaluated is UNRESOLVED, and each guard fails on an unresolved site (closed
 * world — a new migration shape must be readable, never silently skipped).
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

export const MIGRATIONS_DIR = path.join(__dirname, "../../migrations");

export const UNKNOWN: unique symbol = Symbol("unknown");
/** A placeholder for an unknown fragment inside an evaluated string. */
export const HOLE = "\u0001";

export type Val = string | number | boolean | null | typeof UNKNOWN | Val[] | { [key: string]: Val };
type Env = Map<ts.Node, Map<string, Val>>;

/** A column a migration's `up` adds. */
export interface Added {
  table: string;
  column: string;
  file: string;
}

/**
 * An index a migration creates. `columns` are the leading-order key columns;
 * an expression key (`lower(x)`) is `null` at its position, as
 * pg_index/`isCovered` treat it. `partial` is true for a `WHERE` index.
 */
export interface CreatedIndex {
  table: string;
  columns: (string | null)[];
  name: string | null;
  unique: boolean;
  partial: boolean;
  file: string;
}

/** An index a migration's `up` removes (`removeIndex` / `DROP INDEX`), by name. */
export interface DroppedIndex {
  name: string;
  file: string;
}

export interface Scan {
  added: Added[];
  /** Column-adding sites it could not read (AM-3's closed world). */
  unresolved: string[];
  /** D-20: the indexes the migrations create. */
  indexes: CreatedIndex[];
  /** D-20: the indexes a migration's `up` removes. */
  dropped: DroppedIndex[];
  /** D-20: index sites it could not read (D-20's closed world). */
  unresolvedIndexes: string[];
}

const isObj = (v: Val): v is Record<string, Val> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const unwrap = (node: ts.Node): ts.Node => {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isTypeAssertionExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isAwaitExpression(n)
  ) {
    n = n.expression;
  }
  return n;
};

/** Names a binding pattern (or identifier) introduces. */
const bindingNames = (name: ts.BindingName): string[] =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name)));

/** Bind `value` to the names of `pattern` into `into`. */
const bindPattern = (pattern: ts.BindingName, value: Val, into: Map<string, Val>): void => {
  if (ts.isIdentifier(pattern)) {
    into.set(pattern.text, value);
    return;
  }
  if (ts.isArrayBindingPattern(pattern)) {
    pattern.elements.forEach((e, i) => {
      if (!ts.isOmittedExpression(e)) {
        bindPattern(e.name, Array.isArray(value) ? (value[i] ?? UNKNOWN) : UNKNOWN, into);
      }
    });
    return;
  }
  for (const e of pattern.elements) {
    const key = e.propertyName ?? e.name;
    const k = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
    bindPattern(e.name, k !== null && isObj(value) ? (value[k] ?? UNKNOWN) : UNKNOWN, into);
  }
};

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration;
/** A node's parent — undefined above the SourceFile, whatever the declared type says. */
const parentOf = (n: ts.Node): ts.Node | undefined => (n as { readonly parent?: ts.Node }).parent;

const isFunction = (n: ts.Node): n is FunctionNode =>
  ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);

/** The declaration of `name` visible from `from` — a variable initializer or a function — or null. */
const declarationOf = (name: string, from: ts.Node): ts.Node | null => {
  for (let scope = parentOf(from); scope; scope = parentOf(scope)) {
    const statements = ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) ? scope.statements : null;
    if (!statements) {
      continue;
    }
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name) {
            return decl.initializer ?? null;
          }
        }
      }
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return statement;
      }
    }
  }
  return null;
};

class Evaluator {
  private depth = 0;

  /** The value of identifier `id`, lexically: loop bindings and parameters from `env`, else declarations. */
  private identifier(id: ts.Identifier, env: Env): Val {
    const name = id.text;
    for (let n = parentOf(id); n; n = parentOf(n)) {
      const frame = env.get(n);
      if (frame?.has(name)) {
        return frame.get(name) ?? UNKNOWN;
      }
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && ts.isVariableDeclarationList(n.initializer)) {
        if (n.initializer.declarations.some((d) => bindingNames(d.name).includes(name))) {
          return UNKNOWN; // a loop not enumerated for this site
        }
      }
      if (isFunction(n) && n.parameters.some((p) => bindingNames(p.name).includes(name))) {
        return UNKNOWN; // a parameter not bound by a call we evaluated
      }
    }
    if (name === "undefined") {
      return UNKNOWN;
    }
    const decl = declarationOf(name, id);
    if (!decl || this.depth > 40) {
      return UNKNOWN;
    }
    this.depth += 1;
    try {
      return isFunction(decl) ? UNKNOWN : this.ev(decl, env);
    } finally {
      this.depth -= 1;
    }
  }

  /** Call a local function whose body is one expression (or `{ return expr; }`). */
  private call(fn: FunctionNode, args: Val[], env: Env): Val {
    let body: ts.Node | undefined = fn.body;
    if (body && ts.isBlock(body)) {
      const [only] = body.statements;
      body = body.statements.length === 1 && only && ts.isReturnStatement(only) ? only.expression : undefined;
    }
    if (!body) {
      return UNKNOWN;
    }
    const frame = new Map<string, Val>();
    fn.parameters.forEach((p, i) => {
      bindPattern(p.name, args[i] ?? UNKNOWN, frame);
    });
    const inner = new Map(env);
    inner.set(fn, frame);
    return this.ev(body, inner);
  }

  ev(node: ts.Node, env: Env): Val {
    const n = unwrap(node);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      return n.text;
    }
    if (ts.isNumericLiteral(n)) {
      return Number(n.text);
    }
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) {
      return n.kind === ts.SyntaxKind.TrueKeyword;
    }
    if (n.kind === ts.SyntaxKind.NullKeyword) {
      return null;
    }
    if (ts.isTemplateExpression(n) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      return this.str(n, env);
    }
    if (ts.isIdentifier(n)) {
      return this.identifier(n, env);
    }
    if (ts.isArrayLiteralExpression(n)) {
      const out: Val[] = [];
      for (const e of n.elements) {
        if (ts.isSpreadElement(e)) {
          const v = this.ev(e.expression, env);
          if (!Array.isArray(v)) {
            return UNKNOWN;
          }
          out.push(...v);
        } else {
          out.push(this.ev(e, env));
        }
      }
      return out;
    }
    if (ts.isObjectLiteralExpression(n)) {
      const out: Record<string, Val> = {};
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
          out[p.name.text] = this.ev(p.initializer, env);
        } else if (ts.isShorthandPropertyAssignment(p)) {
          out[p.name.text] = this.identifier(p.name, env);
        } else if (ts.isSpreadAssignment(p)) {
          const v = this.ev(p.expression, env);
          if (!isObj(v)) {
            return UNKNOWN;
          }
          Object.assign(out, v);
        } else if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) {
          out[p.name.text] = UNKNOWN; // a method
        }
      }
      return out;
    }
    if (ts.isPropertyAccessExpression(n)) {
      const target = this.ev(n.expression, env);
      return isObj(target) ? (target[n.name.text] ?? UNKNOWN) : UNKNOWN;
    }
    if (ts.isElementAccessExpression(n)) {
      const target = this.ev(n.expression, env);
      const key = this.ev(n.argumentExpression, env);
      if (Array.isArray(target) && typeof key === "number") {
        return target[key] ?? UNKNOWN;
      }
      return isObj(target) && typeof key === "string" ? (target[key] ?? UNKNOWN) : UNKNOWN;
    }
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const args = n.arguments.map((a) => this.ev(a, env));
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Object"
      ) {
        const [arg] = args;
        const method = callee.name.text;
        if (method === "freeze" && arg !== undefined) {
          return arg;
        }
        if (arg !== undefined && isObj(arg)) {
          if (method === "entries") {
            return Object.entries(arg).map(([k, v]) => [k, v]);
          }
          if (method === "keys") {
            return Object.keys(arg);
          }
          if (method === "values") {
            return Object.values(arg);
          }
        }
        return UNKNOWN;
      }
      // D-20: `array.join(sep)` and `array.map(fn)` over evaluated arrays.
      // D-20: `String(x)` and `str.replace(/re/flags | "s", "t")` (identifier quoting helpers).
      if (ts.isIdentifier(callee) && callee.text === "String" && args.length === 1) {
        const [v] = args;
        return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : UNKNOWN;
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "replace" && n.arguments.length === 2) {
        const target = this.ev(callee.expression, env);
        const [patternNode] = n.arguments;
        const replacement = args[1];
        if (typeof target === "string" && typeof replacement === "string" && patternNode) {
          const pn = unwrap(patternNode);
          if (ts.isRegularExpressionLiteral(pn)) {
            const text = pn.text;
            const slash = text.lastIndexOf("/");
            return target.replace(new RegExp(text.slice(1, slash), text.slice(slash + 1)), replacement);
          }
          const literal = args[0];
          return typeof literal === "string" ? target.replace(literal, replacement) : UNKNOWN;
        }
        return UNKNOWN;
      }
      // D-20: `array.filter(fn)` evaluates to the WHOLE array — an over-approximation, safe
      // only where a filtered-out element needs no index (0024: a table that is absent;
      // 0067: an index already served). Each such site is named in the D-20 test.
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "filter") {
        const target = this.ev(callee.expression, env);
        return Array.isArray(target) ? target : UNKNOWN;
      }
      if (ts.isPropertyAccessExpression(callee) && (callee.name.text === "join" || callee.name.text === "map")) {
        const target = this.ev(callee.expression, env);
        if (Array.isArray(target)) {
          if (callee.name.text === "join") {
            const [sep] = args;
            const parts = target.map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : HOLE));
            return parts.join(sep === undefined ? "," : typeof sep === "string" ? sep : HOLE);
          }
          const [fnArg] = n.arguments;
          const fnNode = fnArg ? unwrap(fnArg) : undefined;
          const fn = fnNode && isFunction(fnNode)
            ? fnNode
            : fnNode && ts.isIdentifier(fnNode)
              ? declarationOf(fnNode.text, fnNode)
              : null;
          if (fn && isFunction(fn) && this.depth <= 40) {
            this.depth += 1;
            try {
              return target.map((item, i) => this.call(fn, [item, i], env));
            } finally {
              this.depth -= 1;
            }
          }
        }
        return UNKNOWN;
      }
      if (ts.isIdentifier(callee)) {
        const decl = declarationOf(callee.text, callee);
        if (decl && isFunction(decl) && this.depth <= 40) {
          this.depth += 1;
          try {
            return this.call(decl, args, env);
          } finally {
            this.depth -= 1;
          }
        }
      }
      return UNKNOWN;
    }
    return UNKNOWN;
  }

  /** A string expression, with HOLE where a fragment cannot be evaluated. */
  str(node: ts.Node, env: Env): string {
    const n = unwrap(node);
    if (ts.isTemplateExpression(n)) {
      let out = n.head.text;
      for (const span of n.templateSpans) {
        out += this.str(span.expression, env) + span.literal.text;
      }
      return out;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return this.str(n.left, env) + this.str(n.right, env);
    }
    const v = this.ev(n, env);
    return typeof v === "string" || typeof v === "number" ? String(v) : HOLE;
  }
}

/** Every environment of the `for (... of ...)` loops enclosing `site`, outermost first. */
/** `fn` when it is the callback of `<array>.map(fn)`: the call's receiver, else null. D-20. */
const mapReceiverOf = (fn: ts.Node): ts.Expression | null => {
  const call = parentOf(fn);
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== fn) {
    return null;
  }
  const callee = unwrap(call.expression);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "map" ? callee.expression : null;
};

const loopEnvironments = (ev: Evaluator, site: ts.Node): Env[] => {
  // `for (... of ...)` loops, and (D-20) `.map((x) => ...)` callbacks, outermost first.
  const loops: ts.Node[] = [];
  for (let n = parentOf(site); n; n = parentOf(n)) {
    if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
      loops.unshift(n);
    } else if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && mapReceiverOf(n)) {
      loops.unshift(n);
    }
  }
  let envs: Env[] = [new Map<ts.Node, Map<string, Val>>()];
  for (const loop of loops) {
    const next: Env[] = [];
    for (const env of envs) {
      const isFor = ts.isForOfStatement(loop);
      const items = ev.ev(isFor ? loop.expression : (mapReceiverOf(loop) as ts.Expression), env);
      const pattern = isFor
        ? (loop.initializer as ts.VariableDeclarationList).declarations[0]?.name
        : (loop as ts.ArrowFunction | ts.FunctionExpression).parameters[0]?.name;
      // An unreadable iterable (rows from a query) binds its names UNKNOWN once.
      const list: Val[] = Array.isArray(items) ? items : [UNKNOWN];
      for (const item of list) {
        const frame = new Map<string, Val>();
        if (pattern) {
          bindPattern(pattern, item, frame);
        }
        const inner = new Map(env);
        inner.set(loop, frame);
        next.push(inner);
      }
    }
    envs = next.slice(0, 5000);
  }
  return envs;
};

/** The function nodes reachable from the migration's `up`, or null when it has none. */
const reachableFromUp = (source: ts.SourceFile, entry = "up"): Set<ts.Node> | null => {
  const exported: ts.ObjectLiteralExpression[] = [];
  const visitTop = (node: ts.Node): void => {
    if (ts.isExportAssignment(node)) {
      const e = unwrap(node.expression);
      if (ts.isObjectLiteralExpression(e)) {
        exported.push(e);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(source) === "module.exports"
    ) {
      const e = unwrap(node.right);
      if (ts.isObjectLiteralExpression(e)) {
        exported.push(e);
      }
    }
    ts.forEachChild(node, visitTop);
  };
  visitTop(source);
  const roots: ts.Node[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === entry && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      roots.push(statement);
    }
  }
  for (const obj of exported) {
    for (const p of obj.properties) {
      if (!p.name || !ts.isIdentifier(p.name) || p.name.text !== entry) {
        continue;
      }
      if (ts.isMethodDeclaration(p)) {
        roots.push(p);
      } else if (ts.isPropertyAssignment(p)) {
        const init = unwrap(p.initializer);
        const target = ts.isIdentifier(init) ? declarationOf(init.text, init) : init;
        if (target) {
          roots.push(target);
        }
      } else if (ts.isShorthandPropertyAssignment(p)) {
        const target = declarationOf(p.name.text, p.name);
        if (target) {
          roots.push(target);
        }
      }
    }
  }
  if (!roots.length) {
    return null;
  }
  // Top-level helpers by name.
  const helpers = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      helpers.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && isFunction(unwrap(d.initializer))) {
          helpers.set(d.name.text, unwrap(d.initializer));
        }
      }
    }
  }
  const reached = new Set<ts.Node>();
  const queue = [...roots];
  while (queue.length) {
    const fn = queue.pop();
    if (!fn || reached.has(fn)) {
      continue;
    }
    reached.add(fn);
    const walk = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const h = helpers.get(node.text);
        if (h && !reached.has(h)) {
          queue.push(h);
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(fn);
  }
  return reached;
};

const ALTER = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?("?)([^\s"(;]+)\1([\s\S]*?)(?=;|ALTER\s+TABLE|$)/gi;
const ADD_COLUMN = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)([^\s",;()]+)\1/gi;

/**
 * D-20: `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] [name] ON [ONLY]
 * table [USING method] (keys)`. Groups: 1 UNIQUE, 3 name, 4 table, 5 keys (the
 * balanced parenthesised list is cut at its closing parenthesis below).
 */
const CREATE_INDEX =
  /CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?!ON\b)("?[^\s"(]*"?)?\s*ON\s+(?:ONLY\s+)?"?([^\s"(]+)"?\s*(?:USING\s+\w+\s*)?\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/gi;

/** D-20: `DROP INDEX [CONCURRENTLY] [IF EXISTS] name`. Group 1: the name. */
const DROP_INDEX = /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?("?[^\s";,]+"?)/gi;

/** The comma-separated keys of an index's column list (commas inside parentheses kept). */
const splitKeys = (list: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") {depth += 1;}
    if (ch === ")") {depth -= 1;}
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {out.push(current.trim());}
  return out;
};

/** A key's column, or null for an expression key (`lower(x)`): `"a" DESC` is `a`. */
const keyColumn = (key: string): string | null => {
  if (key.includes("(")) {
    return null;
  }
  const first = key.trim().split(/\s+/)[0] ?? "";
  return first.replace(/"/g, "") || null;
};

/** The (table, column) pairs a migration file's `up` adds, and what it could not read. */
export const scanMigrationSource = (file: string, text: string): Scan => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const added: Added[] = [];
  const indexes: CreatedIndex[] = [];
  const dropped: DroppedIndex[] = [];
  const unresolved: string[] = [];
  const unresolvedIndexes: string[] = [];
  const reached = reachableFromUp(source);
  if (!reached) {
    return { added, unresolved: [`${file}: no \`up\` found`], indexes, dropped, unresolvedIndexes };
  }
  // D-20: an index statement reachable ONLY from `down` recreates what `up`
  // dropped; it is not an index the migration creates.
  const downOnly = reachableFromUp(source, "down") ?? new Set<ts.Node>();
  const ev = new Evaluator();
  const where = (node: ts.Node): string =>
    `${file}:${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}`;
  const inUp = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node; n; n = parentOf(n)) {
      if (reached.has(n)) {
        return true;
      }
    }
    return false;
  };
  const tableName = (v: Val): string | null => {
    if (typeof v === "string") {
      return v.includes(HOLE) ? null : (v.split(".").pop() ?? null);
    }
    return isObj(v) && typeof v["tableName"] === "string" ? v["tableName"] : null;
  };
  const isStringish = (n: ts.Node): boolean =>
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isTemplateExpression(n) ||
    (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken);

  const inDownOnly = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node; n; n = parentOf(n)) {
      if (reached.has(n)) {
        return false;
      }
      if (downOnly.has(n)) {
        return true;
      }
    }
    return false;
  };
  /** The names referenced inside functions reachable from `up`. */
  const namesUsedFromUp = new Set<string>();
  const collect = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      namesUsedFromUp.add(n.text);
    }
    ts.forEachChild(n, collect);
  };
  reached.forEach(collect);
  /**
   * Whether a string at `node` runs in `up`: inside an up-reachable function,
   * or a top-level constant (possibly nested in an array) that `up` references.
   */
  const runsInUp = (node: ts.Node): boolean => {
    if (inUp(node)) {
      return true;
    }
    for (let n: ts.Node | undefined = parentOf(node); n; n = parentOf(n)) {
      // A `.map` callback building a constant list (0099's FK_COLUMNS) is part of that constant.
      if (isFunction(n) && !mapReceiverOf(n)) {
        return false;
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && ts.isSourceFile(parentOf(parentOf(parentOf(n) ?? n) ?? n) ?? n)) {
        return namesUsedFromUp.has(n.name.text);
      }
    }
    return false;
  };
  const visitIndexes = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "removeIndex" && inUp(node)) {
        const [, nameArg] = node.arguments;
        for (const env of loopEnvironments(ev, node)) {
          const name = nameArg ? ev.ev(nameArg, env) : UNKNOWN;
          if (typeof name === "string" && !name.includes(HOLE)) {
            dropped.push({ name, file });
          } else {
            unresolvedIndexes.push(`${where(node)}: removeIndex(${node.arguments.map((a) => a.getText(source)).join(", ")})`);
          }
        }
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "addIndex" && inUp(node)) {
        const [tableArg, fieldsArg, optionsArg] = node.arguments;
        for (const env of loopEnvironments(ev, node)) {
          const table = tableArg ? tableName(ev.ev(tableArg, env)) : null;
          let fields = fieldsArg ? ev.ev(fieldsArg, env) : UNKNOWN;
          let options = optionsArg ? ev.ev(optionsArg, env) : {};
          if (isObj(fields)) {
            options = fields;
            fields = fields["fields"] ?? UNKNOWN;
          }
          const columns = Array.isArray(fields)
            ? fields.map((f) => (typeof f === "string" ? f : isObj(f) && typeof f["name"] === "string" ? f["name"] : null))
            : null;
          if (table && columns?.every((c) => !c?.includes(HOLE))) {
            const opts = isObj(options) ? options : {};
            indexes.push({
              table,
              columns,
              name: typeof opts["name"] === "string" ? opts["name"] : null,
              unique: opts["unique"] === true,
              partial: opts["where"] !== undefined && opts["where"] !== UNKNOWN,
              file,
            });
          } else {
            unresolvedIndexes.push(`${where(node)}: addIndex(${node.arguments.map((a) => a.getText(source)).slice(0, 2).join(", ")})`);
          }
        }
      }
    }
    if (
      isStringish(node) &&
      !isStringish(parentOf(node) ?? node.getSourceFile()) &&
      !ts.isTemplateSpan(parentOf(node) ?? node.getSourceFile()) &&
      /(?:CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX)/i.test(node.getText(source)) &&
      !inDownOnly(node) &&
      runsInUp(node)
    ) {
      for (const env of loopEnvironments(ev, node)) {
        const sql = ev.str(node, env);
        const statements = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX/gi)].length;
        let found = 0;
        for (const m of sql.matchAll(CREATE_INDEX)) {
          found += 1;
          const table = (m[4] ?? "").split(".").pop() ?? "";
          const keys = splitKeys(m[5] ?? "");
          const columns = keys.map(keyColumn);
          if (table.includes(HOLE) || !table || keys.some((k) => k.includes(HOLE))) {
            unresolvedIndexes.push(`${where(node)}: ${sql.replaceAll(HOLE, "?").slice(0, 140)}`);
          } else {
            indexes.push({
              table,
              columns,
              name: m[3] ? m[3].replace(/"/g, "") : null,
              unique: Boolean(m[1]),
              partial: /^\s*WHERE\b/i.test(sql.slice(m.index + m[0].length)),
              file,
            });
          }
        }
        if (found !== statements) {
          unresolvedIndexes.push(`${where(node)}: CREATE INDEX that is not readable: ${sql.replaceAll(HOLE, "?").slice(0, 140)}`);
        }
        for (const d of sql.matchAll(DROP_INDEX)) {
          const name = (d[1] ?? "").replace(/"/g, "").split(".").pop() ?? "";
          if (!name || name.includes(HOLE)) {
            unresolvedIndexes.push(`${where(node)}: ${sql.replaceAll(HOLE, "?").slice(0, 140)}`);
          } else {
            dropped.push({ name, file });
          }
        }
      }
      return;
    }
    ts.forEachChild(node, visitIndexes);
  };
  visitIndexes(source);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "addColumn" && inUp(node)) {
        const [tableArg, columnArg] = node.arguments;
        for (const env of loopEnvironments(ev, node)) {
          const table = tableArg ? tableName(ev.ev(tableArg, env)) : null;
          const column = columnArg ? ev.ev(columnArg, env) : UNKNOWN;
          if (table && typeof column === "string" && !column.includes(HOLE)) {
            added.push({ table, column, file });
          } else {
            unresolved.push(`${where(node)}: addColumn(${node.arguments.map((a) => a.getText(source)).slice(0, 2).join(", ")})`);
          }
        }
      }
    }
    // The outermost string expression whose text mentions ADD COLUMN.
    if (
      isStringish(node) &&
      !isStringish(parentOf(node) ?? node.getSourceFile()) &&
      !ts.isTemplateSpan(parentOf(node) ?? node.getSourceFile()) &&
      /ADD\s+COLUMN/i.test(node.getText(source)) &&
      inUp(node)
    ) {
      for (const env of loopEnvironments(ev, node)) {
        const sql = ev.str(node, env);
        const adds = [...sql.matchAll(/ADD\s+COLUMN/gi)].length;
        let found = 0;
        for (const alter of sql.matchAll(ALTER)) {
          const table = alter[2] ?? "";
          for (const add of (alter[3] ?? "").matchAll(ADD_COLUMN)) {
            found += 1;
            const column = add[2] ?? "";
            if (table.includes(HOLE) || column.includes(HOLE)) {
              unresolved.push(`${where(node)}: ${sql.replaceAll(HOLE, "?").slice(0, 120)}`);
            } else {
              added.push({ table: table.split(".").pop() ?? table, column, file });
            }
          }
        }
        if (found !== adds) {
          unresolved.push(`${where(node)}: ADD COLUMN outside a readable ALTER TABLE: ${sql.replaceAll(HOLE, "?").slice(0, 120)}`);
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { added, unresolved, indexes, dropped, unresolvedIndexes };
};

/** Every migration file under src/migrations (pending/ included), .js and .ts, declarations excluded. */
export const migrationFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(MIGRATIONS_DIR);
  return out.sort();
};

export const scanMigrations = (): Scan => {
  const all: Scan = { added: [], unresolved: [], indexes: [], dropped: [], unresolvedIndexes: [] };
  for (const full of migrationFiles()) {
    const rel = path.relative(MIGRATIONS_DIR, full).split(path.sep).join("/");
    const one = scanMigrationSource(rel, fs.readFileSync(full, "utf8"));
    all.added.push(...one.added);
    all.indexes.push(...one.indexes);
    all.dropped.push(...one.dropped);
    all.unresolvedIndexes.push(...one.unresolvedIndexes);
    all.unresolved.push(...one.unresolved);
  }
  return all;
};
